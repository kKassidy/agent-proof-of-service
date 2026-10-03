import type { Phase4Action, Phase4Evidence } from '../../server/src/phase4Types'
import { isTransactionHash } from './phase3'
export type { Phase4Evidence }
export const phase4StorageKey = 'pos.phase4.operator.v1'
// Reuse the public-hash/uncertainty helpers against an isolated Phase 4 key.
export const phase4OperatorStorage = (storage: Pick<Storage, 'getItem' | 'setItem'>) => ({
  getItem: () => storage.getItem(phase4StorageKey),
  setItem: (_key: string, value: string) => storage.setItem(phase4StorageKey, value),
})
export async function requestPhase4(action: Phase4Action, outcomeHash = '', fetcher: typeof fetch = fetch): Promise<Phase4Evidence> {
  if (outcomeHash && !isTransactionHash(outcomeHash)) throw new Error('Enter a nonzero outcome transaction hash')
  const response = await fetcher(`/api/phase4/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: '3', ...(outcomeHash ? { outcomeTransactionHash: outcomeHash } : {}) }),
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error('Phase 4 evidence unavailable or execution uncertain. Refresh only; do not rerun or resend.')
  const result = await response.json() as Phase4Evidence
  if (result.jobId !== '3' || !['Paid', 'Success', 'Failure'].includes(result.registryStatus) || typeof result.canExecute !== 'boolean') throw new Error('Unexpected backend evidence')
  return result
}
