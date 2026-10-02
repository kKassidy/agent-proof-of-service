import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, zeroHash, type Hash } from 'viem'
import { registry, seller } from '../src/evidence'
import { createJobAbi, taskHash, type Provider } from '../src/wallet'
import { checkPayment, paymentBlocked, paymentMessage, readRun, requestPayment, saveRun, storageKey, validateJobForPayment, type PaymentClient, type Run, type RunStorage } from '../src/payment'
const buyer = '0x51b682f07424b124992C0a42600dCa15c4383aFE' as const
const creationHash = '0x1b5b66be3f86e550556dda29b952fa95d3babedb11f8600b9da7f05f247399b0' as const
const paymentHash = `0x${'42'.repeat(32)}` as Hash
const blockHash = `0x${'13'.repeat(32)}` as Hash
const run: Run = { buyer, hash: creationHash, job: { buyer, jobId: '3', seller, taskHash, transactionHash: creationHash } }
const unlocked = async (work: () => Promise<void>) => work()
function fixture() {
  let raw: string | null = null
  const storage: RunStorage = { getItem: () => raw, setItem: (_key, value) => { raw = value } }
  saveRun(storage, run)
  const methods: string[] = []
  const sends: Record<string, string>[] = []
  let account: string = buyer; let chain = '0xa869'
  let sendError: unknown
  const provider = { request: async ({ method, params }: { method: string; params?: unknown }) => {
    methods.push(method)
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return chain
    if (method === 'eth_sendTransaction') {
      sends.push((params as Record<string, string>[])[0])
      assert.equal(readRun(storage)?.payment?.status, 'uncertain', 'intent must be durable before signature prompt')
      if (sendError) throw sendError
      return paymentHash
    }
    throw new Error(`Unexpected wallet method ${method}`)
  }, on() {}, removeListener() {} } as unknown as Provider
  const job = { buyer, seller, taskHash, status: 0, paymentRef: zeroHash, resultHash: zeroHash, createdAt: 10n, completedAt: 0n }
  const tx = { hash: paymentHash, chainId: 43113, from: buyer, to: seller, value: 1_000_000_000_000n, input: '0x', blockHash }
  const paymentReceipt = { status: 'success', transactionHash: paymentHash, blockHash }
  let rpcChain = 43113
  let receiptError: unknown
  const reads: unknown[] = []
  const creation = { status: 'success', transactionHash: creationHash, logs: [{ address: registry, topics: encodeEventTopics({ abi: createJobAbi, eventName: 'JobCreated', args: { jobId: 3n, buyer, seller } }), data: encodeAbiParameters([{ type: 'bytes32' }], [taskHash]) }] }
  const client = {
    getChainId: async () => rpcChain,
    getTransactionReceipt: async () => creation,
    readContract: async (args: unknown) => { reads.push(args); return job },
    waitForTransactionReceipt: async () => { if (receiptError) throw receiptError; return paymentReceipt },
    getTransaction: async () => tx,
  } as unknown as PaymentClient
  let current = run
  const publish = (value: Run) => { current = value }
  return { storage, provider, client, job, tx, paymentReceipt, creation, methods, sends, reads, publish,
    current: () => current,
    account: (value: string) => { account = value }, chain: (value: string) => { chain = value }, rpcChain: (value: number) => { rpcChain = value },
    sendError: (value: unknown) => { sendError = value }, receiptError: (value: unknown) => { receiptError = value },
  }
}
test('native request has exact original buyer, seller, wei, Fuji and no calldata', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  assert.equal(f.sends.length, 1)
  const sent = f.sends[0]
  assert.equal(sent.from.toLowerCase(), buyer.toLowerCase())
  assert.equal(sent.to.toLowerCase(), seller.toLowerCase())
  assert.equal(BigInt(sent.value), 1_000_000_000_000n)
  assert.equal(sent.data, undefined)
  assert.ok(f.methods.includes('eth_chainId'))
  assert.equal(readRun(f.storage)?.payment?.hash, paymentHash)
  assert.equal(readRun(f.storage)?.payment?.status, 'submitted')
  assert.deepEqual(f.reads, [{ address: registry, abi: (await import('../../server/src/registryAbi')).registryAbi, functionName: 'getJob', args: [3n] }])
})
for (const condition of ['wallet chain', 'RPC chain', 'account changed', 'buyer', 'seller', 'taskHash', 'status', 'paymentRef', 'creation event', 'job ID', 'no creation validation']) {
  test(`blocks payment for ${condition}`, async () => {
    const f = fixture(); const input = structuredClone(run)
    if (condition === 'wallet chain') f.chain('0x1')
    if (condition === 'RPC chain') f.rpcChain(1)
    if (condition === 'account changed') f.account(seller)
    if (condition === 'buyer') f.job.buyer = seller as typeof buyer
    if (condition === 'seller') f.job.seller = buyer
    if (condition === 'taskHash') f.job.taskHash = zeroHash
    if (condition === 'status') f.job.status = 1
    if (condition === 'paymentRef') f.job.paymentRef = paymentHash
    if (condition === 'creation event') f.creation.logs[0].address = buyer
    if (condition === 'job ID') input.job!.jobId = '99'
    if (condition === 'no creation validation') delete input.job
    await assert.rejects(requestPayment(f.provider, input, f.storage, f.publish, f.client, unlocked))
    assert.equal(f.sends.length, 0)
  })
}
test('account changing during RPC preflight is checked before requesting payment', async () => {
  const f = fixture(); const original = f.client.readContract
  f.client.readContract = (async args => { f.account(seller); return original(args) }) as PaymentClient['readContract']
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 0)
})
test('known hash blocks duplicate requests even with stale React state / another tab', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 1)
  assert.equal(paymentBlocked(f.current(), buyer, 43113), true)
})
test('successful native receipt persists confirmation but never changes registry status', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  const result = await checkPayment(f.current(), f.storage, f.publish, f.client)
  assert.equal(result.payment?.status, 'confirmed')
  assert.equal(f.job.status, 0)
  assert.match(paymentMessage(result.payment, true), /Awaiting Proof-of-Service payment verification/)
  assert.match(paymentMessage(result.payment, true), /does not mark the registry job Paid/)
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 1)
})
test('refresh preserves payment hash and original buyer, revalidates receipts without another send', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  await checkPayment(f.current(), f.storage, f.publish, f.client)
  const reloaded = readRun(f.storage)!
  assert.equal(reloaded.buyer, buyer)
  assert.equal(reloaded.hash, creationHash)
  assert.equal(reloaded.job, undefined)
  assert.equal(reloaded.payment?.hash, paymentHash)
  assert.equal(paymentBlocked(reloaded, buyer, 43113), true)
  const restored = { ...reloaded, job: run.job }
  await validateJobForPayment(restored, f.client)
  await checkPayment(restored, f.storage, f.publish, f.client)
  assert.equal(f.current().payment?.status, 'confirmed')
  assert.equal(f.sends.length, 1)
})
test('unknown submission never retries and persists a no-hash warning across refresh', async () => {
  const f = fixture(); f.sendError(new Error('RPC timeout after possible broadcast'))
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(readRun(f.storage)?.payment?.status, 'uncertain')
  assert.equal(readRun(f.storage)?.payment?.hash, undefined)
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 1)
  assert.match(paymentMessage(readRun(f.storage)?.payment, false), /Inspect wallet activity/)
})
test('receipt timeout keeps the submitted hash and blocks repayment', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  f.receiptError(new Error('Timeout'))
  await assert.rejects(checkPayment(f.current(), f.storage, f.publish, f.client))
  assert.equal(readRun(f.storage)?.payment?.hash, paymentHash)
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 1)
})
test('explicit wallet rejection is retained, never automatically retried', async () => {
  const f = fixture(); f.sendError({ code: 4001 })
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(readRun(f.storage)?.payment?.status, 'rejected')
  assert.equal(f.sends.length, 1)
})
test('failed intent persistence prevents any signing request', async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error('Storage full') }
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.sends.length, 0)
})
test('hash remains on screen if persistence fails after wallet returns it', async () => {
  const f = fixture(); const write = f.storage.setItem; let writes = 0
  f.storage.setItem = (key, value) => { if (++writes === 2) throw new Error('Storage full'); write(key, value) }
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked))
  assert.equal(f.current().payment?.hash, paymentHash)
  assert.equal(readRun(f.storage)?.payment?.status, 'uncertain')
  assert.equal(f.sends.length, 1)
})
test('creation recovery cannot erase a newer saved payment marker', async () => {
  const f = fixture()
  await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
  const merged = saveRun(f.storage, run)
  assert.equal(merged.payment?.hash, paymentHash)
})
test('malformed payment data fails closed and cannot enable payment', () => {
  const f = fixture(); f.storage.setItem(storageKey, JSON.stringify({ buyer, hash: creationHash, payment: { unexpected: true } }))
  assert.equal(readRun(f.storage)?.payment?.status, 'uncertain')
  assert.equal(paymentBlocked({ ...readRun(f.storage)!, job: run.job }, buyer, 43113), true)
})
for (const field of ['from', 'to', 'value', 'chainId', 'input', 'blockHash', 'receipt reverted']) {
  test(`does not confirm an edited/cancelled/replaced payment with wrong ${field}`, async () => {
    const f = fixture()
    await requestPayment(f.provider, run, f.storage, f.publish, f.client, unlocked)
    if (field === 'from') f.tx.from = seller as typeof buyer
    if (field === 'to') f.tx.to = buyer
    if (field === 'value') f.tx.value = 1n
    if (field === 'chainId') f.tx.chainId = 1
    if (field === 'input') f.tx.input = '0x1234'
    if (field === 'blockHash') f.tx.blockHash = zeroHash
    if (field === 'receipt reverted') f.paymentReceipt.status = 'reverted'
    const result = await checkPayment(f.current(), f.storage, f.publish, f.client)
    assert.notEqual(result.payment?.status, 'confirmed')
    assert.equal(paymentBlocked(result, buyer, 43113), true)
  })
}
test('another tab holding the payment lock prevents any wallet request', async () => {
  const f = fixture()
  await assert.rejects(requestPayment(f.provider, run, f.storage, f.publish, f.client, async () => { throw new Error('Lock unavailable') }))
  assert.equal(f.methods.length, 0)
})
test('account change disables the button while retaining the original buyer', () => {
  assert.equal(paymentBlocked(run, buyer, 43113), false)
  assert.equal(paymentBlocked(run, seller, 43113), true)
  assert.equal(paymentBlocked(run, buyer, 1), true)
  assert.equal(run.buyer, buyer)
})
