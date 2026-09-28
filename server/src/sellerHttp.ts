import { performance } from 'node:perf_hooks';
import type { Scenario, ServiceResponse } from './service';

/** Real HTTP transport for deterministic demo sellers. No factual weather verification. */
export async function executeSellerHttp(baseUrl: string, sellerId: string, city: string, scenario: Scenario = 'success'): Promise<ServiceResponse> {
  const url = new URL(`/api/sellers/${encodeURIComponent(sellerId)}/weather`, baseUrl);
  url.searchParams.set('city', city);
  url.searchParams.set('scenario', scenario);
  const started = performance.now();
  // Preserve redirects as evidence too, rather than following them to an eventual 200.
  const response = await fetch(url, { redirect: 'manual' });
  const body = await response.text();
  const responseTimeMs = performance.now() - started;
  if (!Number.isFinite(responseTimeMs) || responseTimeMs < 0) throw new Error('Invalid measured elapsed time');
  return { status: response.status, body, responseTimeMs };
}
