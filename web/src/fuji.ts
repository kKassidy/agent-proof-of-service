import { registry, seller } from './evidence'

export type Stats = { paid: bigint; success: bigint; failed: bigint }
export const snapshot: Stats = { paid: 2n, success: 1n, failed: 1n }
const rpcUrl = 'https://api.avax-test.network/ext/bc/C/rpc'

// A deliberately small read-only JSON-RPC client. No wallet or signing API.
export async function readSellerStats(signal: AbortSignal): Promise<Stats> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)])
  async function rpc(method: 'eth_chainId' | 'eth_call', params: unknown[]) {
    const response = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: requestSignal,
    })
    if (!response.ok) throw new Error('Fuji RPC unavailable')
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || !('result' in body) || 'error' in body || typeof body.result !== 'string') throw new Error('Invalid RPC response')
    return body.result
  }
  if (BigInt(await rpc('eth_chainId', [])) !== 43113n) throw new Error('Unexpected chain')
  // keccak256("sellerStats(address)")[0:4], followed by the ABI-encoded address.
  // Return tuple matches contracts/src/ServiceProofRegistry.sol: paid, successful, failed.
  const result = await rpc('eth_call', [{ to: registry, data: `0xe5b0117a${seller.slice(2).toLowerCase().padStart(64, '0')}` }, 'latest'])
  if (!/^0x[0-9a-fA-F]{192}$/.test(result)) throw new Error('Invalid sellerStats tuple')
  const values = [0, 1, 2].map(index => BigInt(`0x${result.slice(2 + index * 64, 66 + index * 64)}`))
  const [paid, success, failed] = values
  if (success + failed > paid) throw new Error('Inconsistent registry counters')
  return { paid, success, failed }
}

import { registryAbi } from '../../server/src/registryAbi'
import { fujiClient, FUJI_CHAIN_ID } from './wallet'

export type Job3Readback = {
  status: 'Failure'
  paymentRef: `0x${string}`
  resultHash: `0x${string}`
  paid: bigint
  success: bigint
  failed: bigint
}

export async function readJob3Proof(): Promise<Job3Readback> {
  const client = fujiClient()
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('RPC is not Avalanche Fuji.')

  const [job, stats] = await Promise.all([
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'getJob',
      args: [3n],
    }),
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'sellerStats',
      args: [seller],
    }),
  ])

  const expectedPaymentRef = '0xfdbaf0372ba3b87e3d0ba77d25adac2af64c09c2d933f4584caecb1f94a143ca'
  const expectedResultHash = '0xc39f24e4a3efec42fe5cdd3ef8d33cfe0b2bb8fb91f99ca79bb90a59b43830cd'

  if (job.seller.toLowerCase() !== seller.toLowerCase()) throw new Error('Job #3 seller mismatch.')
  if (job.status !== 3) throw new Error('Job #3 is not recorded as Failure.')
  if (job.paymentRef.toLowerCase() !== expectedPaymentRef) throw new Error('Job #3 paymentRef mismatch.')
  if (job.resultHash.toLowerCase() !== expectedResultHash) throw new Error('Job #3 resultHash mismatch.')

  const [paid, success, failed] = stats
  if (success + failed > paid) throw new Error('Inconsistent registry counters.')

  return {
    status: 'Failure',
    paymentRef: job.paymentRef,
    resultHash: job.resultHash,
    paid,
    success,
    failed,
  }
}
