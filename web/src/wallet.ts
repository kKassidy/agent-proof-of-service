import { createPublicClient, createWalletClient, custom, decodeEventLog, encodeFunctionData, formatEther, http, isAddress, type Address, type EIP1193Provider, type Hash, type TransactionReceipt } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { DEMO_PAYMENT_WEI, FUJI_CHAIN_ID, hashTask, type WeatherTask } from '../../server/src/task'
import { evaluateSeller, policy, selectSeller, sellers } from '../../server/src/service'
import { registry, seller } from './evidence'

export { FUJI_CHAIN_ID, policy }
export const task: WeatherTask = Object.freeze({ serviceType: 'weather', city: 'Tokyo', sellerId: 'seller-a', sellerAddress: seller, maxResponseTimeMs: 1000, paymentAmountWei: DEMO_PAYMENT_WEI })
export const taskHash = hashTask(task)
export const createJobAbi = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable', inputs: [{ name: 'seller', type: 'address' }, { name: 'taskHash', type: 'bytes32' }], outputs: [{ name: 'jobId', type: 'uint256' }] },
  { type: 'event', name: 'JobCreated', inputs: [{ name: 'jobId', type: 'uint256', indexed: true }, { name: 'buyer', type: 'address', indexed: true }, { name: 'seller', type: 'address', indexed: true }, { name: 'taskHash', type: 'bytes32', indexed: false }] },
] as const
export type Provider = EIP1193Provider
export type Wallet = { id: string; name: string; provider: Provider }
export type CreatedJob = { jobId: string; buyer: Address; seller: Address; taskHash: Hash; transactionHash: Hash }
export function evaluatePolicy() {
  const selected = selectSeller(sellers)
  if (selected?.id !== 'seller-a') throw new Error('Seller A did not qualify')
  return sellers.map(candidate => evaluateSeller(candidate))
}

// Discovery never requests accounts. Wallet access is an explicit button action.
export function discoverWallets(target: Window, found: (wallet: Wallet) => void) {
  const seen = new Set<Provider>()
  const add = (wallet: Wallet) => {
    if (wallet.provider && typeof wallet.provider.request === 'function' && !seen.has(wallet.provider)) {
      seen.add(wallet.provider); found(wallet)
    }
  }
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string }; provider?: Provider }>).detail
    if (detail?.provider && typeof detail.info?.uuid === 'string' && typeof detail.info.name === 'string') {
      add({ id: detail.info.uuid, name: detail.info.name.slice(0, 80), provider: detail.provider })
    }
  }
  target.addEventListener('eip6963:announceProvider', announce)
  target.dispatchEvent(new Event('eip6963:requestProvider'))
  const timer = setTimeout(() => {
    const legacy = target as Window & { ethereum?: Provider; avalanche?: Provider }
    if (legacy.avalanche) add({ id: 'legacy-core', name: 'Core (injected)', provider: legacy.avalanche })
    if (legacy.ethereum) add({ id: 'legacy-injected', name: 'Injected wallet', provider: legacy.ethereum })
  }, 300)
  return () => { clearTimeout(timer); target.removeEventListener('eip6963:announceProvider', announce) }
}
export async function walletState(provider: Provider, connect = false) {
  const accounts = await provider.request({ method: connect ? 'eth_requestAccounts' : 'eth_accounts' })
  const chain = await provider.request({ method: 'eth_chainId' })
  const account = accounts[0]
  return { account: account && isAddress(account) ? account : undefined, chainId: Number(BigInt(chain)) }
}
export async function switchToFuji(provider: Provider) {
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] }) }
  catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 4902) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xa869', chainName: 'Avalanche Fuji C-Chain', nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'], blockExplorerUrls: ['https://testnet.snowtrace.io'] }] })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] })
  }
  if ((await walletState(provider)).chainId !== FUJI_CHAIN_ID) throw new Error('Wallet is not on Fuji')
}
export const fujiClient = () => createPublicClient({ chain: avalancheFuji, transport: http('https://api.avax-test.network/ext/bc/C/rpc', { timeout: 8000, retryCount: 1 }) })
export async function fujiBalance(account: Address) {
  const client = fujiClient()
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('Unexpected RPC network')
  return formatEther(await client.getBalance({ address: account }))
}
export async function submitCreateJob(provider: Provider, buyer: Address) {
  const state = await walletState(provider)
  if (state.chainId !== FUJI_CHAIN_ID || state.account?.toLowerCase() !== buyer.toLowerCase()) throw new Error('Restore the selected buyer account on Fuji before creating a job')
  evaluatePolicy()
  // Only a zero-value createJob call. Signing remains inside the injected wallet.
  return createWalletClient({ chain: avalancheFuji, transport: custom(provider) }).sendTransaction({
    account: buyer, to: registry, data: encodeFunctionData({ abi: createJobAbi, functionName: 'createJob', args: [seller, taskHash] }), value: 0n,
  })
}
export function decodeCreatedJob(receipt: Pick<TransactionReceipt, 'status' | 'transactionHash' | 'logs'>, buyer: Address): CreatedJob {
  if (receipt.status !== 'success') throw new Error('Job creation transaction reverted')
  const matches = receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== registry.toLowerCase()) return []
    try {
      const event = decodeEventLog({ abi: createJobAbi, eventName: 'JobCreated', data: log.data, topics: log.topics, strict: true })
      const args = event.args
      return args.jobId > 0n && args.buyer.toLowerCase() === buyer.toLowerCase() && args.seller.toLowerCase() === seller.toLowerCase() && args.taskHash.toLowerCase() === taskHash.toLowerCase() ? [args] : []
    } catch { return [] }
  })
  if (matches.length !== 1) throw new Error('Receipt does not contain exactly one matching registry JobCreated event')
  return { jobId: matches[0].jobId.toString(), buyer: matches[0].buyer, seller: matches[0].seller, taskHash: matches[0].taskHash, transactionHash: receipt.transactionHash }
}
export function walletError(error: unknown) {
  let current = error
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    if ('code' in current && current.code === 4001) return 'Wallet request rejected. The dashboard is still available.'
    if ('code' in current && current.code === -32002) return 'A wallet request is already open. Check your wallet.'
    current = 'cause' in current ? current.cause : undefined
  }
  return 'Wallet or Fuji RPC request failed. Check your wallet, network, and transaction link before retrying.'
}
