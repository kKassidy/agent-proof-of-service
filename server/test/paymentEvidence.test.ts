import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { type PaymentClient } from '../src/payment';
import { paymentEvidence, runPaymentEvidence } from '../src/paymentEvidence';

const hash = `0x${'12'.repeat(32)}` as const;
const blockHash = `0x${'34'.repeat(32)}` as const;
const buyer = `0x${'ab'.repeat(20)}` as const;
const seller = `0x${'cd'.repeat(20)}` as const;
const amount = 9007199254740993n;
const args = ['https://rpc.invalid', hash, buyer, seller, String(amount)];

function client(chainId = 43113, value = amount): PaymentClient {
  return {
    async getChainId() { return chainId; },
    async getTransaction({ hash: requested }) {
      assert.equal(requested, hash);
      return { hash, blockHash, chainId: 43113, from: buyer, to: seller, value };
    },
    async getTransactionReceipt({ hash: requested }) {
      assert.equal(requested, hash);
      return { transactionHash: hash, blockHash, status: 'success' };
    },
  };
}

test('CLI emits only public verified evidence and preserves bigint precision', async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runPaymentEvidence(args, text => output.push(text), text => errors.push(text), rpcUrl => {
    assert.equal(rpcUrl, args[0]);
    return client();
  });
  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    status: 'VERIFIED', transactionHash: hash, paymentRef: hash,
    checks: { networkMatches: true, transactionMatches: true, transactionSucceeded: true,
      buyerMatches: true, sellerMatches: true, amountSufficient: true },
  });
  const rejected = await paymentEvidence(args, () => client(43113, amount - 1n));
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.checks.amountSufficient, false);
});

test('wrong RPC network rejects before transaction reads and exits nonzero', async () => {
  const wrongNetwork = client(43114);
  wrongNetwork.getTransaction = async () => { assert.fail('must not read transaction'); };
  wrongNetwork.getTransactionReceipt = async () => { assert.fail('must not read receipt'); };
  const output: string[] = [];
  assert.equal(await runPaymentEvidence(args, text => output.push(text), assert.fail, () => wrongNetwork), 1);
  const evidence = JSON.parse(output[0]!);
  assert.equal(evidence.status, 'REJECTED');
  assert.equal(evidence.paymentRef, null);
  assert.ok(Object.values(evidence.checks).every(value => value === false));
});

test('malformed CLI arguments fail before client creation', async () => {
  const invalid = [[], args.slice(0, 4), [...args, 'extra'],
    ...['0', '-1', '1.5', '1e12', '0x10', ' ', ''].map(value => [...args.slice(0, 4), value]),
    ['file:///tmp/rpc', ...args.slice(1)], ['not-a-url', ...args.slice(1)]];
  for (const input of invalid) {
    await assert.rejects(paymentEvidence(input, () => { assert.fail('must not create client'); }));
  }
});

test('invalid hash and addresses are rejected by the verifier before RPC reads', async () => {
  for (const index of [1, 2, 3]) {
    const input = [...args];
    input[index] = 'invalid';
    const offline = client();
    offline.getChainId = async () => { assert.fail('must not access RPC'); };
    await assert.rejects(paymentEvidence(input, () => offline), /Expected|Invalid/);
  }
});

test('RPC and missing receipt errors produce no evidence or raw error details', async () => {
  for (const method of ['getChainId', 'getTransaction', 'getTransactionReceipt'] as const) {
    const failing = client();
    failing[method] = async () => { throw new Error('sensitive transport details'); };
    const output: string[] = [];
    const errors: string[] = [];
    assert.equal(await runPaymentEvidence(args, text => output.push(text), text => errors.push(text), () => failing), 1);
    assert.deepEqual(output, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Payment evidence generation failed/);
    assert.ok(!errors[0]!.includes('sensitive transport details'));
    assert.ok(!errors[0]!.includes(args[0]!));
  }
});

test('CLI entry point reports usage without network access when arguments are missing', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/paymentEvidence.ts'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage: npm run evidence:payment/);
});
