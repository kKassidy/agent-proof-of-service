import { type Hash, type Transaction, type TransactionReceipt } from 'viem';
import { FUJI_CHAIN_ID, normalizeAddress } from './avalanche';

export interface PaymentInput {
  transactionHash: string;
  expectedBuyer: string;
  expectedSeller: string;
  minimumAmountWei: bigint;
}
export interface PaymentChecks {
  networkMatches: boolean;
  transactionMatches: boolean;
  transactionSucceeded: boolean;
  buyerMatches: boolean;
  sellerMatches: boolean;
  amountSufficient: boolean;
}
export type PaymentResult = { transactionHash: Hash; checks: PaymentChecks } & (
  { status: 'VERIFIED'; paymentRef: Hash } | { status: 'REJECTED'; paymentRef: null }
);
export interface PaymentClient {
  getChainId(): Promise<number>;
  getTransaction(args: { hash: Hash }): Promise<Pick<Transaction, 'hash' | 'blockHash' | 'chainId' | 'from' | 'to' | 'value'>>;
  getTransactionReceipt(args: { hash: Hash }): Promise<Pick<TransactionReceipt, 'transactionHash' | 'blockHash' | 'status'>>;
}

function normalizeHash(value: string): Hash {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw new Error('Expected a nonzero bytes32 transaction hash');
  return value.toLowerCase() as Hash;
}

// RPC/not-found errors propagate: unavailable evidence is never a verified payment.
export async function verifyNativeAvaxPayment(client: PaymentClient, input: PaymentInput): Promise<PaymentResult> {
  const hash = normalizeHash(input.transactionHash);
  const buyer = normalizeAddress(input.expectedBuyer);
  const seller = normalizeAddress(input.expectedSeller);
  if (typeof input.minimumAmountWei !== 'bigint' || input.minimumAmountWei <= 0n) throw new Error('Minimum amount must be a positive bigint');
  const networkMatches = await client.getChainId() === FUJI_CHAIN_ID;
  if (!networkMatches) return { status: 'REJECTED', transactionHash: hash, paymentRef: null, checks: {
    networkMatches: false, transactionMatches: false, transactionSucceeded: false,
    buyerMatches: false, sellerMatches: false, amountSufficient: false,
  } };
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }), client.getTransactionReceipt({ hash }),
  ]);
  const checks: PaymentChecks = {
    networkMatches: tx.chainId === FUJI_CHAIN_ID,
    transactionMatches: tx.hash.toLowerCase() === hash && receipt.transactionHash.toLowerCase() === hash
      && tx.blockHash !== null && tx.blockHash === receipt.blockHash,
    transactionSucceeded: receipt.status === 'success',
    buyerMatches: normalizeAddress(tx.from) === buyer,
    sellerMatches: tx.to !== null && normalizeAddress(tx.to) === seller,
    amountSufficient: tx.value >= input.minimumAmountWei,
  };
  return Object.values(checks).every(Boolean)
    ? { status: 'VERIFIED', transactionHash: hash, paymentRef: hash, checks }
    : { status: 'REJECTED', transactionHash: hash, paymentRef: null, checks };
}

export function paymentRefForVerifiedPayment(result: PaymentResult): Hash {
  if (result.status !== 'VERIFIED' || !Object.values(result.checks).every(Boolean)) throw new Error('Payment is not verified');
  return normalizeHash(result.transactionHash);
}
