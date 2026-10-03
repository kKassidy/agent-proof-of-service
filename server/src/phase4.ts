import { encodeFunctionData, zeroAddress, zeroHash, type Address, type Hash } from 'viem';
import { phase3Run, same, statsJson, type Phase3Job, type Phase3Stats } from './phase3';
import { DEMO_PAYMENT_WEI, hashTask } from './task';
import { RegistryStatus, outcomeStatus, serviceEvidence } from './orchestration';
import { verifyNativeAvaxPayment, type PaymentClient } from './payment';
import { registryWriteAbi } from './registryAbi';
import { executeSellerHttp } from './sellerHttp';
import type { ServiceResponse } from './service';
import type { Phase4Store } from './phase4Store';
import type { FrozenServiceEvidence, OutcomeProof, Phase4Action, Phase4Evidence } from './phase4Types';

export const phase4TaskHash = hashTask({ serviceType: 'weather', city: 'Tokyo', sellerId: 'seller-a',
  sellerAddress: phase3Run.seller, maxResponseTimeMs: 1000, paymentAmountWei: DEMO_PAYMENT_WEI });
export type Phase4Snapshot = { blockNumber: bigint; job: Phase3Job; validator: Address; stats: Phase3Stats };
export interface Phase4Reader {
  payment: PaymentClient;
  snapshot(): Promise<Phase4Snapshot>;
  simulate(snapshot: Phase4Snapshot, frozen: FrozenServiceEvidence): Promise<void>;
  outcome(snapshot: Phase4Snapshot, frozen: FrozenServiceEvidence, hash?: Hash): Promise<OutcomeProof | null>;
}
export function parsePhase4Input(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Phase 4 input');
  const input = raw as Record<string, unknown>;
  if (input.jobId !== '3' || Object.keys(input).some(key => !['jobId', 'outcomeTransactionHash'].includes(key))) throw new Error('Only Job #3 is supported');
  const hash = input.outcomeTransactionHash;
  if (hash !== undefined && (typeof hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hash) || hash === zeroHash)) throw new Error('Invalid outcome hash');
  return { jobId: '3' as const, ...(typeof hash === 'string' ? { outcomeTransactionHash: hash.toLowerCase() as Hash } : {}) };
}
export function freezeServiceEvidence(response: ServiceResponse): FrozenServiceEvidence {
  return { version: 1, jobId: '3', registry: phase3Run.registry, chainId: 43113, taskHash: phase4TaskHash,
    paymentRef: phase3Run.paymentHash, scenario: 'DETERMINISTIC_FAULT_INJECTION', transport: 'HTTP', timing: 'MEASURED',
    ...serviceEvidence(response, 1000) };
}
export function validateFrozenEvidence(raw: unknown): FrozenServiceEvidence {
  if (!raw || typeof raw !== 'object') throw new Error('Missing frozen evidence');
  const value = raw as FrozenServiceEvidence;
  const rebuilt = freezeServiceEvidence(value.response);
  for (const key of ['version', 'jobId', 'registry', 'chainId', 'taskHash', 'paymentRef', 'scenario', 'transport', 'timing', 'canonical', 'resultHash'] as const) {
    if (value[key] !== rebuilt[key]) throw new Error('Frozen evidence integrity mismatch');
  }
  if (value.resultHash === zeroHash || JSON.stringify(value.validation) !== JSON.stringify(rebuilt.validation)) throw new Error('Frozen validation mismatch');
  return rebuilt;
}
export function matchesExpectedFault(frozen: FrozenServiceEvidence) {
  const failed = frozen.validation.checks.filter(check => !check.passed);
  // This scenario guard is separate from the unchanged schema/SLA validator.
  return frozen.response.body === '{"city":"Tokyo","condition":"clear"}' && frozen.validation.result === 'FAILURE' &&
    frozen.validation.checks.length === 6 && failed.length === 1 && failed[0]?.id === 'temperatureFiniteNumber';
}
function checkJob(job: Phase3Job) {
  if (job.createdAt <= 0n || !same(job.buyer, phase3Run.buyer) || !same(job.seller, phase3Run.seller) ||
      !same(job.taskHash, phase4TaskHash) || !same(job.paymentRef, phase3Run.paymentHash)) throw new Error('Canonical Job #3 mismatch');
  if (![RegistryStatus.Paid, RegistryStatus.Success, RegistryStatus.Failure].includes(job.status)) throw new Error('Job is not Paid or finalized');
  if (job.status === RegistryStatus.Paid ? job.resultHash !== zeroHash || job.completedAt !== 0n
    : job.resultHash === zeroHash || job.completedAt < job.createdAt) throw new Error('Inconsistent registry state');
}
export const executePhase4Seller = (baseUrl = 'http://127.0.0.1:3001') => executeSellerHttp(baseUrl, 'seller-a', 'Tokyo', 'failure');

export async function inspectPhase4(reader: Phase4Reader, store: Phase4Store, raw: unknown, action: Phase4Action,
  execute: () => Promise<ServiceResponse> = executePhase4Seller): Promise<Phase4Evidence> {
  const input = parsePhase4Input(raw);
  if (await reader.payment.getChainId() !== 43113) throw new Error('RPC must be Fuji');
  let snapshot = await reader.snapshot(); checkJob(snapshot.job);
  const payment = await verifyNativeAvaxPayment(reader.payment, { transactionHash: phase3Run.paymentHash,
    expectedBuyer: snapshot.job.buyer, expectedSeller: snapshot.job.seller, minimumAmountWei: DEMO_PAYMENT_WEI });
  const paymentVerified = payment.status === 'VERIFIED';
  let frozen: FrozenServiceEvidence | null = null;
  let attempted = false; let storageAvailable = true;
  try {
    attempted = await store.attempted();
    const saved = await store.load();
    if (saved !== null) frozen = validateFrozenEvidence(saved);
  } catch { storageAvailable = false; }
  if (action === 'execute' && snapshot.job.status === RegistryStatus.Paid && paymentVerified && storageAvailable && !frozen && !attempted && !input.outcomeTransactionHash) {
    // Cross-process exclusive intent must be durable BEFORE making the HTTP call.
    if (await store.claim()) {
      snapshot = await reader.snapshot(); checkJob(snapshot.job);
      if (snapshot.job.status === RegistryStatus.Paid) {
        const observed = freezeServiceEvidence(await execute());
        await store.freeze(observed);
        frozen = validateFrozenEvidence(await store.load());
        snapshot = await reader.snapshot(); checkJob(snapshot.job);
      }
    } else {
      const saved = await store.load();
      if (saved !== null) frozen = validateFrozenEvidence(saved);
    }
    attempted = true;
  }
  const paid = snapshot.job.status === RegistryStatus.Paid;
  const expectedFault = !!frozen && matchesExpectedFault(frozen);
  let preparationReady = paid && paymentVerified && storageAvailable && expectedFault && snapshot.validator !== zeroAddress && !input.outcomeTransactionHash;
  let notice = !paid ? 'Registry already finalized. Execution and preparation are disabled.'
    : !storageAvailable ? 'Frozen evidence is unreadable or inconsistent. Stop; do not delete it or rerun.'
    : !paymentVerified ? 'Existing payment verification failed. No execution or preparation is allowed.'
    : input.outcomeTransactionHash ? 'Outcome submission may already exist. Refresh and inspect it; do not send again.'
    : frozen ? expectedFault ? 'Frozen evidence matches the approved 5/6 fault-injection failure. No outcome recorded yet.'
      : 'Observed evidence does not match the approved 5/6 failure. Preparation blocked; evidence retained without rerunning.'
    : attempted ? 'An execution attempt exists without complete frozen evidence. Inspect locally; no automatic retry is allowed.'
    : 'Ready for explicit deterministic fault-injection execution. No service has been called by this flow.';
  let prepared: Phase4Evidence['prepared'] = null;
  if (action === 'prepare' && preparationReady && frozen) {
    // This request has independently reread Paid state and recomputed the frozen hash.
    try {
      await reader.simulate(snapshot, frozen);
      const outcome = outcomeStatus(frozen.validation.result);
      prepared = { chainId: 43113, to: phase3Run.registry, from: snapshot.validator, value: '0',
        functionName: 'recordOutcome', jobId: '3', outcome, resultHash: frozen.resultHash,
        data: encodeFunctionData({ abi: registryWriteAbi, functionName: 'recordOutcome', args: [3n, outcome, frozen.resultHash] }),
        command: `cast send ${phase3Run.registry} 'recordOutcome(uint256,uint8,bytes32)' 3 ${outcome} ${frozen.resultHash} --rpc-url ${phase3Run.rpcUrl} --chain 43113 --from ${snapshot.validator} --account YOUR_EXISTING_ENCRYPTED_ACCOUNT --value 0 --async` };
      notice = 'Authorized call simulated. Public instructions only; nothing signed or sent.';
    } catch { preparationReady = false; notice = 'Outcome simulation blocked or unavailable. Do not send; refresh and investigate.'; }
  }
  let outcomeProof: OutcomeProof | null = null; let outcomeNotice = '';
  if (!paid) {
    if (!frozen || !expectedFault || snapshot.job.status !== RegistryStatus.Failure || !same(snapshot.job.resultHash, frozen.resultHash)) {
      outcomeNotice = 'Final registry state recovered, but it cannot be matched to the locally frozen approved failure evidence. No rerun or write is allowed.';
    } else {
      try {
        outcomeProof = await reader.outcome(snapshot, frozen, input.outcomeTransactionHash);
        if (!outcomeProof) outcomeNotice = 'Final state matches frozen evidence; paste the outcome hash for older receipt recovery.';
      } catch { outcomeNotice = 'Final state matches frozen evidence; outcome receipt unavailable or mismatched. Refresh; do not resend.'; }
    }
  }
  return { jobId: '3', registryStatus: paid ? 'Paid' : snapshot.job.status === RegistryStatus.Failure ? 'Failure' : 'Success',
    observedBlock: snapshot.blockNumber.toString(), paymentRef: snapshot.job.paymentRef, resultHash: snapshot.job.resultHash,
    validator: snapshot.validator, paymentVerified, frozen, executionAttempted: attempted,
    canExecute: paid && paymentVerified && storageAvailable && !attempted && !frozen && !input.outcomeTransactionHash,
    expectedFault, preparationReady, notice, prepared, outcomeProof, outcomeNotice, sellerStats: statsJson(snapshot.stats) };
}
