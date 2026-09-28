import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApiServer } from '../src/http';
import { callMockSeller, evaluateSeller, policy, runDemo, selectSeller, sellers, successRate, validateSla } from '../src/service';

const a = sellers[0]!;
const b = sellers[1]!;
const c = sellers[2]!;
const valid = callMockSeller(a, 'Sydney');

test('success rate uses verified jobs and represents absent history as null', () => {
  assert.equal(successRate(a), 99 / 103);
  assert.equal(successRate(b), 153 / 250);
  assert.equal(successRate(c), null);
});
test('policy filters all three requirements', () => {
  assert.deepEqual(sellers.filter(s => evaluateSeller(s).eligible).map(s => s.id), ['seller-a']);
  assert.deepEqual(evaluateSeller({ ...a, priceUsd: 0.03 }).rejectionReasons, ['PRICE_ABOVE_MAXIMUM']);
});
test('Seller A is selected', () => assert.equal(selectSeller(sellers)?.id, 'seller-a'));
test('Seller B is rejected for success rate', () => assert.deepEqual(evaluateSeller(b).rejectionReasons, ['SUCCESS_RATE_BELOW_MINIMUM']));
test('Seller C is rejected for insufficient verified jobs', () => assert.ok(evaluateSeller(c).rejectionReasons.includes('INSUFFICIENT_VERIFIED_JOBS')));
test('cheapest eligible seller wins regardless of candidate ordering', () => {
  assert.equal(selectSeller([a, { ...a, id: 'cheaper', priceUsd: 0.009 }])?.id, 'cheaper');
});
test('policy boundaries are inclusive', () => {
  assert.equal(evaluateSeller({ ...a, verifiedJobs: 20, successfulJobs: 18, failedJobs: 2, priceUsd: policy.maximumPriceUsd }).eligible, true);
});
test('SLA success includes all six passing checks', () => {
  const result = validateSla(valid);
  assert.equal(result.result, 'SUCCESS');
  assert.equal(result.checks.length, 6);
  assert.ok(result.checks.every(c => c.passed));
});
test('missing temperature fails despite delivered HTTP 200 response', () => {
  const demo = runDemo('failure');
  assert.equal(demo.seller?.id, 'seller-a');
  assert.equal(demo.serviceCall?.delivered, true);
  assert.equal(demo.result, 'FAILURE');
  assert.deepEqual(demo.validation?.checks.filter(c => !c.passed).map(c => c.id), ['temperatureFiniteNumber']);
  assert.equal(demo.payment.status, 'NOT_IMPLEMENTED');
  assert.equal(demo.payment.reference, null);
});
test('non-200 fails', () => assert.equal(validateSla({ ...valid, status: 503 }).result, 'FAILURE'));
test('response time must be strictly below threshold', () => {
  assert.equal(validateSla(valid, 10).result, 'FAILURE');
  assert.equal(validateSla(valid, 9).result, 'FAILURE');
  assert.equal(validateSla(valid, 11).result, 'SUCCESS');
});
test('no eligible seller means no service call', () => {
  assert.equal(selectSeller([b, c]), null);
  assert.equal(selectSeller([]), null);
  const demo = runDemo('success', 'Sydney', 1000, [b, c]);
  assert.equal(demo.reason, 'NO_ELIGIBLE_SELLER');
  assert.equal(demo.serviceCall, null);
});
test('invalid JSON fails', () => {
  const result = validateSla({ ...valid, body: '{invalid' });
  assert.equal(result.result, 'FAILURE');
  assert.equal(result.checks.find(c => c.id === 'validJson')?.passed, false);
});
test('invalid schema values fail', () => {
  for (const body of ['null', '[]', '{"city":" ","temperatureC":22,"condition":"clear"}', '{"city":"Sydney","temperatureC":"22","condition":"clear"}', '{"city":"Sydney","temperatureC":1e400,"condition":"clear"}', '{"city":"Sydney","temperatureC":22,"condition":""}']) {
    assert.equal(validateSla({ ...valid, body }).result, 'FAILURE');
  }
});
test('success scenario is deterministic and selects A', () => {
  assert.deepEqual(runDemo('success'), runDemo('success'));
  assert.equal(runDemo('success').result, 'SUCCESS');
  assert.equal(runDemo('success').seller?.id, 'seller-a');
});
test('HTTP API exposes catalog, policy, demos, and all mock sellers', async () => {
  const server = createApiServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/sellers`)).json()).length, 3);
    assert.equal((await (await fetch(`${base}/api/policy`)).json()).minimumSuccessRate, 0.9);
    for (const scenario of ['success', 'failure']) {
      const response = await fetch(`${base}/api/demo/${scenario}`, { method: 'POST', body: JSON.stringify({ city: 'Melbourne' }) });
      assert.equal(response.status, 200);
      const demo = await response.json();
      assert.equal(demo.result, scenario === 'success' ? 'SUCCESS' : 'FAILURE');
      assert.equal(demo.seller.id, 'seller-a');
      assert.equal(JSON.parse(demo.serviceCall.body).city, 'Melbourne');
    }
    for (const seller of sellers) {
      const response = await fetch(`${base}/api/sellers/${seller.id}/weather?city=Perth`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).city, 'Perth');
    }
    assert.equal((await fetch(`${base}/api/demo/success`, { method: 'POST', body: '{' })).status, 400);
    assert.equal((await fetch(`${base}/api/demo/success`, { method: 'POST', body: '{"maxResponseTimeMs":0}' })).status, 400);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
