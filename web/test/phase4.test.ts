import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistOperatorRequest, readOperatorState } from '../src/phase3'
import { phase4OperatorStorage, phase4StorageKey, requestPhase4 } from '../src/phase4'

test('explicit requests contain only Job #3 and optional public outcome hash, never browser evidence or signer data', async () => {
  const calls: { url: string; body: unknown }[] = []
  const fetcher = (async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) })
    return new Response(JSON.stringify({ jobId: '3', registryStatus: 'Paid', canExecute: false }))
  }) as typeof fetch
  for (const action of ['refresh', 'execute', 'prepare'] as const) await requestPhase4(action, '', fetcher)
  assert.deepEqual(calls.map(c => c.url), ['/api/phase4/refresh', '/api/phase4/execute', '/api/phase4/prepare'])
  assert.ok(calls.every(c => JSON.stringify(c.body) === '{"jobId":"3"}'))
})
test('Phase 4 handoff marker survives reload, blocks repeat preparation and never overwrites Phase 3 state', () => {
  const values = new Map<string, string>([['pos.phase3.operator.v1', 'untouched']])
  const storage = phase4OperatorStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } })
  persistOperatorRequest(storage, 'prepare', '')
  assert.equal(readOperatorState(storage).handedOff, true)
  assert.throws(() => persistOperatorRequest(storage, 'prepare', ''), /already started/)
  const hash = `0x${'ab'.repeat(32)}`
  persistOperatorRequest(storage, 'refresh', hash)
  assert.equal(persistOperatorRequest(storage, 'refresh', '').hash, hash)
  assert.equal(values.get('pos.phase3.operator.v1'), 'untouched'); assert.ok(values.has(phase4StorageKey))
})
test('uncertain execute/outcome lookup never retries automatically', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; throw new Error('Timeout') }) as typeof fetch
  await assert.rejects(requestPhase4('execute', '', fetcher)); assert.equal(calls, 1)
  await assert.rejects(requestPhase4('refresh', `0x${'ab'.repeat(32)}`, fetcher)); assert.equal(calls, 2)
})
test('invalid/zero outcome hash blocks requests; finalized readback never triggers a write', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; return new Response(JSON.stringify({ jobId: '3', registryStatus: 'Failure', canExecute: false, prepared: null })) }) as typeof fetch
  await assert.rejects(requestPhase4('prepare', `0x${'0'.repeat(64)}`, fetcher)); assert.equal(calls, 0)
  const result = await requestPhase4('refresh', '', fetcher)
  assert.equal(result.registryStatus, 'Failure'); assert.equal(result.prepared, null); assert.equal(calls, 1)
})

test('browser refresh through the actual Vite proxy preserves same-origin validation', async () => {
  const { createServer } = await import('vite')
  const { createApiServer } = await import('../../server/src/http')
  const { once } = await import('node:events')
  const { resolve } = await import('node:path')
  let reads = 0
  const backend = createApiServer(undefined, async (input, action) => {
    assert.deepEqual(input, { jobId: '3' })
    assert.equal(action, 'refresh')
    reads++
    return { jobId: '3', registryStatus: 'Paid', canExecute: true, frozen: null } as Phase4EvidenceForTest
  })
  type Phase4EvidenceForTest = import('../src/phase4').Phase4Evidence
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address() as { port: number }
  const vite = await createServer({
    configFile: resolve('web/vite.config.ts'), root: resolve('web'),
    server: { host: '127.0.0.1', port: 0, proxy: {
      '/api/phase4': { target: `http://127.0.0.1:${address.port}` },
    } },
  })
  try {
    const proxy = vite.config.server.proxy!['/api/phase4']
    assert.equal(typeof proxy === 'object' && proxy.changeOrigin, false,
      'Phase 4 must explicitly preserve the browser Host rather than use Vite string-proxy defaults')
    await vite.listen()
    const port = (vite.httpServer!.address() as { port: number }).port
    const origin = `http://127.0.0.1:${port}`
    const browserFetch = ((url, options) => fetch(`${origin}${url}`, {
      ...options, headers: { ...options?.headers, Origin: origin },
    })) as typeof fetch
    const result = await requestPhase4('refresh', '', browserFetch)
    assert.equal(result.registryStatus, 'Paid'); assert.equal(result.canExecute, true)
    assert.equal(result.frozen, null); assert.equal(reads, 1)
    const rejected = await fetch(`${origin}/api/phase4/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://other.invalid' },
      body: '{"jobId":"3"}',
    })
    assert.equal(rejected.status, 400); assert.equal(reads, 1)
  } finally {
    await vite.close()
    await new Promise<void>(resolve => backend.close(() => resolve()))
  }
})
