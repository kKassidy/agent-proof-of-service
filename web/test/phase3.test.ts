import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistOperatorRequest, phase3PaymentHash, readOperatorState, requestPhase3, saveOperatorState } from '../src/phase3'

test('verification, preparation and refresh use only read-only API routes and canonical public inputs', async () => {
  const calls: { url: string; body: unknown }[] = []
  const fetcher = (async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) })
    return new Response(JSON.stringify({ jobId: '3', chainId: 43113, registryStatus: 'Created', verification: { checks: {} } }))
  }) as typeof fetch
  for (const action of ['verify', 'prepare', 'refresh'] as const) await requestPhase3(action, '', fetcher)
  assert.deepEqual(calls.map(call => call.url), ['/api/phase3/verify', '/api/phase3/prepare', '/api/phase3/refresh'])
  assert.ok(calls.every(call => JSON.stringify(call.body) === JSON.stringify({ jobId: '3', paymentTransactionHash: phase3PaymentHash })))
})
test('page refresh preserves handoff uncertainty and public confirmation hash', () => {
  let raw: string | null = null
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  assert.deepEqual(readOperatorState(storage), { handedOff: false, hash: '' })
  saveOperatorState(storage, { handedOff: true, hash: '' })
  assert.equal(readOperatorState(storage).handedOff, true)
  const hash = `0x${'ab'.repeat(32)}`
  saveOperatorState(storage, { handedOff: true, hash })
  assert.deepEqual(readOperatorState(storage), { handedOff: true, hash })
  raw = '{}'; assert.equal(readOperatorState(storage).handedOff, true)
  raw = 'invalid'; assert.throws(() => readOperatorState(storage))
})
test('invalid/zero confirmation hash never reaches the API', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; throw new Error() }) as typeof fetch
  for (const hash of ['bad', `0x${'0'.repeat(64)}`]) await assert.rejects(requestPhase3('refresh', hash, fetcher))
  assert.equal(calls, 0)
})
test('duplicate handoff is blocked from durable state; refresh cannot erase uncertainty or a hash', () => {
  let raw: string | null = null
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  assert.equal(persistOperatorRequest(storage, 'verify', '').handedOff, false)
  assert.equal(persistOperatorRequest(storage, 'prepare', '').handedOff, true)
  assert.throws(() => persistOperatorRequest(storage, 'prepare', ''), /already started/)
  const hash = `0x${'ab'.repeat(32)}`
  persistOperatorRequest(storage, 'refresh', hash)
  assert.deepEqual(persistOperatorRequest(storage, 'verify', ''), { handedOff: true, hash })
  assert.throws(() => persistOperatorRequest(storage, 'prepare', ''), /already started/)
})
test('handoff fails closed if storage cannot persist the intent', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable') } }
  assert.throws(() => persistOperatorRequest(storage, 'prepare', ''), /Storage unavailable/)
})
test('timeout is not retried; Paid response is recovered without a send', async () => {
  let calls = 0
  await assert.rejects(requestPhase3('refresh', '', (async () => { calls++; throw new Error('Timeout') }) as typeof fetch))
  assert.equal(calls, 1)
  const result = await requestPhase3('refresh', '', (async () => new Response(JSON.stringify({
    jobId: '3', chainId: 43113, registryStatus: 'Paid', verification: { checks: {} }, prepared: null,
  }))) as typeof fetch)
  assert.equal(result.registryStatus, 'Paid'); assert.equal(result.prepared, null)
})
