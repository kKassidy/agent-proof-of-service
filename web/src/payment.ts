import { createWalletClient, custom, isAddress, zeroHash, type Address, type Hash } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { registryAbi } from '../../server/src/registryAbi'
import { DEMO_PAYMENT_WEI } from '../../server/src/task'
import { registry, seller } from './evidence'
import { decodeCreatedJob, fujiClient, FUJI_CHAIN_ID, taskHash, walletState, type CreatedJob, type Provider } from './wallet'

export const storageKey = 'pos.phase1.creation.v1' // Preserve Phase 1 browser runs.
export const paymentAmount = DEMO_PAYMENT_WEI
export type Payment = { status: 'uncertain' | 'submitted' | 'confirmed' | 'reverted' | 'mismatch' | 'rejected'; hash?: Hash }
export type Run = { buyer: Address; hash?: Hash; job?: CreatedJob; payment?: Payment }
export type RunStorage = Pick<Storage, 'getItem' | 'setItem'>
export type PaymentClient = Pick<ReturnType<typeof fujiClient>, 'getChainId' | 'getTransactionReceipt' | 'readContract' | 'waitForTransactionReceipt' | 'getTransaction'>
const validHash = (value: unknown): value is Hash => typeof value === 'string' && /^0x[\da-fA-F]{64}$/.test(value)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export function readRun(storage: RunStorage): Run | undefined {
  const raw = storage.getItem(storageKey)
  if (raw === null) return undefined
  const value = JSON.parse(raw)
  if (!value || !isAddress(value.buyer) || (value.hash !== undefined && !validHash(value.hash))) throw new Error('Saved run is invalid; inspect wallet activity before clearing browser data.')
  const run: Run = { buyer: value.buyer, ...(value.hash ? { hash: value.hash } : {}) }
  if (value.payment !== undefined) {
    const p = value.payment
    // Never discard a malformed/unknown payment marker and thereby enable repayment.
    const status = ['uncertain', 'submitted', 'confirmed', 'reverted', 'mismatch', 'rejected'].includes(p?.status) ? p.status : 'uncertain'
    run.payment = { status, ...(validHash(p?.hash) ? { hash: p.hash } : {}) }
  }
  // Creation evidence must be re-read, not trusted from local storage.
  return run
}
export function saveRun(storage: RunStorage, run: Run) {
  const saved = readRun(storage)
  // An older tab's creation-receipt refresh must not erase a newer payment marker.
  const payment = saved && saved.hash === run.hash && same(saved.buyer, run.buyer)
    ? saved.payment?.status === 'confirmed' ? saved.payment : run.payment ?? saved.payment
    : run.payment
  const merged = { ...run, ...(payment ? { payment } : {}) }
  storage.setItem(storageKey, JSON.stringify({ buyer: merged.buyer, hash: merged.hash, payment: merged.payment }))
  return merged
}
export function paymentBlocked(run: Run | undefined, account: Address | undefined, chain: number | undefined) {
  return !run?.job || !account || !same(account, run.buyer) || chain !== FUJI_CHAIN_ID || !!run.payment
}
export async function validateJobForPayment(run: Run, client: PaymentClient = fujiClient()) {
  if (!run.hash || !run.job || !same(run.buyer, run.job.buyer) || !same(run.job.seller, seller) || run.job.taskHash !== taskHash) throw new Error('Validate the original creation receipt first.')
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('RPC is not Avalanche Fuji.')
  const receipt = await client.getTransactionReceipt({ hash: run.hash })
  if (!same(receipt.transactionHash, run.hash)) throw new Error('Creation receipt hash mismatch.')
  const created = decodeCreatedJob(receipt, run.buyer)
  if (created.jobId !== run.job.jobId) throw new Error('Creation job ID mismatch.')
  const job = await client.readContract({ address: registry, abi: registryAbi, functionName: 'getJob', args: [BigInt(created.jobId)] })
  if (!same(job.buyer, run.buyer) || !same(job.seller, seller) || job.taskHash !== taskHash || job.status !== 0 || job.paymentRef !== zeroHash || job.resultHash !== zeroHash || job.createdAt <= 0n || job.completedAt !== 0n) throw new Error('Registry job does not match the original Created job. Payment blocked.')
  return created
}
export async function browserPaymentLock(work: () => Promise<void>) {
  if (!navigator.locks) throw new Error('Payment requires a browser with Web Locks on localhost or HTTPS.')
  await navigator.locks.request('pos.native-payment.v1', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Another tab is handling a payment. Inspect that tab first.')
    await work()
  })
}
// No backend/verifier calls. An intent is saved before invoking the wallet, and
// any attempt blocks a second payment, including after reload or another tab.
export async function requestPayment(provider: Provider, run: Run, storage: RunStorage, publish: (run: Run) => void,
  client: PaymentClient = fujiClient(), withLock = browserPaymentLock) {
  await withLock(async () => {
    const saved = readRun(storage)
    if (!saved || saved.hash !== run.hash || !same(saved.buyer, run.buyer) || saved.payment || run.payment) throw new Error('This run is missing or already has a payment attempt. Do not pay again.')
    await validateJobForPayment(run, client)
    const state = await walletState(provider)
    if (paymentBlocked(run, state.account, state.chainId)) throw new Error('Select the original buyer wallet on Avalanche Fuji.')
    let pending = saveRun(storage, { ...run, payment: { status: 'uncertain' } })
    publish(pending) // durable reservation exists before any signing prompt
    let hash: Hash
    try {
      hash = await createWalletClient({ chain: avalancheFuji, transport: custom(provider, { retryCount: 0 }) }).sendTransaction({
        account: run.buyer, to: seller, value: paymentAmount,
      })
    } catch (error) {
      let cause = error
      for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) {
        if ('code' in cause && cause.code === 4001) {
          pending = { ...pending, payment: { status: 'rejected' } }
          publish(pending); saveRun(storage, pending); break
        }
        cause = 'cause' in cause ? cause.cause : undefined
      }
      throw error // never retry eth_sendTransaction
    }
    pending = { ...pending, payment: { status: 'submitted', hash } }
    publish(pending) // retain the hash on screen even if storage subsequently fails
    saveRun(storage, pending)
  })
}
export async function checkPayment(run: Run, storage: RunStorage, publish: (run: Run) => void, client: PaymentClient = fujiClient()) {
  if (!run.payment?.hash) throw new Error('No saved payment hash. Inspect wallet activity; do not pay again.')
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('RPC is not Avalanche Fuji.')
  let current = run
  const receipt = await client.waitForTransactionReceipt({ hash: run.payment.hash, confirmations: 1, timeout: 120000,
    onReplaced: replacement => {
      current = { ...current, payment: { status: 'submitted', hash: replacement.transaction.hash } }
      publish(current); saveRun(storage, current)
    },
  })
  const hash = current.payment!.hash!
  if (!same(receipt.transactionHash, hash)) throw new Error('Payment receipt hash mismatch.')
  let status: Payment['status'] = 'reverted'
  if (receipt.status === 'success') {
    const tx = await client.getTransaction({ hash })
    status = same(tx.hash, hash) && tx.chainId === FUJI_CHAIN_ID && same(tx.from, run.buyer) && tx.to !== null && same(tx.to, seller) && tx.value === paymentAmount && tx.input === '0x' && tx.blockHash !== null && tx.blockHash === receipt.blockHash ? 'confirmed' : 'mismatch'
  }
  current = { ...current, payment: { status, hash } }
  publish(current); saveRun(storage, current)
  return current
}
export function paymentMessage(payment: Payment | undefined, checked: boolean) {
  if (!payment) return 'No native payment submitted for this saved run.'
  if (payment.status === 'confirmed' && checked) return 'Native payment confirmed ✓ · Awaiting Proof-of-Service payment verification. This transfer does not mark the registry job Paid.'
  if (payment.status === 'confirmed') return 'Saved native payment confirmation. Recheck its receipt after refresh; do not pay again.'
  if (payment.status === 'rejected') return 'Wallet approval was rejected. No automatic retry is offered; inspect wallet activity before any recovery.'
  if (payment.status === 'reverted') return 'Native payment receipt reverted. Another payment is blocked; inspect wallet activity.'
  if (payment.status === 'mismatch') return 'The mined transaction does not match the exact native payment terms. Inspect the transaction; do not pay again.'
  if (payment.hash) return 'Native payment submitted / confirmation pending. A timeout is not proof of failure. Check the saved receipt; do not pay again.'
  return 'Payment approval is pending or submission is uncertain, with no hash saved. Inspect wallet activity before attempting anything else. Do not clear saved run data or resubmit.'
}
