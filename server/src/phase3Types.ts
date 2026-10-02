// Public wire schema only. No server runtime imports in the browser dependency graph.
import type { Address, Hash } from 'viem';

export type Phase3Action = 'verify' | 'prepare' | 'refresh';
type Counters = { paidJobs: string; successfulJobs: string; failedJobs: string };
export type ConfirmationProof = {
  transactionHash: Hash; blockNumber: string; receiptStatus: 'success';
  previousRegistryStatus: 'Created'; registryStatus: 'Paid';
  before: Counters; after: Counters; countersMatchExpectedDelta: boolean;
};
export type Phase3Evidence = {
  jobId: string; registry: Address; chainId: number; observedBlock: string;
  registryStatus: 'Created' | 'Paid'; buyer: Address; seller: Address;
  taskHash: Hash; paymentConfirmer: Address; paymentRef: Hash; resultHash: Hash;
  expectedAmountWei: string;
  verification: { status: 'VERIFIED' | 'REJECTED'; transactionHash: Hash; paymentRef: Hash | null;
    checks: Record<'networkMatches' | 'transactionMatches' | 'transactionSucceeded' |
      'buyerMatches' | 'sellerMatches' | 'amountSufficient', boolean> };
  evidence: {
    transaction: { hash: Hash; chainId: number | null; blockHash: Hash | null;
      from: Address; to: Address | null; valueWei: string } | null;
    receipt: { transactionHash: Hash; blockHash: Hash; status: 'success' | 'reverted' } | null;
  };
  confirmationReady: boolean; readiness: string;
  prepared: { chainId: number; to: Address; from: Address; value: string;
    functionName: 'confirmPayment'; jobId: string; paymentRef: Hash; data: Hash; command: string } | null;
  confirmation: ConfirmationProof | null; confirmationNotice: string;
  sellerStats: Counters; expectedConfirmationDelta: Counters;
};
