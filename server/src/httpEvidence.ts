import { serviceEvidence } from './orchestration';
import { executeSellerHttp } from './sellerHttp';

async function main() {
  const [baseUrl, sellerId, city, scenario, threshold, ...extra] = process.argv.slice(2);
  const maxResponseTimeMs = Number(threshold);
  if (!baseUrl || !sellerId || !city?.trim() || (scenario !== 'success' && scenario !== 'failure') ||
      !Number.isFinite(maxResponseTimeMs) || maxResponseTimeMs <= 0 || extra.length) {
    throw new Error('Usage: npm run evidence:http -- <baseUrl> <sellerId> <city> <success|failure> <maxResponseTimeMs>');
  }
  const response = await executeSellerHttp(baseUrl, sellerId, city, scenario);
  const evidence = serviceEvidence(response, maxResponseTimeMs);
  console.log(JSON.stringify({ transport: 'HTTP', timing: 'MEASURED', ...response,
    validation: evidence.validation, canonical: evidence.canonical, resultHash: evidence.resultHash }, null, 2));
}

void main().catch(() => {
  // Do not echo URLs, credentials, or other arbitrary inputs in transport errors.
  console.error('HTTP evidence generation failed. Usage: npm run evidence:http -- <baseUrl> <sellerId> <city> <success|failure> <maxResponseTimeMs>');
  process.exitCode = 1;
});
