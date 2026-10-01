import { encodeFunctionData, keccak256, toHex, zeroHash, type Address } from 'viem';
import { FUJI_CHAIN_ID, type createRegistryReader } from './avalanche';
import { registryWriteAbi } from './registryAbi';
import { verifyNativeAvaxPayment, type PaymentClient, type PaymentResult } from './payment';
import { selectSeller, validateSla, type Seller, type Policy, type ServiceResponse } from './service';

import { hashTask, taskAddress as address, type WeatherTask } from './task';
export { canonicalTask, hashTask, DEMO_PAYMENT_WEI, type WeatherTask } from './task';
export enum RegistryStatus { Created, Paid, Success, Failure }
export type Stage = 'PLANNED' | 'JOB_CREATED' | 'PAYMENT_VERIFIED' | 'PAYMENT_CONFIRMED' | 'SERVICE_EXECUTED' | 'OUTCOME_READY' | 'FINALIZED';
export interface RuntimeConfig {
  registryAddress: string;
  buyer: string;
  paymentConfirmer: string;
  validator: string;
  sellerAddresses: Readonly<Record<string, string>>;
  paymentAmountWei: bigint;
}
export function serviceEvidence(response: ServiceResponse, maxResponseTimeMs: number) {
  if (!Number.isInteger(response.status) || typeof response.body !== 'string' || !Number.isFinite(response.responseTimeMs) || response.responseTimeMs < 0) throw new Error('Invalid service evidence');
  const validation = validateSla(response, maxResponseTimeMs);
  const canonical = JSON.stringify(['apos.result.v1', response.status, response.body, response.responseTimeMs,
    validation.result, validation.scope, validation.maxResponseTimeMs, validation.checks.map(c => [c.id, c.passed])]);
  return { response: { ...response }, validation, canonical, resultHash: keccak256(toHex(canonical)) };
}
export function outcomeStatus(result: 'SUCCESS' | 'FAILURE'): RegistryStatus.Success | RegistryStatus.Failure {
  if (result === 'SUCCESS') return RegistryStatus.Success;
  if (result === 'FAILURE') return RegistryStatus.Failure;
  throw new Error('Invalid outcome');
}
type Reader = ReturnType<typeof createRegistryReader>;
type Job = Awaited<ReturnType<Reader['getJob']>>;
type Stats = Awaited<ReturnType<Reader['getSellerStats']>>;

/** In-memory planner. Inject a reader bound to config.registryAddress on Fuji.
 * No wallet, submission, or automatic network client initialization. */
export class E2EPlanner {
  #stage: Stage = 'PLANNED';
  #config;
  #task: WeatherTask;
  #seller: Seller;
  #jobId?: bigint;
  #payment?: PaymentResult;
  #evidence?: ReturnType<typeof serviceEvidence>;
  #final?: { job: Job; sellerStats: Stats };
  #busy = false;
  constructor(config: RuntimeConfig, city: string, maxResponseTimeMs: number, candidates: readonly Seller[], requirements?: Policy) {
    const seller = selectSeller(candidates, requirements);
    if (!seller) throw new Error('No eligible seller');
    this.#seller = { ...seller };
    this.#config = { registryAddress: address(config.registryAddress), buyer: address(config.buyer),
      paymentConfirmer: address(config.paymentConfirmer), validator: address(config.validator) };
    this.#task = { serviceType: 'weather', city, maxResponseTimeMs, sellerId: seller.id,
      sellerAddress: address(config.sellerAddresses[seller.id] ?? ''), paymentAmountWei: config.paymentAmountWei };
    hashTask(this.#task);
  }
  get snapshot() { return structuredClone({ stage: this.#stage, task: this.#task, taskHash: hashTask(this.#task),
    jobId: this.#jobId, payment: this.#payment, evidence: this.#evidence, final: this.#final }); }
  #require(stage: Stage) {
    if (this.#busy || this.#stage !== stage) throw new Error(`Expected ${stage}; current ${this.#stage}`);
  }
  async #operation<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
    this.#require(stage); this.#busy = true;
    try { return await operation(); } finally { this.#busy = false; }
  }
  #base(account: Address) { return { status: 'PREPARED' as const, chainId: FUJI_CHAIN_ID, address: this.#config.registryAddress, account, value: 0n }; }
  prepareCreateJob() {
    this.#require('PLANNED');
    const args = [address(this.#task.sellerAddress), hashTask(this.#task)] as const;
    return { ...this.#base(this.#config.buyer), functionName: 'createJob' as const, args,
      data: encodeFunctionData({ abi: registryWriteAbi, functionName: 'createJob', args }) };
  }
  #match(job: Job, status: RegistryStatus) {
    if (address(job.buyer) !== this.#config.buyer || address(job.seller) !== this.#task.sellerAddress ||
      job.taskHash.toLowerCase() !== hashTask(this.#task) || job.status !== status || job.createdAt <= 0n) throw new Error('Registry job does not match plan');
  }
  async observeJobCreated(reader: Reader, jobId: bigint) {
    return this.#operation('PLANNED', async () => {
      if (jobId <= 0n) throw new Error('Invalid job ID');
      const job = await reader.getJob(jobId); this.#match(job, RegistryStatus.Created);
      if (job.paymentRef !== zeroHash || job.resultHash !== zeroHash || job.completedAt !== 0n) throw new Error('Invalid created job');
      this.#jobId = jobId; this.#stage = 'JOB_CREATED';
    });
  }
  async verifyPayment(client: PaymentClient, transactionHash: string) {
    return this.#operation('JOB_CREATED', async () => {
      const result = await verifyNativeAvaxPayment(client, { transactionHash, expectedBuyer: this.#config.buyer,
        expectedSeller: this.#task.sellerAddress, minimumAmountWei: this.#task.paymentAmountWei });
      this.#payment = result;
      if (result.status === 'VERIFIED') this.#stage = 'PAYMENT_VERIFIED';
      return structuredClone(result);
    });
  }
  prepareConfirmPayment() {
    this.#require('PAYMENT_VERIFIED');
    if (this.#payment?.status !== 'VERIFIED') throw new Error('Payment is not verified');
    const args = [this.#jobId!, this.#payment.transactionHash] as const;
    return { ...this.#base(this.#config.paymentConfirmer), functionName: 'confirmPayment' as const, args,
      data: encodeFunctionData({ abi: registryWriteAbi, functionName: 'confirmPayment', args }) };
  }
  async observePaymentConfirmed(reader: Reader) {
    return this.#operation('PAYMENT_VERIFIED', async () => {
      const job = await reader.getJob(this.#jobId!); this.#match(job, RegistryStatus.Paid);
      if (job.paymentRef.toLowerCase() !== this.#payment!.transactionHash || job.resultHash !== zeroHash || job.completedAt !== 0n) throw new Error('Payment confirmation mismatch');
      this.#stage = 'PAYMENT_CONFIRMED';
    });
  }
  async executeService(execute: (seller: Seller, city: string) => Promise<ServiceResponse> | ServiceResponse) {
    return this.#operation('PAYMENT_CONFIRMED', async () => {
      const response = await execute({ ...this.#seller }, this.#task.city);
      this.#evidence = serviceEvidence(response, this.#task.maxResponseTimeMs);
      this.#stage = 'SERVICE_EXECUTED';
    });
  }
  prepareOutcome() {
    if (this.#stage !== 'OUTCOME_READY') this.#require('SERVICE_EXECUTED');
    else this.#require('OUTCOME_READY');
    const evidence = this.#evidence!;
    const args = [this.#jobId!, outcomeStatus(evidence.validation.result), evidence.resultHash] as const;
    const prepared = { ...this.#base(this.#config.validator), functionName: 'recordOutcome' as const, args,
      data: encodeFunctionData({ abi: registryWriteAbi, functionName: 'recordOutcome', args }) };
    this.#stage = 'OUTCOME_READY';
    return prepared;
  }
  async observeFinalized(reader: Reader) {
    return this.#operation('OUTCOME_READY', async () => {
      const job = await reader.getJob(this.#jobId!);
      this.#match(job, outcomeStatus(this.#evidence!.validation.result));
      if (job.paymentRef.toLowerCase() !== this.#payment!.transactionHash || job.resultHash.toLowerCase() !== this.#evidence!.resultHash || job.completedAt < job.createdAt) throw new Error('Final outcome mismatch');
      const sellerStats = await reader.getSellerStats(address(this.#task.sellerAddress));
      this.#final = { job, sellerStats }; this.#stage = 'FINALIZED';
    });
  }
}
