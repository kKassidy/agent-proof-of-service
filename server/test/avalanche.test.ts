import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicClient, custom, type PublicClient } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { assertFuji, createRegistryReader, loadFujiConfig } from '../src/avalanche';
import { verifyNativeAvaxPayment, paymentRefForVerifiedPayment, type PaymentClient } from '../src/payment';

const hash = `0x${'ab'.repeat(32)}` as const;
const blockHash = `0x${'cd'.repeat(32)}` as const;
const buyer = `0x${'aa'.repeat(20)}` as const;
const seller = `0x${'bb'.repeat(20)}` as const;
const input = { transactionHash: hash, expectedBuyer: buyer, expectedSeller: seller, minimumAmountWei: 10n };
function mock(tx = {}, receipt = {}, chainId = 43113): PaymentClient {
  return {
    async getChainId() { return chainId; },
    async getTransaction(args) {
      assert.equal(args.hash, hash);
      return { hash, blockHash, chainId: 43113, from: buyer, to: seller, value: 11n, ...tx } as Awaited<ReturnType<PaymentClient['getTransaction']>>;
    },
    async getTransactionReceipt(args) {
      assert.equal(args.hash, hash);
      return { transactionHash: hash, blockHash, status: 'success', ...receipt } as Awaited<ReturnType<PaymentClient['getTransactionReceipt']>>;
    },
  };
}
test('valid native payment passes and uses its transaction hash as bytes32 reference', async () => {
  const result = await verifyNativeAvaxPayment(mock(), input);
  assert.equal(result.status, 'VERIFIED');
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.paymentRef, hash);
  assert.equal(paymentRefForVerifiedPayment(result), hash);
});
for (const [name, tx, receipt, check] of [
  ['failed receipt', {}, { status: 'reverted' }, 'transactionSucceeded'],
  ['wrong buyer', { from: seller }, {}, 'buyerMatches'],
  ['wrong seller', { to: buyer }, {}, 'sellerMatches'],
  ['contract creation', { to: null }, {}, 'sellerMatches'],
  ['insufficient amount', { value: 9n }, {}, 'amountSufficient'],
  ['wrong transaction chain', { chainId: 1 }, {}, 'networkMatches'],
  ['missing transaction chain', { chainId: undefined }, {}, 'networkMatches'],
  ['wrong transaction hash', { hash: blockHash }, {}, 'transactionMatches'],
  ['wrong receipt hash', {}, { transactionHash: blockHash }, 'transactionMatches'],
  ['different inclusion block', {}, { blockHash: hash }, 'transactionMatches'],
  ['pending transaction', { blockHash: null }, {}, 'transactionMatches'],
] as const) {
  test(`${name} rejects`, async () => {
    const result = await verifyNativeAvaxPayment(mock(tx, receipt), input);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.checks[check], false);
    assert.equal(result.paymentRef, null);
    assert.throws(() => paymentRefForVerifiedPayment(result));
  });
}
test('exact minimum passes', async () => {
  assert.equal((await verifyNativeAvaxPayment(mock({ value: 10n }), input)).status, 'VERIFIED');
});
test('addresses and transaction hashes compare case-insensitively', async () => {
  const result = await verifyNativeAvaxPayment(mock({ from: `0x${'aA'.repeat(20)}`, to: `0x${'BB'.repeat(20)}` }), {
    ...input, expectedBuyer: `0x${'AA'.repeat(20)}`, transactionHash: `0x${'AB'.repeat(32)}`,
  });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.paymentRef, hash);
});
test('wrong RPC network rejects before fetching evidence', async () => {
  const client = mock({}, {}, 1);
  client.getTransaction = async () => { throw new Error('must not fetch'); };
  assert.equal((await verifyNativeAvaxPayment(client, input)).status, 'REJECTED');
  await assert.rejects(assertFuji(client), /43113/);
});
test('invalid inputs reject before RPC requests', async () => {
  const client = mock();
  client.getChainId = async () => { throw new Error('must not fetch'); };
  for (const change of [{ transactionHash: '0x12' }, { transactionHash: `0x${'00'.repeat(32)}` }, { expectedBuyer: 'bad' }, { expectedSeller: 'bad' }, { minimumAmountWei: -1n }, { minimumAmountWei: 0n }]) {
    await assert.rejects(verifyNativeAvaxPayment(client, { ...input, ...change }), /Expected|Invalid|Minimum/);
  }
});
test('missing evidence and RPC failures propagate without verification', async () => {
  const client = mock();
  client.getTransactionReceipt = async () => { throw new Error('receipt unavailable'); };
  await assert.rejects(verifyNativeAvaxPayment(client, input), /receipt unavailable/);
});
test('runtime configuration requires public RPC URL and nonzero registry address', () => {
  assert.deepEqual(loadFujiConfig({ AVALANCHE_FUJI_RPC_URL: 'https://example.com', SERVICE_PROOF_REGISTRY_ADDRESS: seller }), { rpcUrl: 'https://example.com', registryAddress: seller });
  assert.throws(() => loadFujiConfig({}), /required/);
  assert.throws(() => loadFujiConfig({ AVALANCHE_FUJI_RPC_URL: 'file:///tmp/rpc' }), /HTTP/);
  assert.throws(() => loadFujiConfig({ AVALANCHE_FUJI_RPC_URL: 'https://example.com', SERVICE_PROOF_REGISTRY_ADDRESS: `0x${'00'.repeat(20)}` }), /nonzero/);
});
test('network validation consults RPC even when viem is configured for Fuji', async () => {
  const client = createPublicClient({ chain: avalancheFuji, transport: custom({ async request({ method }) {
    assert.equal(method, 'eth_chainId');
    return '0x1';
  } }) });
  await assert.rejects(assertFuji(client), /43113/);
});
test('registry reader uses typed ABI, configured address and correct arguments', async () => {
  const calls: any[] = [];
  const job = { buyer, seller, taskHash: hash, paymentRef: hash, resultHash: hash, createdAt: 1n, completedAt: 2n, status: 2 };
  const client = {
    async getChainId() { return 43113; },
    readContract: (async (args: any) => {
      calls.push(args);
      if (args.functionName === 'getJob') return job;
      if (args.functionName === 'sellerStats') return [3n, 2n, 1n];
      return buyer;
    }) as PublicClient['readContract'],
  };
  const reader = createRegistryReader(client, seller);
  assert.deepEqual(await reader.getJob(7n), job);
  assert.deepEqual(await reader.getSellerStats(buyer), { paidJobs: 3n, successfulJobs: 2n, failedJobs: 1n });
  assert.equal(await reader.getPaymentConfirmer(), buyer);
  assert.equal(await reader.getValidator(), buyer);
  assert.deepEqual(calls.map(c => c.functionName), ['getJob', 'sellerStats', 'paymentConfirmer', 'validator']);
  assert.deepEqual(calls[0].args, [7n]);
  assert.deepEqual(calls[1].args, [buyer]);
  assert.ok(calls.every(c => c.address === seller && c.abi.every((f: any) => f.stateMutability === 'view')));
  client.getChainId = async () => 1;
  await assert.rejects(reader.getJob(7n), /43113/);
  assert.equal(calls.length, 4);
});
