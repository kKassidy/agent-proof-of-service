// Public JSON shapes. No filesystem, RPC or signing code in this module.
import type { Address, Hash } from 'viem';
import type { ServiceResponse, validateSla } from './service';
export type Phase4Action = 'execute' | 'prepare' | 'refresh';
export type FrozenServiceEvidence = {
  version: 1; jobId: '3'; registry: Address; chainId: 43113; taskHash: Hash; paymentRef: Hash;
  scenario: 'DETERMINISTIC_FAULT_INJECTION'; transport: 'HTTP'; timing: 'MEASURED';
  response: ServiceResponse; validation: ReturnType<typeof validateSla>; canonical: string; resultHash: Hash;
};
type Counters = { paidJobs: string; successfulJobs: string; failedJobs: string };
export type OutcomeProof = {
  transactionHash: Hash; blockNumber: string; receiptStatus: 'success';
  previousRegistryStatus: 'Paid'; registryStatus: 'Failure';
  before: Counters; after: Counters; countersMatchExpectedDelta: boolean;
};
export type Phase4Evidence = {
  jobId: '3'; registryStatus: 'Paid' | 'Success' | 'Failure'; observedBlock: string;
  paymentRef: Hash; resultHash: Hash; validator: Address; paymentVerified: boolean;
  frozen: FrozenServiceEvidence | null; executionAttempted: boolean; canExecute: boolean;
  expectedFault: boolean; preparationReady: boolean; notice: string;
  prepared: { chainId: 43113; to: Address; from: Address; value: '0'; functionName: 'recordOutcome';
    jobId: '3'; outcome: number; resultHash: Hash; data: Hash; command: string } | null;
  outcomeProof: OutcomeProof | null; outcomeNotice: string; sellerStats: Counters;
};
