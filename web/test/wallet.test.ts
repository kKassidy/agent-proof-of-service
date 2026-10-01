import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, decodeFunctionData, type Address, type EIP1193Provider, type Hash, type TransactionReceipt } from 'viem'
import { canonicalTask, hashTask } from '../../server/src/orchestration'
import { registry, seller } from '../src/evidence'
import { createJobAbi, decodeCreatedJob, discoverWallets, evaluatePolicy, submitCreateJob, switchToFuji, task, taskHash, walletError, walletState } from '../src/wallet'
const buyer = '0x1111111111111111111111111111111111111111' as Address
const tx = `0x${'22'.repeat(32)}` as Hash
function provider(handler: (args: { method: string; params?: unknown }) => unknown): EIP1193Provider {
  return { request: async args => handler(args), on() {}, removeListener() {} } as EIP1193Provider
}
function receipt(overrides = {}): Pick<TransactionReceipt, 'status' | 'transactionHash' | 'logs'> {
  const topics = encodeEventTopics({ abi: createJobAbi, eventName: 'JobCreated', args: { jobId: 47n, buyer, seller } })
  return { status: 'success', transactionHash: tx, logs: [{ address: registry, topics, data: encodeAbiParameters([{ type: 'bytes32' }], [taskHash]), ...overrides }] } as Pick<TransactionReceipt, 'status' | 'transactionHash' | 'logs'>
}
test('browser task uses the existing canonical implementation and approved historical task vector', () => {
  assert.equal(taskHash, hashTask(task))
  assert.equal(taskHash, '0xe9cddd83f03f2ffa8a7748045a0447f74b1d71ea153de5387609be3bbd651cc5')
  assert.equal(canonicalTask(task), '["apos.weather.v1","weather","Tokyo","seller-a","0x0342ed8eac11a52c247c9428c450a7288b72f484",1000,"native-AVAX",43113,"1000000000000"]')
})
test('existing illustrative policy selects only Seller A', () => {
  const rows = evaluatePolicy()
  assert.deepEqual(rows.filter(row => row.eligible).map(row => row.seller.id), ['seller-a'])
  assert.equal(rows[0].seller.verifiedJobs, 103)
})
test('receipt returns actual emitted job ID and original buyer', () => {
  assert.deepEqual(decodeCreatedJob(receipt(), buyer), { jobId: '47', buyer, seller, taskHash, transactionHash: tx })
})
test('receipt rejects reverted transactions, missing and duplicate matching events', () => {
  assert.throws(() => decodeCreatedJob({ ...receipt(), status: 'reverted' }, buyer))
  assert.throws(() => decodeCreatedJob({ ...receipt(), logs: [] }, buyer))
  const r = receipt(); r.logs.push(r.logs[0]); assert.throws(() => decodeCreatedJob(r, buyer))
})
for (const field of ['registry', 'buyer', 'seller', 'taskHash']) {
  test(`receipt rejects mismatched ${field}`, () => {
    const r = receipt()
    if (field === 'registry') r.logs[0].address = buyer
    if (field === 'buyer') r.logs[0].topics = encodeEventTopics({ abi: createJobAbi, eventName: 'JobCreated', args: { jobId: 47n, buyer: seller, seller } })
    if (field === 'seller') r.logs[0].topics = encodeEventTopics({ abi: createJobAbi, eventName: 'JobCreated', args: { jobId: 47n, buyer, seller: buyer } })
    if (field === 'taskHash') r.logs[0].data = encodeAbiParameters([{ type: 'bytes32' }], [tx])
    assert.throws(() => decodeCreatedJob(r, buyer))
  })
}
test('wallet state reads accounts without requesting access until explicit connect', async () => {
  const methods: string[] = []
  const p = provider(({ method }) => { methods.push(method); return method === 'eth_chainId' ? '0xa869' : [buyer] })
  assert.equal((await walletState(p)).chainId, 43113)
  assert.deepEqual(methods, ['eth_accounts', 'eth_chainId'])
  await walletState(p, true)
  assert.equal(methods[2], 'eth_requestAccounts')
})
test('unknown Fuji network is added then switched, without transaction submission', async () => {
  const methods: string[] = []; let first = true
  const p = provider(({ method }) => {
    methods.push(method)
    if (method === 'wallet_switchEthereumChain' && first) { first = false; throw { code: 4902 } }
    return method === 'eth_chainId' ? '0xa869' : method === 'eth_accounts' ? [buyer] : null
  })
  await switchToFuji(p)
  assert.deepEqual(methods, ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_accounts', 'eth_chainId'])
})
test('rejected network switch does not add a network', async () => {
  const methods: string[] = []
  await assert.rejects(switchToFuji(provider(({ method }) => { methods.push(method); throw { code: 4001 } })))
  assert.deepEqual(methods, ['wallet_switchEthereumChain'])
  assert.match(walletError({ cause: { code: 4001 } }), /rejected/)
})
test('wrong account or network cannot request a creation transaction', async () => {
  for (const [account, chain] of [[seller, '0xa869'], [buyer, '0x1']]) {
    const methods: string[] = []
    await assert.rejects(submitCreateJob(provider(({ method }) => { methods.push(method); return method === 'eth_chainId' ? chain : [account] }), buyer))
    assert.ok(!methods.includes('eth_sendTransaction'))
  }
})
test('the only wallet transaction is zero-value createJob to the fixed registry', async () => {
  const sends: Record<string, string>[] = []
  const p = provider(({ method, params }) => {
    if (method === 'eth_accounts') return [buyer]
    if (method === 'eth_chainId') return '0xa869'
    if (method === 'eth_sendTransaction') { sends.push((params as Record<string, string>[])[0]); return tx }
    throw new Error(`Unexpected method ${method}`)
  })
  assert.equal(await submitCreateJob(p, buyer), tx)
  assert.equal(sends.length, 1)
  assert.equal(sends[0].to.toLowerCase(), registry.toLowerCase())
  assert.equal(BigInt(sends[0].value), 0n)
  assert.equal(sends[0].from.toLowerCase(), buyer)
  const decoded = decodeFunctionData({ abi: createJobAbi, data: sends[0].data as Hash })
  assert.equal(decoded.functionName, 'createJob')
  assert.equal(decoded.args[0].toLowerCase(), seller.toLowerCase())
  assert.equal(decoded.args[1], taskHash)
})
test('EIP-6963 discovers two wallets, deduplicates providers and never requests accounts', () => {
  const target = new EventTarget()
  const p = provider(() => { throw new Error('Discovery must not access accounts') })
  const q = provider(() => { throw new Error('Discovery must not access accounts') })
  const names: string[] = []
  const cleanup = discoverWallets(target as unknown as Window, wallet => names.push(wallet.name))
  for (const [uuid, name, injected] of [['a', 'MetaMask', p], ['b', 'Core', q], ['a', 'MetaMask', p]] as const) {
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid, name }, provider: injected } }))
  }
  cleanup()
  assert.deepEqual(names, ['MetaMask', 'Core'])
})
