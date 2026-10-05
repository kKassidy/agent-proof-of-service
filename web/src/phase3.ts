import type { Phase3Action, Phase3Evidence } from '../../server/src/phase3Types'

export type { Phase3Evidence }
export const phase3CreationHash = '0x1b5b66be3f86e550556dda29b952fa95d3babedb11f8600b9da7f05f247399b0'
export const phase3PaymentHash = '0xfdbaf0372ba3b87e3d0ba77d25adac2af64c09c2d933f4584caecb1f94a143ca'
export const phase3ConfirmationHash = '0x0ce71e92b43bbfbea3252cd422d00f58bf5867b7afa5003fe817cb236eb12a77'
export const phase3StorageKey = 'pos.phase3.operator.v1'
export type OperatorState = { handedOff: boolean; hash: string }
export const isTransactionHash = (hash: string) => /^0x[\da-fA-F]{64}$/.test(hash) && !/^0x0{64}$/.test(hash)
export function readOperatorState(storage: Pick<Storage, 'getItem'>): OperatorState {
  const raw = storage.getItem(phase3StorageKey)
  if (raw === null) return { handedOff: false, hash: '' }
  const saved = JSON.parse(raw)
  // An unknown existing marker never enables a new handoff automatically.
  return { handedOff: saved?.handedOff !== false, hash: isTransactionHash(saved?.hash ?? '') ? saved.hash : '' }
}
export function saveOperatorState(storage: Pick<Storage, 'setItem'>, state: OperatorState) {
  if (state.hash && !isTransactionHash(state.hash)) throw new Error('Enter a nonzero transaction hash')
  storage.setItem(phase3StorageKey, JSON.stringify(state))
}
export function persistOperatorRequest(storage: Pick<Storage, 'getItem' | 'setItem'>, action: Phase3Action, hash: string): OperatorState {
  const saved = readOperatorState(storage)
  if (action === 'prepare' && saved.handedOff) throw new Error('Operator handoff already started. Inspect terminal activity and refresh; do not resend.')
  const next = { handedOff: saved.handedOff || action === 'prepare' || !!hash, hash: hash || saved.hash }
  saveOperatorState(storage, next)
  return next
}
export async function requestPhase3(action: Phase3Action, confirmationHash = '', fetcher: typeof fetch = fetch): Promise<Phase3Evidence> {
  if (confirmationHash && !isTransactionHash(confirmationHash)) throw new Error('Enter a nonzero confirmation transaction hash')
  const response = await fetcher(`/api/phase3/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: '3', paymentTransactionHash: phase3PaymentHash,
      ...(confirmationHash ? { confirmationTransactionHash: confirmationHash } : {}) }),
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error('Backend evidence unavailable or request rejected. Refresh; do not resend any transaction.')
  const result = await response.json() as Phase3Evidence
  if (result.jobId !== '3' || result.chainId !== 43113 ||
      !['Created', 'Paid'].includes(result.registryStatus) || !result.verification?.checks) throw new Error('Unexpected backend evidence')
  return result
}
