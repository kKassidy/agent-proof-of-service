import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { createApiServer } from '../src/http';
import { serviceEvidence } from '../src/orchestration';
import { executeSellerHttp } from '../src/sellerHttp';
import { validateSla } from '../src/service';

async function listen(t: TestContext, server = createApiServer()) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('actual HTTP seller success preserves body, city and measured timing', async t => {
  const base = await listen(t);
  const response = await executeSellerHttp(base, 'seller-a', 'Tokyo & 東京', 'success');
  assert.equal(response.status, 200);
  assert.equal(response.body, '{"city":"Tokyo & 東京","temperatureC":22,"condition":"clear"}');
  assert.ok(Number.isFinite(response.responseTimeMs) && response.responseTimeMs >= 0);
  assert.equal(validateSla(response, 1000).result, 'SUCCESS');
  assert.equal(serviceEvidence(response, 1000).response.body, response.body);
});

test('HTTP failure scenario is valid JSON missing only the temperature field', async t => {
  const response = await executeSellerHttp(await listen(t), 'seller-a', 'Tokyo', 'failure');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { city: 'Tokyo', condition: 'clear' });
  const validation = validateSla(response, 1000);
  assert.equal(validation.result, 'FAILURE');
  assert.deepEqual(validation.checks.filter(check => !check.passed).map(check => check.id), ['temperatureFiniteNumber']);
});

test('unknown seller remains HTTP 404 failed evidence', async t => {
  const response = await executeSellerHttp(await listen(t), 'unknown', 'Tokyo');
  assert.equal(response.status, 404);
  assert.equal(response.body, '{"error":"Seller not found"}');
  assert.equal(serviceEvidence(response, 1000).validation.result, 'FAILURE');
});

test('raw whitespace and numeric formatting survive HTTP; timing includes body completion', async t => {
  const raw = ' { "city": "Tokyo", "temperatureC": 2.20e1, "condition": "clear" }\n';
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.url, '/api/sellers/seller-a/weather?city=Tokyo&scenario=success');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write(raw.slice(0, 10));
    setTimeout(() => response.end(raw.slice(10)), 60);
  });
  const response = await executeSellerHttp(await listen(t, server), 'seller-a', 'Tokyo');
  assert.equal(requests, 1);
  assert.equal(response.body, raw);
  // Broad lower bound detects header-only measurement and simulated 10ms timing.
  assert.ok(response.responseTimeMs >= 40);
  const evidence = serviceEvidence(response, 1000);
  assert.equal(evidence.validation.result, 'SUCCESS');
  assert.equal(JSON.parse(evidence.canonical)[2], raw);
});

test('non-200 statuses and redirects are preserved without additional requests', async t => {
  let requests = 0;
  const server: Server = createServer((_request, response) => {
    requests++;
    response.writeHead(requests === 1 ? 503 : 302, { Location: '/should-not-follow' });
    response.end(' unavailable\n');
  });
  const base = await listen(t, server);
  for (const status of [503, 302]) {
    const response = await executeSellerHttp(base, 'seller-a', 'Tokyo');
    assert.equal(response.status, status);
    assert.equal(response.body, ' unavailable\n');
    assert.equal(validateSla(response, 1000).result, 'FAILURE');
  }
  assert.equal(requests, 2);
});

test('one-shot CLI makes exactly one request and prints reusable public evidence', async t => {
  const server = createApiServer();
  let requests = 0;
  server.on('request', () => { requests++; });
  const base = await listen(t, server);
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'src/httpEvidence.ts', base, 'seller-a', 'Tokyo', 'success', '1000']);
  assert.equal(stderr, '');
  assert.equal(requests, 1);
  const output = JSON.parse(stdout);
  assert.equal(output.transport, 'HTTP');
  assert.equal(output.timing, 'MEASURED');
  assert.equal(output.validation.result, 'SUCCESS');
  const { status, body, responseTimeMs } = output;
  const evidence = serviceEvidence({ status, body, responseTimeMs }, 1000);
  assert.equal(output.canonical, evidence.canonical);
  assert.equal(output.resultHash, evidence.resultHash);
});
