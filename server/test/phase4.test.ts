import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiItem, zeroAddress, zeroHash, type Hash } from 'viem';
import { executePhase4Seller, freezeServiceEvidence, inspectPhase4, phase4TaskHash, validateFrozenEvidence, type Phase4Reader, type Phase4Snapshot } from '../src/phase4';
import { createPhase4Store, type Phase4Store } from '../src/phase4Store';
import { createPhase4Reader } from '../src/phase4Rpc';
import { runPhase4Prepare } from '../src/phase4Prepare';
import { phase3Run } from '../src/phase3';
import { RegistryStatus, serviceEvidence } from '../src/orchestration';
import { registryWriteAbi } from '../src/registryAbi';
import { createApiServer } from '../src/http';
import type { ServiceResponse } from '../src/service';

const input = { jobId: '3' };
const blockHash = `0x${'ab'.repeat(32)}` as Hash;
const outcomeHash = `0x${'cd'.repeat(32)}` as Hash;
const response: ServiceResponse = { status: 200, body: '{"city":"Tokyo","condition":"clear"}', responseTimeMs: 17.125 };
function memoryStore(): Phase4Store {
  let frozen: unknown = null; let attempted = false;
  return { load: async () => structuredClone(frozen), attempted: async () => attempted,
    claim: async () => { if (attempted) return false; attempted = true; return true; },
    freeze: async value => { assert.equal(frozen, null); frozen = structuredClone(value); } };
}
function fixture(store = memoryStore()) {
  const snapshot: Phase4Snapshot = { blockNumber: 100n, validator: phase3Run.seller,
    job: { buyer: phase3Run.buyer, seller: phase3Run.seller, taskHash: phase4TaskHash, paymentRef: phase3Run.paymentHash,
      resultHash: zeroHash, createdAt: 10n, completedAt: 0n, status: RegistryStatus.Paid },
    stats: { paidJobs: 3n, successfulJobs: 1n, failedJobs: 1n } };
  let executes = 0; let simulations = 0; let chain = 43113;
  const reader: Phase4Reader = {
    payment: { getChainId: async () => chain,
      getTransaction: async () => ({ hash: phase3Run.paymentHash, blockHash, chainId: 43113,
        from: phase3Run.buyer, to: phase3Run.seller, value: 1_000_000_000_000n }),
      getTransactionReceipt: async () => ({ transactionHash: phase3Run.paymentHash, blockHash, status: 'success' }) },
    snapshot: async () => structuredClone(snapshot),
    simulate: async (observed, frozen) => { simulations++; assert.equal(observed.job.status, RegistryStatus.Paid); assert.notEqual(frozen.resultHash, zeroHash); },
    outcome: async () => null,
  };
  const execute = async () => { executes++; return { ...response }; };
  return { store, reader, snapshot, execute, executes: () => executes, simulations: () => simulations, chain: (value: number) => { chain = value; } };
}
const run = (f: ReturnType<typeof fixture>, action: 'execute' | 'prepare' | 'refresh', raw: unknown = input) => inspectPhase4(f.reader, f.store, raw, action, f.execute);
async function temporaryStore(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'phase4-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createPhase4Store(directory) };
}

test('refresh before execution performs reads only; explicit execution freezes actual validator/hash evidence without preparing', async () => {
  const f = fixture(); const before = structuredClone(f.snapshot);
  const first = await run(f, 'refresh'); assert.equal(first.canExecute, true); assert.equal(first.frozen, null);
  assert.equal(f.executes(), 0); assert.equal(f.simulations(), 0);
  const result = await run(f, 'execute');
  assert.equal(f.executes(), 1); assert.equal(f.simulations(), 0); assert.equal(result.prepared, null);
  assert.equal(result.expectedFault, true); assert.equal(result.preparationReady, true);
  assert.equal(result.frozen?.transport, 'HTTP'); assert.equal(result.frozen?.timing, 'MEASURED');
  assert.equal(result.frozen?.validation.result, 'FAILURE');
  assert.deepEqual(result.frozen?.validation.checks.map(c => [c.id, c.passed]), [
    ['httpStatus200', true], ['validJson', true], ['cityNonEmptyString', true],
    ['temperatureFiniteNumber', false], ['conditionNonEmptyString', true], ['responseTimeBelowThreshold', true],
  ]);
  assert.equal(result.frozen?.resultHash, serviceEvidence(response, 1000).resultHash);
  assert.equal(result.frozen?.canonical, serviceEvidence(response, 1000).canonical);
  assert.notEqual(result.frozen?.resultHash, '0x9e57fabdbce8dd1a18988c4816a10d47726534ac53477eaf0e0b96b964be4589');
  assert.deepEqual(f.snapshot, before);
});
for (const field of ['status', 'buyer', 'seller', 'taskHash', 'paymentRef', 'resultHash', 'missing job', 'completion']) {
  test(`canonical ${field} mismatch blocks execution and preparation`, async () => {
    const f = fixture();
    if (field === 'status') f.snapshot.job.status = RegistryStatus.Created;
    if (field === 'buyer') f.snapshot.job.buyer = phase3Run.seller;
    if (field === 'seller') f.snapshot.job.seller = phase3Run.buyer;
    if (field === 'taskHash') f.snapshot.job.taskHash = blockHash;
    if (field === 'paymentRef') f.snapshot.job.paymentRef = blockHash;
    if (field === 'resultHash') f.snapshot.job.resultHash = blockHash;
    if (field === 'missing job') f.snapshot.job.createdAt = 0n;
    if (field === 'completion') f.snapshot.job.completedAt = 20n;
    for (const action of ['execute', 'prepare'] as const) await assert.rejects(run(f, action));
    assert.equal(f.executes(), 0); assert.equal(f.simulations(), 0);
  });
}
test('wrong Fuji network and rejected original payment block new work', async () => {
  const f = fixture(); f.chain(1); await assert.rejects(run(f, 'execute'));
  f.chain(43113); f.reader.payment.getTransactionReceipt = async () => ({ transactionHash: phase3Run.paymentHash, blockHash, status: 'reverted' });
  assert.equal((await run(f, 'execute')).canExecute, false); assert.equal(f.executes(), 0);
});
test('refresh and repeated/concurrent Execute preserve one frozen run', async () => {
  const f = fixture();
  await Promise.all([run(f, 'execute'), run(f, 'execute')]);
  const first = await run(f, 'refresh'); const repeated = await run(f, 'execute');
  assert.equal(f.executes(), 1); assert.deepEqual(repeated.frozen, first.frozen);
  assert.notEqual(freezeServiceEvidence({ ...response, responseTimeMs: 18.125 }).resultHash, first.frozen?.resultHash);
});
test('frozen evidence survives server/store restart and cannot be overwritten', async t => {
  const { directory, store } = await temporaryStore(t); const f = fixture(store);
  const first = await run(f, 'execute');
  const restarted = fixture(createPhase4Store(directory));
  assert.deepEqual((await run(restarted, 'refresh')).frozen, first.frozen);
  await run(restarted, 'execute'); assert.equal(restarted.executes(), 0);
  await assert.rejects(store.freeze(freezeServiceEvidence({ ...response, responseTimeMs: 99 })));
  assert.equal(JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')).resultHash, first.frozen?.resultHash);
});
test('two filesystem claimers allow only one HTTP execution', async t => {
  const { directory } = await temporaryStore(t);
  const a = fixture(createPhase4Store(directory)); const b = fixture(createPhase4Store(directory));
  await Promise.all([run(a, 'execute'), run(b, 'execute')]);
  assert.equal(a.executes() + b.executes(), 1);
});
test('execution timeout retains intent across restart and never retries', async t => {
  const { directory, store } = await temporaryStore(t); const f = fixture(store); let calls = 0;
  await assert.rejects(inspectPhase4(f.reader, store, input, 'execute', async () => { calls++; throw new Error('Timeout'); }));
  const restarted = fixture(createPhase4Store(directory));
  const recovered = await run(restarted, 'execute');
  assert.equal(calls, 1); assert.equal(restarted.executes(), 0); assert.equal(recovered.canExecute, false);
  assert.match(recovered.notice, /without complete frozen evidence/);
});
test('failed claim persistence prevents HTTP; failed freeze prevents any rerun', async () => {
  const f = fixture(); f.store.claim = async () => { throw new Error('Disk failure'); };
  await assert.rejects(run(f, 'execute')); assert.equal(f.executes(), 0);
  const g = fixture(); g.store.freeze = async () => { throw new Error('Disk full'); };
  await assert.rejects(run(g, 'execute')); await run(g, 'execute'); assert.equal(g.executes(), 1);
  assert.equal((await run(g, 'prepare')).prepared, null);
});
for (const crash of ['intent only', 'partial pending', 'complete unpublished evidence', 'partial published evidence']) {
  test(`restart after ${crash} never regenerates evidence`, async t => {
    const { directory } = await temporaryStore(t);
    const path = crash === 'intent only' ? 'attempt.json' : crash === 'partial published evidence' ? 'evidence.json' : 'evidence.pending.json';
    await writeFile(join(directory, path), crash === 'complete unpublished evidence' ? JSON.stringify(freezeServiceEvidence(response)) : '{');
    const f = fixture(createPhase4Store(directory));
    const result = await run(f, 'execute');
    assert.equal(result.canExecute, false); assert.equal(result.frozen, null);
    assert.equal((await run(f, 'prepare')).prepared, null); assert.equal(f.executes(), 0);
  });
}
test('finalization while claiming execution prevents the HTTP request', async () => {
  const f = fixture(); const claim = f.store.claim;
  f.store.claim = async () => {
    const acquired = await claim();
    f.snapshot.job.status = RegistryStatus.Failure; f.snapshot.job.resultHash = blockHash; f.snapshot.job.completedAt = 20n;
    return acquired;
  };
  assert.equal((await run(f, 'execute')).registryStatus, 'Failure');
  assert.equal(f.executes(), 0); assert.equal(await f.store.attempted(), true);
});
test('RPC failure after frozen evidence and receipt timeout never permit execution or resubmission', async () => {
  const f = fixture(); const first = await run(f, 'execute'); const snapshot = f.reader.snapshot;
  f.reader.snapshot = async () => { throw new Error('RPC unavailable'); };
  await assert.rejects(run(f, 'refresh')); assert.equal(f.executes(), 1);
  f.reader.snapshot = snapshot;
  assert.equal((await run(f, 'refresh')).frozen?.resultHash, first.frozen?.resultHash);
  f.snapshot.job.status = RegistryStatus.Failure; f.snapshot.job.resultHash = first.frozen!.resultHash; f.snapshot.job.completedAt = 20n;
  f.reader.outcome = async () => { throw new Error('Receipt timeout'); };
  const recovered = await run(f, 'refresh', { ...input, outcomeTransactionHash: outcomeHash });
  assert.equal(recovered.registryStatus, 'Failure'); assert.equal(recovered.outcomeProof, null);
  assert.equal(recovered.prepared, null); assert.equal(recovered.canExecute, false);
  assert.match(recovered.outcomeNotice, /do not resend/);
});
for (const scenario of ['success body', 'slow', 'wrong city', 'invalid JSON', 'HTTP failure']) {
  test(`unexpected ${scenario} freezes evidence but blocks the approved outcome`, async () => {
    const f = fixture(); const observed = { ...response };
    if (scenario === 'success body') observed.body = '{"city":"Tokyo","temperatureC":22,"condition":"clear"}';
    if (scenario === 'slow') observed.responseTimeMs = 1000;
    if (scenario === 'wrong city') observed.body = '{"city":"Sydney","condition":"clear"}';
    if (scenario === 'invalid JSON') observed.body = '{';
    if (scenario === 'HTTP failure') observed.status = 500;
    const result = await inspectPhase4(f.reader, f.store, input, 'execute', async () => observed);
    assert.equal(result.expectedFault, false); assert.equal(result.preparationReady, false);
    assert.equal((await run(f, 'prepare')).prepared, null); assert.equal(f.simulations(), 0);
    if (scenario === 'wrong city') assert.equal(result.frozen?.validation.checks[2]?.passed, true, 'existing validator checks nonempty city, not equality');
  });
}
test('tampered/zero hash and changed frozen validation cannot prepare or regenerate', async t => {
  const { directory, store } = await temporaryStore(t); const f = fixture(store);
  await run(f, 'execute'); const frozen = freezeServiceEvidence(response);
  for (const bad of [{ ...frozen, resultHash: zeroHash }, { ...frozen, canonical: 'changed' },
    { ...frozen, validation: { ...frozen.validation, result: 'SUCCESS' } }, { ...frozen, response: { ...response, responseTimeMs: 42 } }]) {
    assert.throws(() => validateFrozenEvidence(bad));
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(bad));
    assert.equal((await run(f, 'prepare')).prepared, null); await run(f, 'execute');
  }
  assert.equal(f.executes(), 1); assert.equal(f.simulations(), 0);
});
test('only frozen expected failure prepares enum 3 from existing mapping/ABI; repeats never broadcast', async () => {
  const f = fixture(); assert.equal((await run(f, 'prepare')).prepared, null);
  await run(f, 'execute'); const first = await run(f, 'prepare'); const repeated = await run(f, 'prepare');
  assert.deepEqual(repeated.prepared, first.prepared); assert.equal(first.prepared?.outcome, RegistryStatus.Failure);
  assert.equal(RegistryStatus.Failure, 3);
  const call = decodeFunctionData({ abi: registryWriteAbi, data: first.prepared!.data });
  assert.equal(call.functionName, 'recordOutcome'); assert.deepEqual(call.args, [3n, 3, first.frozen!.resultHash]);
  assert.equal(first.prepared?.from, f.snapshot.validator); assert.equal(first.prepared?.value, '0');
  assert.doesNotMatch(first.prepared!.command, /--password|--private-key|--unlocked/);
  assert.equal(f.snapshot.job.status, RegistryStatus.Paid); assert.equal(f.executes(), 1);
  f.snapshot.validator = zeroAddress; assert.equal((await run(f, 'prepare')).prepared, null);
});
test('preparation rereads registry and simulation refusal blocks instructions', async () => {
  const f = fixture(); await run(f, 'execute');
  f.reader.simulate = async () => { throw new Error('Unauthorized or changed state'); };
  assert.equal((await run(f, 'prepare')).prepared, null);
  f.snapshot.job.status = RegistryStatus.Created;
  await assert.rejects(run(f, 'prepare'));
});
test('uncertain outcome hash blocks preparation; read retries do not execute or send', async () => {
  const f = fixture(); await run(f, 'execute');
  const result = await run(f, 'prepare', { ...input, outcomeTransactionHash: outcomeHash });
  assert.equal(result.prepared, null); assert.equal(result.preparationReady, false);
  assert.equal(f.simulations(), 0); assert.equal(f.executes(), 1);
});
for (const status of [RegistryStatus.Failure, RegistryStatus.Success]) {
  test(`finalized status ${status} recovers without execution or preparation`, async () => {
    const f = fixture(); await run(f, 'execute');
    const frozen = validateFrozenEvidence(await f.store.load());
    f.snapshot.job.status = status; f.snapshot.job.resultHash = frozen.resultHash; f.snapshot.job.completedAt = 20n;
    f.snapshot.stats.failedJobs = 2n;
    for (const action of ['execute', 'prepare', 'refresh'] as const) {
      const result = await run(f, action);
      assert.equal(result.registryStatus, status === RegistryStatus.Failure ? 'Failure' : 'Success');
      assert.equal(result.canExecute, false); assert.equal(result.prepared, null);
      assert.deepEqual(result.sellerStats, { paidJobs: '3', successfulJobs: '1', failedJobs: '2' });
    }
    assert.equal(f.executes(), 1); assert.equal(f.simulations(), 0);
  });
}
test('finalized without local evidence displays state and never recreates a hash', async () => {
  const f = fixture(); f.snapshot.job.status = RegistryStatus.Failure; f.snapshot.job.resultHash = blockHash; f.snapshot.job.completedAt = 20n;
  const result = await run(f, 'execute'); assert.equal(result.registryStatus, 'Failure'); assert.equal(result.frozen, null);
  assert.equal(f.executes(), 0); assert.match(result.outcomeNotice, /cannot be matched/);
});
test('CLI preparation is read-only and masks raw RPC errors', async () => {
  const f = fixture(); const out: string[] = []; const errors: string[] = [];
  assert.equal(await runPhase4Prepare(f.reader, f.store, text => out.push(text), text => errors.push(text)), 1);
  assert.equal(f.executes(), 0);
  f.reader.snapshot = async () => { throw new Error('sensitive transport details'); };
  await runPhase4Prepare(f.reader, f.store, text => out.push(text), text => errors.push(text));
  assert.doesNotMatch(errors.join(''), /sensitive transport/);
});

test('explicit API execution uses the existing measured localhost seller route, not /api/demo', async t => {
  const f = fixture(); let base = ''; const paths: string[] = [];
  const server = createApiServer(undefined, (raw, action) => inspectPhase4(f.reader, f.store, raw, action, () => executePhase4Seller(base)));
  server.on('request', req => paths.push(req.url ?? ''));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
  const post = (action: string, body: unknown = input, origin = base) => fetch(`${base}/api/phase4/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await post('refresh')).status, 200); assert.ok(paths.every(path => !path.includes('/weather')));
  assert.equal((await post('execute', input, 'https://unrelated.invalid')).status, 400);
  assert.equal((await post('execute', { ...input, resultHash: blockHash })).status, 400);
  assert.equal((await fetch(`${base}/api/phase4/execute`)).status, 404);
  const result = await (await post('execute')).json();
  assert.equal(result.frozen.response.body, response.body);
  assert.equal(result.frozen.response.status, 200); assert.ok(result.frozen.response.responseTimeMs >= 0);
  assert.equal(result.frozen.resultHash, serviceEvidence(result.frozen.response, 1000).resultHash);
  await post('execute');
  assert.equal(paths.filter(path => path === '/api/sellers/seller-a/weather?city=Tokyo&scenario=failure').length, 1);
  assert.ok(paths.every(path => !path.startsWith('/api/demo')));
  assert.equal((await post('record', input)).status, 404); assert.equal(f.simulations(), 0);
});

function rpcFixture() {
  const f = fixture(); const frozen = freezeServiceEvidence(response);
  const event = parseAbiItem('event OutcomeRecorded(uint256 indexed jobId, uint8 outcome, bytes32 resultHash)');
  const receipt = { transactionHash: outcomeHash, status: 'success', blockHash, blockNumber: 99n,
    logs: [{ address: phase3Run.registry, topics: encodeEventTopics({ abi: [event], eventName: 'OutcomeRecorded', args: { jobId: 3n } }),
      data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [3, frozen.resultHash]) }] };
  const tx = { hash: outcomeHash, chainId: 43113, blockHash, from: f.snapshot.validator, to: phase3Run.registry, value: 0n,
    input: encodeFunctionData({ abi: registryWriteAbi, functionName: 'recordOutcome', args: [3n, 3, frozen.resultHash] }) };
  let extraPaid = false; let simulations = 0;
  const client = {
    getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
    getLogs: async () => [{ args: { resultHash: frozen.resultHash, outcome: 3 }, transactionHash: outcomeHash }],
    readContract: async (args: { functionName: string; blockNumber: bigint }) => {
      if (args.functionName === 'validator') return f.snapshot.validator;
      if (args.functionName === 'sellerStats') return args.blockNumber < 99n ? [3n, 1n, 1n] : [extraPaid ? 4n : 3n, 1n, 2n];
      if (args.functionName === 'getJob') return { ...f.snapshot.job, status: args.blockNumber < 99n ? 1 : 3,
        resultHash: args.blockNumber < 99n ? zeroHash : frozen.resultHash, completedAt: args.blockNumber < 99n ? 0n : 20n };
      throw new Error('Unexpected read');
    },
    simulateContract: async (args: { functionName: string; account: string; args: unknown[] }) => {
      simulations++; assert.equal(args.functionName, 'recordOutcome'); assert.equal(args.account, f.snapshot.validator);
      assert.deepEqual(args.args, [3n, 3, frozen.resultHash]);
    },
  } as unknown as Parameters<typeof createPhase4Reader>[0];
  return { reader: createPhase4Reader(client), frozen, snapshot: f.snapshot, receipt, tx,
    extraPaid: () => { extraPaid = true; }, simulations: () => simulations };
}
test('RPC outcome recovery proves Paid → Failure and only failedJobs +1; simulation uses validator', async () => {
  const f = rpcFixture(); const proof = await f.reader.outcome(f.snapshot, f.frozen);
  assert.equal(proof?.registryStatus, 'Failure'); assert.equal(proof?.previousRegistryStatus, 'Paid');
  assert.deepEqual(proof?.after, { paidJobs: '3', successfulJobs: '1', failedJobs: '2' });
  assert.equal(proof?.countersMatchExpectedDelta, true);
  await f.reader.simulate(f.snapshot, f.frozen); assert.equal(f.simulations(), 1);
  f.extraPaid(); assert.equal((await f.reader.outcome(f.snapshot, f.frozen))?.countersMatchExpectedDelta, false);
});
for (const fault of ['sender', 'calldata', 'failed receipt', 'event', 'chain', 'block']) {
  test(`outcome recovery rejects wrong ${fault}`, async () => {
    const f = rpcFixture();
    if (fault === 'sender') f.tx.from = phase3Run.buyer;
    if (fault === 'calldata') f.tx.input = '0x';
    if (fault === 'failed receipt') f.receipt.status = 'reverted';
    if (fault === 'event') f.receipt.logs = [];
    if (fault === 'chain') f.tx.chainId = 1;
    if (fault === 'block') f.receipt.blockHash = zeroHash;
    await assert.rejects(f.reader.outcome(f.snapshot, f.frozen, outcomeHash));
  });
}
