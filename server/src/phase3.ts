import { encodeFunctionData, zeroAddress, zeroHash, type Address, type Hash } from 'viem';
import { verifyNativeAvaxPayment, type PaymentClient } from './payment';
import { registryWriteAbi } from './registryAbi';
import { DEMO_PAYMENT_WEI, FUJI_CHAIN_ID, hashTask } from './task';
import type { ConfirmationProof, Phase3Action, Phase3Evidence } from './phase3Types';
export type { Phase3Action, Phase3Evidence } from './phase3Types';

// Public allowlist for this acceptance run, not browser-supplied payment terms.
export const phase3Run = {
  registry: '0x442EacAd079CcE0e3671ee0B2eb75c199f36e917',
  buyer: '0x51b682f07424b124992C0a42600dCa15c4383aFE',
  seller: '0x0342ed8eaC11a52C247C9428c450A7288b72f484',
  creationHash: '0x1b5b66be3f86e550556dda29b952fa95d3babedb11f8600b9da7f05f247399b0',
  paymentHash: '0xfdbaf0372ba3b87e3d0ba77d25adac2af64c09c2d933f4584caecb1f94a143ca',
  jobId: '3', rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
} as const;
const approvedTaskHash = hashTask({ serviceType: 'weather', city: 'Tokyo', sellerId: 'seller-a',
  sellerAddress: phase3Run.seller, maxResponseTimeMs: 1000, paymentAmountWei: DEMO_PAYMENT_WEI });
export type Phase3Input = { jobId: string; paymentTransactionHash: Hash; confirmationTransactionHash?: Hash };
export type Phase3Job = { buyer: Address; seller: Address; taskHash: Hash; paymentRef: Hash; resultHash: Hash;
  createdAt: bigint; completedAt: bigint; status: number };
export type Phase3Stats = { paidJobs: bigint; successfulJobs: bigint; failedJobs: bigint };
export type Phase3Snapshot = { blockNumber: bigint; job: Phase3Job; confirmer: Address; stats: Phase3Stats };
export interface Phase3Reader {
  payment: PaymentClient;
  snapshot(): Promise<Phase3Snapshot>;
  // eth_call only: the contract checks its private consumed-reference mapping.
  simulate(snapshot: Phase3Snapshot, paymentRef: Hash): Promise<void>;
  confirmation(snapshot: Phase3Snapshot, hash?: Hash): Promise<ConfirmationProof | null>;
}
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const statsJson = (stats: Phase3Stats) => ({ paidJobs: stats.paidJobs.toString(),
  successfulJobs: stats.successfulJobs.toString(), failedJobs: stats.failedJobs.toString() });

export function parsePhase3Input(value: unknown): Phase3Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Phase 3 request');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['jobId', 'paymentTransactionHash', 'confirmationTransactionHash'].includes(key)) ||
      input.jobId !== phase3Run.jobId || typeof input.paymentTransactionHash !== 'string' ||
      !same(input.paymentTransactionHash, phase3Run.paymentHash)) throw new Error('Only the approved Job #3 payment is supported');
  const hash = input.confirmationTransactionHash;
  if (hash !== undefined && (typeof hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hash) || hash === zeroHash)) throw new Error('Invalid confirmation hash');
  return { jobId: phase3Run.jobId, paymentTransactionHash: phase3Run.paymentHash,
    ...(typeof hash === 'string' ? { confirmationTransactionHash: hash.toLowerCase() as Hash } : {}) };
}

// No signer, wallet, child process, environment configuration or write capability.
export async function inspectPhase3(reader: Phase3Reader, raw: unknown, action: Phase3Action): Promise<Phase3Evidence> {
  const input = parsePhase3Input(raw);
  if (await reader.payment.getChainId() !== FUJI_CHAIN_ID) throw new Error('RPC must be Avalanche Fuji');
  const snapshot = await reader.snapshot();
  const { job, confirmer } = snapshot;
  if (job.createdAt <= 0n || !same(job.buyer, phase3Run.buyer) || !same(job.seller, phase3Run.seller) ||
      !same(job.taskHash, approvedTaskHash)) throw new Error('Registry job does not match approved terms');
  if (job.resultHash !== zeroHash || job.completedAt !== 0n || ![0, 1].includes(job.status)) throw new Error('Job is outside Phase 3');
  if ((job.status === 0 && job.paymentRef !== zeroHash) ||
      (job.status === 1 && !same(job.paymentRef, input.paymentTransactionHash))) throw new Error('Registry payment reference mismatch');

  // Capture the very same evidence consumed by the existing verifier, without
  // changing its >= amount semantics or adding a browser-only acceptance path.
  let tx: Awaited<ReturnType<PaymentClient['getTransaction']>> | undefined;
  let receipt: Awaited<ReturnType<PaymentClient['getTransactionReceipt']>> | undefined;
  const verification = await verifyNativeAvaxPayment({
    getChainId: () => reader.payment.getChainId(),
    getTransaction: async args => { tx = await reader.payment.getTransaction(args); return tx; },
    getTransactionReceipt: async args => { receipt = await reader.payment.getTransactionReceipt(args); return receipt; },
  }, { transactionHash: input.paymentTransactionHash, expectedBuyer: job.buyer,
    expectedSeller: job.seller, minimumAmountWei: DEMO_PAYMENT_WEI });

  let confirmationReady = false;
  let readiness = job.status === 1 ? 'Already Paid; no further confirmation permitted.' : 'Payment verification did not pass.';
  if (verification.status === 'VERIFIED' && job.status === 0 && confirmer !== zeroAddress) {
    try {
      await reader.simulate(snapshot, verification.paymentRef);
      confirmationReady = true;
      readiness = 'Ready for authorized payment confirmation. Simulation only; nothing sent.';
    } catch {
      readiness = 'Confirmation preflight blocked or unavailable (including a used paymentRef). Do not send; refresh and investigate.';
    }
  }
  let confirmation: ConfirmationProof | null = null;
  let confirmationNotice = '';
  if (job.status === 1) {
    try {
      confirmation = await reader.confirmation(snapshot, input.confirmationTransactionHash);
      if (!confirmation) confirmationNotice = 'Paid read from registry; receipt not found in recent blocks. Supply the confirmation hash and refresh.';
    } catch {
      confirmationNotice = 'Paid read from registry; confirmation receipt unavailable or mismatched. Check the hash and refresh; do not resend.';
    }
  } else if (input.confirmationTransactionHash) {
    // A submitted hash is an uncertainty marker, not permission to send again.
    confirmationReady = false;
    readiness = 'Confirmation hash supplied, but registry is still Created at this block. Inspect the transaction and refresh; do not resend.';
  }
  const prepared = action === 'prepare' && confirmationReady ? {
    chainId: FUJI_CHAIN_ID, to: phase3Run.registry, from: confirmer, value: '0',
    functionName: 'confirmPayment' as const, jobId: input.jobId, paymentRef: input.paymentTransactionHash,
    data: encodeFunctionData({ abi: registryWriteAbi, functionName: 'confirmPayment', args: [3n, input.paymentTransactionHash] }),
    // A placeholder account alias is intentional. No signer identity is loaded.
    command: `cast send ${phase3Run.registry} 'confirmPayment(uint256,bytes32)' 3 ${input.paymentTransactionHash} --rpc-url ${phase3Run.rpcUrl} --chain 43113 --from ${confirmer} --account YOUR_EXISTING_ENCRYPTED_ACCOUNT --value 0 --async`,
  } : null;
  return {
    jobId: input.jobId, registry: phase3Run.registry, chainId: FUJI_CHAIN_ID,
    observedBlock: snapshot.blockNumber.toString(), registryStatus: job.status === 0 ? 'Created' as const : 'Paid' as const,
    buyer: job.buyer, seller: job.seller, taskHash: job.taskHash, paymentConfirmer: confirmer,
    paymentRef: job.paymentRef, resultHash: job.resultHash, expectedAmountWei: DEMO_PAYMENT_WEI.toString(),
    verification, evidence: { transaction: tx ? { hash: tx.hash, chainId: tx.chainId ?? null,
      blockHash: tx.blockHash, from: tx.from, to: tx.to, valueWei: tx.value.toString() } : null,
      receipt: receipt ? { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash, status: receipt.status } : null },
    confirmationReady, readiness, prepared, confirmation, confirmationNotice,
    sellerStats: statsJson(snapshot.stats), expectedConfirmationDelta: { paidJobs: '1', successfulJobs: '0', failedJobs: '0' },
  };
}
