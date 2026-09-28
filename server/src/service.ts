export interface Seller {
  id: string;
  name: string;
  priceUsd: number;
  verifiedJobs: number;
  successfulJobs: number;
  failedJobs: number;
}

export const sellers: readonly Seller[] = [
  { id: 'seller-a', name: 'Reliable Weather Agent', priceUsd: 0.01, verifiedJobs: 103, successfulJobs: 99, failedJobs: 4 },
  { id: 'seller-b', name: 'Budget Weather Agent', priceUsd: 0.005, verifiedJobs: 250, successfulJobs: 153, failedJobs: 97 },
  { id: 'seller-c', name: 'Unverified Weather Agent', priceUsd: 0.002, verifiedJobs: 0, successfulJobs: 0, failedJobs: 0 },
];

export interface Policy {
  minimumVerifiedJobs: number;
  minimumSuccessRate: number;
  maximumPriceUsd: number;
}
export const policy: Policy = { minimumVerifiedJobs: 20, minimumSuccessRate: 0.9, maximumPriceUsd: 0.02 };
export const defaultMaxResponseTimeMs = 1000;

// null means no verified history, rather than an observed 0% success rate.
export function successRate(seller: Seller): number | null {
  return seller.verifiedJobs === 0 ? null : seller.successfulJobs / seller.verifiedJobs;
}

export function evaluateSeller(seller: Seller, requirements: Policy = policy) {
  const rate = successRate(seller);
  const rejectionReasons: string[] = [];
  if (seller.verifiedJobs < requirements.minimumVerifiedJobs) rejectionReasons.push('INSUFFICIENT_VERIFIED_JOBS');
  if (rate === null || rate < requirements.minimumSuccessRate) rejectionReasons.push('SUCCESS_RATE_BELOW_MINIMUM');
  if (seller.priceUsd > requirements.maximumPriceUsd) rejectionReasons.push('PRICE_ABOVE_MAXIMUM');
  return { seller, successRate: rate, eligible: rejectionReasons.length === 0, rejectionReasons };
}

export function selectSeller(candidates: readonly Seller[], requirements: Policy = policy): Seller | null {
  return candidates.filter(seller => evaluateSeller(seller, requirements).eligible)
    .sort((a, b) => a.priceUsd - b.priceUsd || a.id.localeCompare(b.id))[0] ?? null;
}

export interface ServiceResponse {
  status: number;
  body: string;
  responseTimeMs: number;
}
export type Scenario = 'success' | 'failure';

// A deterministic mock transport. Timing is simulated, not a network measurement.
export function callMockSeller(seller: Seller, city: string, scenario: Scenario = 'success'): ServiceResponse {
  const weather = seller.id === 'seller-a' && scenario === 'failure'
    ? { city, condition: 'clear' }
    : { city, temperatureC: 22, condition: 'clear' };
  return { status: 200, body: JSON.stringify(weather), responseTimeMs: 10 };
}

export function validateSla(response: ServiceResponse, maxResponseTimeMs = defaultMaxResponseTimeMs) {
  if (!Number.isFinite(maxResponseTimeMs) || maxResponseTimeMs <= 0) throw new Error('maxResponseTimeMs must be a positive finite number');
  let parsed: unknown;
  let validJson = false;
  try { parsed = JSON.parse(response.body); validJson = true; } catch { /* Recorded as a failed check. */ }
  const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
  const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const checks = [
    { id: 'httpStatus200', passed: response.status === 200 },
    { id: 'validJson', passed: validJson },
    { id: 'cityNonEmptyString', passed: nonEmpty(data.city) },
    { id: 'temperatureFiniteNumber', passed: typeof data.temperatureC === 'number' && Number.isFinite(data.temperatureC) },
    { id: 'conditionNonEmptyString', passed: nonEmpty(data.condition) },
    { id: 'responseTimeBelowThreshold', passed: Number.isFinite(response.responseTimeMs) && response.responseTimeMs >= 0 && response.responseTimeMs < maxResponseTimeMs },
  ];
  return { result: checks.every(check => check.passed) ? 'SUCCESS' as const : 'FAILURE' as const,
    scope: 'SCHEMA_AND_SLA_ONLY' as const, maxResponseTimeMs, checks };
}

export function runDemo(scenario: Scenario, city = 'Sydney', maxResponseTimeMs = defaultMaxResponseTimeMs, candidates: readonly Seller[] = sellers) {
  const seller = selectSeller(candidates);
  const selection = candidates.map(candidate => evaluateSeller(candidate));
  if (!seller) return { result: 'FAILURE' as const, reason: 'NO_ELIGIBLE_SELLER', selection, seller: null, payment: { status: 'NOT_IMPLEMENTED', reference: null }, serviceCall: null, validation: null };
  const response = callMockSeller(seller, city, scenario);
  const validation = validateSla(response, maxResponseTimeMs);
  return { scenario, result: validation.result, seller, selection,
    payment: { status: 'NOT_IMPLEMENTED', reference: null },
    serviceCall: { delivered: true, transport: 'IN_PROCESS_MOCK', timing: 'SIMULATED', ...response }, validation };
}
