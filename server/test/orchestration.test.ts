import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, zeroHash, type Address, type Hash } from 'viem';
import { E2EPlanner, DEMO_PAYMENT_WEI, hashTask, serviceEvidence, outcomeStatus, RegistryStatus, type RuntimeConfig, type WeatherTask } from '../src/orchestration';
import { sellers, callMockSeller } from '../src/service';
import { registryWriteAbi } from '../src/registryAbi';
import { type createRegistryReader } from '../src/avalanche';
import { type PaymentClient } from '../src/payment';
const buyer = `0x${'11'.repeat(20)}` as Address;
const seller = `0x${'22'.repeat(20)}` as Address;
const registry = `0x${'33'.repeat(20)}` as Address;
const txHash = `0x${'44'.repeat(32)}` as Hash;
const blockHash = `0x${'55'.repeat(32)}` as Hash;
const config: RuntimeConfig = { registryAddress: registry, buyer, paymentConfirmer: buyer, validator: buyer,
  sellerAddresses: { 'seller-a': seller }, paymentAmountWei: DEMO_PAYMENT_WEI };
const task: WeatherTask = { serviceType: 'weather', city: 'Sydney', sellerId: 'seller-a', sellerAddress: seller, maxResponseTimeMs: 1000, paymentAmountWei: DEMO_PAYMENT_WEI };
const plan = () => new E2EPlanner(config, 'Sydney', 1000, sellers);
function payment(value = DEMO_PAYMENT_WEI): PaymentClient {
  return { getChainId: async () => 43113,
    getTransaction: async () => ({ hash: txHash, blockHash, chainId: 43113, from: buyer, to: seller, value }),
    getTransactionReceipt: async () => ({ transactionHash: txHash, blockHash, status: 'success' }) };
}
function reader(p: E2EPlanner, status: RegistryStatus = RegistryStatus.Created): ReturnType<typeof createRegistryReader> {
  return { getJob: async () => ({ buyer, seller, taskHash: p.snapshot.taskHash,
    paymentRef: status === RegistryStatus.Created ? zeroHash : txHash,
    resultHash: status >= RegistryStatus.Success ? p.snapshot.evidence!.resultHash : zeroHash,
    createdAt: 1n, completedAt: status >= RegistryStatus.Success ? 2n : 0n, status }),
    getSellerStats: async () => ({ paidJobs: 1n, successfulJobs: status === RegistryStatus.Success ? 1n : 0n, failedJobs: status === RegistryStatus.Failure ? 1n : 0n }),
    getPaymentConfirmer: async () => buyer, getValidator: async () => buyer };
}
async function paid(p: E2EPlanner) {
  await p.observeJobCreated(reader(p), 1n);
  await p.verifyPayment(payment(), txHash);
  await p.observePaymentConfirmed(reader(p, RegistryStatus.Paid));
}
test('task hash is stable across object key ordering', () => {
  const reordered = { paymentAmountWei: task.paymentAmountWei, maxResponseTimeMs: task.maxResponseTimeMs,
    sellerAddress: task.sellerAddress, sellerId: task.sellerId, city: task.city, serviceType: task.serviceType };
  assert.equal(hashTask(task), hashTask(reordered));
  assert.match(hashTask(task), /^0x[0-9a-f]{64}$/);
});
for (const [name, change] of Object.entries({ city: { city: 'Melbourne' }, seller: { sellerAddress: buyer },
  sellerId: { sellerId: 'seller-b' }, amount: { paymentAmountWei: DEMO_PAYMENT_WEI + 1n }, sla: { maxResponseTimeMs: 999 } })) {
  test(`task hash binds ${name}`, () => assert.notEqual(hashTask(task), hashTask({ ...task, ...change })));
}
test('result hash binds exact body, HTTP status, timing, and validation threshold', () => {
  const response = callMockSeller(sellers[0]!, 'Sydney');
  const hash = serviceEvidence(response, 1000).resultHash;
  for (const change of [{ body: response.body + ' ' }, { status: 500 }, { responseTimeMs: 11 }]) {
    assert.notEqual(hash, serviceEvidence({ ...response, ...change }, 1000).resultHash);
  }
  assert.notEqual(hash, serviceEvidence(response, 5).resultHash);
  assert.equal(hash, serviceEvidence({ ...response }, 1000).resultHash);
});
test('success and malformed response have different hashes', () => {
  assert.notEqual(serviceEvidence(callMockSeller(sellers[0]!, 'Sydney', 'success'), 1000).resultHash,
    serviceEvidence(callMockSeller(sellers[0]!, 'Sydney', 'failure'), 1000).resultHash);
});
test('SUCCESS maps to Solidity Status.Success = 2', () => assert.equal(outcomeStatus('SUCCESS'), 2));
test('FAILURE maps to Solidity Status.Failure = 3', () => assert.equal(outcomeStatus('FAILURE'), 3));
test('createJob preparation has correct target, buyer, arguments and encoded data; does not advance stage', () => {
  const p = plan(); const call = p.prepareCreateJob();
  assert.equal(call.address, registry); assert.equal(call.account, buyer); assert.equal(call.chainId, 43113); assert.equal(call.value, 0n);
  assert.equal(call.status, 'PREPARED'); assert.equal(call.functionName, 'createJob');
  assert.deepEqual(call.args, [seller, hashTask(task)]);
  assert.deepEqual(decodeFunctionData({ abi: registryWriteAbi, data: call.data }), { functionName: 'createJob', args: call.args });
  assert.equal(p.snapshot.stage, 'PLANNED');
});
test('verified payment prepares confirmPayment with original transaction hash', async () => {
  const p = plan(); await p.observeJobCreated(reader(p), 1n);
  await p.verifyPayment(payment(), txHash);
  const call = p.prepareConfirmPayment();
  assert.deepEqual(call.args, [1n, txHash]); assert.equal(call.account, buyer);
  assert.deepEqual(decodeFunctionData({ abi: registryWriteAbi, data: call.data }), { functionName: 'confirmPayment', args: call.args });
  assert.equal(p.snapshot.stage, 'PAYMENT_VERIFIED');
});
test('rejected underpayment never prepares confirmation and retains JOB_CREATED', async () => {
  const p = plan(); await p.observeJobCreated(reader(p), 1n);
  assert.equal((await p.verifyPayment(payment(DEMO_PAYMENT_WEI - 1n), txHash)).status, 'REJECTED');
  assert.equal(p.snapshot.stage, 'JOB_CREATED'); assert.throws(() => p.prepareConfirmPayment());
});
test('invalid ordering is rejected', async () => {
  const p = plan(); assert.throws(() => p.prepareConfirmPayment()); assert.throws(() => p.prepareOutcome());
  await assert.rejects(p.verifyPayment(payment(), txHash));
  await assert.rejects(p.observePaymentConfirmed(reader(p, RegistryStatus.Paid)));
  await assert.rejects(p.executeService(() => callMockSeller(sellers[0]!, 'Sydney')));
  await assert.rejects(p.observeFinalized(reader(p)));
  await p.observeJobCreated(reader(p), 1n); await p.verifyPayment(payment(), txHash);
  assert.throws(() => p.prepareOutcome());
  await assert.rejects(p.executeService(() => callMockSeller(sellers[0]!, 'Sydney')));
});
for (const scenario of ['success', 'failure'] as const) {
  test(`${scenario} E2E prepares real recordOutcome order and finalizes only after matching read`, async () => {
    const p = plan(); await paid(p);
    assert.equal(p.snapshot.stage, 'PAYMENT_CONFIRMED');
    await p.executeService((s, city) => callMockSeller(s, city, scenario));
    assert.equal(p.snapshot.stage, 'SERVICE_EXECUTED');
    const call = p.prepareOutcome(); const status = scenario === 'success' ? 2 : 3;
    assert.deepEqual(call.args, [1n, status, p.snapshot.evidence!.resultHash]);
    assert.deepEqual(decodeFunctionData({ abi: registryWriteAbi, data: call.data }), { functionName: 'recordOutcome', args: call.args });
    assert.equal(p.snapshot.stage, 'OUTCOME_READY');
    await assert.rejects(p.observeFinalized(reader(p, RegistryStatus.Paid)));
    assert.equal(p.snapshot.stage, 'OUTCOME_READY');
    await p.observeFinalized(reader(p, status));
    assert.equal(p.snapshot.stage, 'FINALIZED'); assert.equal(p.snapshot.final!.sellerStats.paidJobs, 1n);
  });
}
test('mismatched registry evidence does not advance stage', async () => {
  const p = plan(); const r = reader(p); const job = await r.getJob(1n);
  for (const change of [{ buyer: seller }, { seller: buyer }, { taskHash: txHash }, { status: 1 }]) {
    await assert.rejects(p.observeJobCreated({ ...r, getJob: async () => ({ ...job, ...change }) }, 1n));
    assert.equal(p.snapshot.stage, 'PLANNED');
  }
  await p.observeJobCreated(r, 1n); await p.verifyPayment(payment(), txHash);
  const pr = reader(p, RegistryStatus.Paid); const pj = await pr.getJob(1n);
  await assert.rejects(p.observePaymentConfirmed({ ...pr, getJob: async () => ({ ...pj, paymentRef: blockHash }) }));
  assert.equal(p.snapshot.stage, 'PAYMENT_VERIFIED');
});
test('snapshots and runtime config cannot mutate committed terms', () => {
  const local = { ...config, sellerAddresses: { ...config.sellerAddresses } }; const p = new E2EPlanner(local, 'Sydney', 1000, sellers);
  local.sellerAddresses['seller-a'] = buyer; p.snapshot.task.paymentAmountWei = 1n;
  assert.equal(p.snapshot.taskHash, hashTask(task));
});
test('failed execution leaves payment confirmed and cannot prepare outcome', async () => {
  const p = plan(); await paid(p);
  await assert.rejects(p.executeService(() => { throw new Error('transport unavailable'); }));
  assert.equal(p.snapshot.stage, 'PAYMENT_CONFIRMED'); assert.throws(() => p.prepareOutcome());
});
test('invalid task terms and missing seller mapping are rejected', () => {
  assert.throws(() => hashTask({ ...task, paymentAmountWei: 0n }));
  assert.throws(() => hashTask({ ...task, maxResponseTimeMs: NaN }));
  assert.throws(() => new E2EPlanner({ ...config, sellerAddresses: {} }, 'Sydney', 1000, sellers));
});
