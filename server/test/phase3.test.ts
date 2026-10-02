import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiItem, zeroAddress, zeroHash, type Hash } from 'viem';
import { inspectPhase3, parsePhase3Input, phase3Run, type Phase3Reader, type Phase3Snapshot } from '../src/phase3';
import { createPhase3Reader } from '../src/phase3Rpc';
import { runPhase3Prepare } from '../src/phase3Prepare';
import { createApiServer } from '../src/http';
import { registryWriteAbi } from '../src/registryAbi';

const input = { jobId: '3', paymentTransactionHash: phase3Run.paymentHash };
const blockHash = `0x${'ab'.repeat(32)}` as Hash;
const confirmationHash = `0x${'cd'.repeat(32)}` as Hash;
const taskHash = '0xe9cddd83f03f2ffa8a7748045a0447f74b1d71ea153de5387609be3bbd651cc5';
function fixture() {
  const snapshot: Phase3Snapshot = { blockNumber: 100n, confirmer: phase3Run.seller,
    job: { buyer: phase3Run.buyer, seller: phase3Run.seller, taskHash, paymentRef: zeroHash,
      resultHash: zeroHash, createdAt: 10n, completedAt: 0n, status: 0 },
    stats: { paidJobs: 2n, successfulJobs: 1n, failedJobs: 1n } };
  const tx = { hash: phase3Run.paymentHash as Hash, blockHash: blockHash as Hash | null, chainId: 43113,
    from: phase3Run.buyer as string, to: phase3Run.seller as string | null, value: 1_000_000_000_000n };
  const receipt = { transactionHash: phase3Run.paymentHash as Hash, blockHash, status: 'success' as 'success' | 'reverted' };
  let chain = 43113; let simulations = 0; let duplicate = false;
  const reader: Phase3Reader = {
    payment: { getChainId: async () => chain,
      getTransaction: async () => tx as Awaited<ReturnType<Phase3Reader['payment']['getTransaction']>>,
      getTransactionReceipt: async () => receipt },
    snapshot: async () => structuredClone(snapshot),
    simulate: async (observed, paymentRef) => {
      simulations++;
      assert.equal(observed.job.status, 0); assert.equal(paymentRef, phase3Run.paymentHash);
      if (duplicate) throw new Error('PaymentReferenceAlreadyUsed');
    },
    confirmation: async () => null,
  };
  return { reader, snapshot, tx, receipt, simulations: () => simulations,
    chain: (value: number) => { chain = value; }, duplicate: () => { duplicate = true; } };
}
test('registry values supply verifier expectations; verification alone returns no operator call and changes no state', async () => {
  const f = fixture(); const before = structuredClone(f.snapshot);
  // Checksummed RPC values differ in representation from allowlist constants.
  f.snapshot.job.buyer = phase3Run.buyer.toLowerCase() as typeof phase3Run.buyer;
  const result = await inspectPhase3(f.reader, input, 'verify');
  assert.equal(result.buyer, f.snapshot.job.buyer);
  assert.equal(result.verification.status, 'VERIFIED');
  assert.equal(Object.values(result.verification.checks).filter(Boolean).length, 6);
  assert.equal(result.confirmationReady, true); assert.equal(result.prepared, null);
  assert.equal(f.snapshot.job.status, 0); assert.deepEqual(f.snapshot.stats, before.stats);
  assert.deepEqual(result.expectedConfirmationDelta, { paidJobs: '1', successfulJobs: '0', failedJobs: '0' });
  assert.throws(() => parsePhase3Input({ ...input, buyer: phase3Run.seller }));
  assert.throws(() => parsePhase3Input({ ...input, seller: phase3Run.buyer, value: '1' }));
});
for (const condition of ['wrong sender', 'wrong recipient', 'insufficient value', 'failed receipt', 'wrong tx chain',
  'wrong tx hash', 'wrong receipt hash', 'missing block', 'wrong block']) {
  test(`existing verifier rejects ${condition}, never prepares confirmation`, async () => {
    const f = fixture();
    if (condition === 'wrong sender') f.tx.from = phase3Run.seller;
    if (condition === 'wrong recipient') f.tx.to = phase3Run.buyer;
    if (condition === 'insufficient value') f.tx.value--;
    if (condition === 'failed receipt') f.receipt.status = 'reverted';
    if (condition === 'wrong tx chain') f.tx.chainId = 1;
    if (condition === 'wrong tx hash') f.tx.hash = blockHash;
    if (condition === 'wrong receipt hash') f.receipt.transactionHash = blockHash;
    if (condition === 'missing block') f.tx.blockHash = null;
    if (condition === 'wrong block') f.receipt.blockHash = confirmationHash;
    const result = await inspectPhase3(f.reader, input, 'prepare');
    assert.equal(result.verification.status, 'REJECTED');
    assert.equal(result.prepared, null); assert.equal(result.confirmationReady, false);
    assert.equal(f.simulations(), 0);
  });
}
test('preserves at-least-minimum semantics', async () => {
  const f = fixture(); f.tx.value++;
  assert.equal((await inspectPhase3(f.reader, input, 'verify')).verification.status, 'VERIFIED');
});
test('rejects wrong requested tx hash, zero paymentRef, wrong job ID and wrong RPC chain', async () => {
  const f = fixture();
  for (const raw of [{ ...input, paymentTransactionHash: zeroHash }, { ...input, paymentTransactionHash: blockHash }, { ...input, jobId: '2' }]) {
    await assert.rejects(inspectPhase3(f.reader, raw, 'prepare'));
  }
  f.chain(1); await assert.rejects(inspectPhase3(f.reader, input, 'verify'));
  assert.equal(f.simulations(), 0);
});
for (const condition of ['missing job', 'buyer', 'seller', 'taskHash', 'outcome', 'non-Created', 'used reference']) {
  test(`registry guard rejects ${condition}`, async () => {
    const f = fixture();
    if (condition === 'missing job') f.snapshot.job.createdAt = 0n;
    if (condition === 'buyer') f.snapshot.job.buyer = phase3Run.seller;
    if (condition === 'seller') f.snapshot.job.seller = phase3Run.buyer;
    if (condition === 'taskHash') f.snapshot.job.taskHash = blockHash;
    if (condition === 'outcome') f.snapshot.job.resultHash = blockHash;
    if (condition === 'non-Created') f.snapshot.job.status = 2;
    if (condition === 'used reference') f.snapshot.job.paymentRef = blockHash;
    await assert.rejects(inspectPhase3(f.reader, input, 'prepare'));
    assert.equal(f.simulations(), 0);
  });
}
test('duplicate reference and unavailable preflight never yield a prepared command', async () => {
  const f = fixture(); f.duplicate();
  const result = await inspectPhase3(f.reader, input, 'prepare');
  assert.equal(result.verification.status, 'VERIFIED');
  assert.equal(result.confirmationReady, false); assert.equal(result.prepared, null);
  assert.match(result.readiness, /blocked or unavailable/);
});
test('zero confirmer cannot prepare; authorized command is zero-value and has no password option', async () => {
  const f = fixture();
  const result = await inspectPhase3(f.reader, input, 'prepare');
  assert.equal(result.prepared?.from, f.snapshot.confirmer);
  assert.equal(result.prepared?.value, '0'); assert.equal(result.prepared?.paymentRef, phase3Run.paymentHash);
  assert.match(result.prepared!.command, /--account YOUR_EXISTING_ENCRYPTED_ACCOUNT/);
  assert.doesNotMatch(result.prepared!.command, /--password|--private-key|--unlocked/);
  f.snapshot.confirmer = zeroAddress;
  assert.equal((await inspectPhase3(f.reader, input, 'prepare')).prepared, null);
});
test('fresh prepare rechecks state; already Paid recovers and never simulates/reconfirms', async () => {
  const f = fixture();
  await inspectPhase3(f.reader, input, 'verify');
  f.snapshot.job.status = 1; f.snapshot.job.paymentRef = phase3Run.paymentHash; f.snapshot.stats.paidJobs++;
  const result = await inspectPhase3(f.reader, input, 'prepare');
  assert.equal(result.registryStatus, 'Paid'); assert.equal(result.prepared, null);
  assert.equal(result.confirmationReady, false); assert.equal(f.simulations(), 1);
  assert.deepEqual(result.sellerStats, { paidJobs: '3', successfulJobs: '1', failedJobs: '1' });
});
test('uncertain submitted hash blocks a new handoff even while registry reads Created', async () => {
  const f = fixture();
  const result = await inspectPhase3(f.reader, { ...input, confirmationTransactionHash: confirmationHash }, 'prepare');
  assert.equal(result.prepared, null); assert.equal(result.confirmationReady, false);
  assert.match(result.readiness, /do not resend/);
});
test('Paid with a receipt lookup timeout remains Paid with recovery warning, not ready', async () => {
  const f = fixture(); f.snapshot.job.status = 1; f.snapshot.job.paymentRef = phase3Run.paymentHash;
  f.reader.confirmation = async () => { throw new Error('Timeout'); };
  const result = await inspectPhase3(f.reader, { ...input, confirmationTransactionHash: confirmationHash }, 'refresh');
  assert.equal(result.registryStatus, 'Paid'); assert.equal(result.confirmation, null);
  assert.equal(result.confirmationReady, false); assert.match(result.confirmationNotice, /do not resend/);
});
test('RPC failure propagates; operator CLI emits generic failure and no command', async () => {
  const f = fixture(); f.reader.snapshot = async () => { throw new Error('Do not echo transport details'); };
  const out: string[] = []; const errors: string[] = [];
  assert.equal(await runPhase3Prepare(f.reader, text => out.push(text), text => errors.push(text)), 1);
  assert.deepEqual(out, []); assert.doesNotMatch(errors.join(''), /transport details/);
});

// Exercise the production RPC adapter's receipt/event/readback validation offline.
function rpcFixture() {
  const f = fixture(); const calls: string[] = [];
  const event = parseAbiItem('event PaymentConfirmed(uint256 indexed jobId, bytes32 paymentRef)');
  const receipt = { transactionHash: confirmationHash, status: 'success', blockHash, blockNumber: 99n,
    logs: [{ address: phase3Run.registry, topics: encodeEventTopics({ abi: [event], eventName: 'PaymentConfirmed', args: { jobId: 3n } }),
      data: encodeAbiParameters([{ type: 'bytes32' }], [phase3Run.paymentHash]) }] };
  const tx = { hash: confirmationHash, chainId: 43113, blockHash, from: f.snapshot.confirmer,
    to: phase3Run.registry, value: 0n, input: encodeFunctionData({ abi: registryWriteAbi, functionName: 'confirmPayment', args: [3n, phase3Run.paymentHash] }) };
  let extraOutcome = false;
  const client = {
    getBlockNumber: async () => 100n,
    readContract: async (args: { functionName: string; blockNumber: bigint }) => {
      calls.push(args.functionName);
      if (args.functionName === 'paymentConfirmer') return f.snapshot.confirmer;
      if (args.functionName === 'sellerStats') return args.blockNumber < 99n ? [2n, 1n, 1n] : [3n, extraOutcome ? 2n : 1n, 1n];
      if (args.functionName === 'getJob') return { ...f.snapshot.job, status: args.blockNumber < 99n ? 0 : 1,
        paymentRef: args.blockNumber < 99n ? zeroHash : phase3Run.paymentHash };
      throw new Error('Unexpected method');
    },
    getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
    getLogs: async () => [{ args: { paymentRef: phase3Run.paymentHash }, transactionHash: confirmationHash }],
    simulateContract: async (args: { account: string; functionName: string; args: unknown[]; blockNumber: bigint }) => {
      assert.equal(args.account, f.snapshot.confirmer); assert.equal(args.functionName, 'confirmPayment');
      assert.deepEqual(args.args, [3n, phase3Run.paymentHash]); assert.equal(args.blockNumber, 100n);
      calls.push('simulateContract');
    },
  } as unknown as Parameters<typeof createPhase3Reader>[0];
  return { reader: createPhase3Reader(client), snapshot: f.snapshot, tx, receipt, calls, extraOutcome: () => { extraOutcome = true; } };
}
test('RPC adapter recovers event hash, authenticates receipt and proves Created → Paid and counter delta', async () => {
  const f = rpcFixture();
  const proof = await f.reader.confirmation(f.snapshot);
  assert.equal(proof?.transactionHash, confirmationHash); assert.equal(proof?.previousRegistryStatus, 'Created');
  assert.equal(proof?.registryStatus, 'Paid'); assert.equal(proof?.countersMatchExpectedDelta, true);
  assert.deepEqual(proof?.after, { paidJobs: '3', successfulJobs: '1', failedJobs: '1' });
  await f.reader.simulate(f.snapshot, phase3Run.paymentHash);
  assert.ok(f.calls.includes('simulateContract'));
  assert.ok(f.calls.every(call => ['getJob', 'sellerStats', 'paymentConfirmer', 'simulateContract'].includes(call)));
});
for (const condition of ['wrong sender', 'wrong calldata', 'reverted', 'missing event', 'wrong receipt hash']) {
  test(`confirmation recovery rejects ${condition}`, async () => {
    const f = rpcFixture();
    if (condition === 'wrong sender') f.tx.from = phase3Run.buyer;
    if (condition === 'wrong calldata') f.tx.input = '0x';
    if (condition === 'reverted') f.receipt.status = 'reverted';
    if (condition === 'missing event') f.receipt.logs = [];
    if (condition === 'wrong receipt hash') f.receipt.transactionHash = blockHash;
    await assert.rejects(f.reader.confirmation(f.snapshot, confirmationHash));
  });
}
test('concurrent aggregate outcome changes are not attributed to this payment', async () => {
  const f = rpcFixture(); f.extraOutcome();
  assert.equal((await f.reader.confirmation(f.snapshot))?.countersMatchExpectedDelta, false);
});
test('API exposes only bounded public-input reads, no automatic confirmation and no raw errors', async t => {
  const f = fixture(); let requests = 0;
  const server = createApiServer(async (raw, action) => { requests++; return inspectPhase3(f.reader, raw, action); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/phase3/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('verify', input);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).prepared, null); assert.equal(f.snapshot.job.status, 0);
  assert.equal((await post('verify', { ...input, password: 'not-a-real-credential' })).status, 400);
  assert.equal((await post('verify', { ...input, extra: 'x'.repeat(2000) })).status, 400);
  assert.equal((await post('confirm', input)).status, 404); assert.equal(requests, 1);
  f.reader.snapshot = async () => { throw new Error('transport details'); };
  const failed = await post('refresh', input); assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /transport details/);
});
