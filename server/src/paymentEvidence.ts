import { createPublicClient, http } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { verifyNativeAvaxPayment, type PaymentClient } from './payment';

const usage = 'Usage: npm run evidence:payment -- <rpcUrl> <transactionHash> <expectedBuyer> <expectedSeller> <minimumAmountWei>';

function publicClient(rpcUrl: string): PaymentClient {
  return createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
}

// Injection keeps tests offline; the verifier owns all payment and chain checks.
export async function paymentEvidence(args: string[], createClient = publicClient) {
  const [rpcUrl, transactionHash, expectedBuyer, expectedSeller, amount] = args;
  if (args.length !== 5 || !rpcUrl || !transactionHash || !expectedBuyer || !expectedSeller ||
      !amount || !/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error(usage);
  }
  const url = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(usage);
  return verifyNativeAvaxPayment(createClient(rpcUrl), {
    transactionHash, expectedBuyer, expectedSeller, minimumAmountWei: BigInt(amount),
  });
}

export async function runPaymentEvidence(
  args: string[],
  stdout: (text: string) => void = console.log,
  stderr: (text: string) => void = console.error,
  createClient = publicClient,
): Promise<number> {
  try {
    const { status, transactionHash, paymentRef, checks } = await paymentEvidence(args, createClient);
    stdout(JSON.stringify({ status, transactionHash, paymentRef, checks }, null, 2));
    return status === 'VERIFIED' ? 0 : 1;
  } catch {
    // Transport errors may include URLs or credentials: never echo them or inputs.
    stderr(`Payment evidence generation failed. ${usage}`);
    return 1;
  }
}

if (require.main === module) {
  void runPaymentEvidence(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
