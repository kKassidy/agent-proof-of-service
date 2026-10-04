import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Job3Proof } from '../src/Phase4Panel'
import type { Phase4Evidence } from '../src/phase4'

const evidence = {
  jobId: '3', registryStatus: 'Failure', paymentVerified: true, expectedFault: true,
  observedBlock: '100', paymentRef: `0x${'ab'.repeat(32)}`, resultHash: `0x${'cd'.repeat(32)}`,
  sellerStats: { paidJobs: '3', successfulJobs: '1', failedJobs: '2' },
  frozen: { response: { status: 200, body: '{"city":"Tokyo","condition":"clear"}', responseTimeMs: 17 },
    canonical: 'synthetic test evidence', validation: { checks: [
      'httpStatus200', 'validJson', 'cityNonEmptyString', 'temperatureFiniteNumber', 'conditionNonEmptyString', 'responseTimeBelowThreshold',
    ].map(id => ({ id, passed: id !== 'temperatureFiniteNumber' })) } },
  outcomeProof: { transactionHash: `0x${'ef'.repeat(32)}`, countersMatchExpectedDelta: true },
} as Phase4Evidence
const render = (data?: Phase4Evidence) => renderToStaticMarkup(createElement(Job3Proof, { data }))

test('unchecked proof never claims fresh verification', () => {
  const html = render()
  assert.match(html, /Current proof not checked/)
  assert.doesNotMatch(html, /Payment verified ✓|Completed · Failure recorded/)
})
test('verified final proof presents service failure separately from workflow completion', () => {
  const html = render(evidence)
  for (const text of ['Completed · Failure recorded on Fuji', 'Payment verified ✓', 'HTTP 200 ✓', 'temperatureC missing', 'Validation 5/6', 'Final outcome: FAILURE', 'DETERMINISTIC FAULT INJECTION', 'proof workflow completed successfully', 'Paid → Failure', 'authorized operator']) assert.ok(html.includes(text), text)
  assert.match(html, /<details><summary>Full frozen evidence/)
  assert.doesNotMatch(html, /<button|recordOutcome|cast send/)
})
test('incomplete receipt or payment evidence cannot produce the verified verdict', () => {
  for (const data of [{ ...evidence, outcomeProof: null, outcomeNotice: 'Receipt unavailable; do not resend.' }, { ...evidence, paymentVerified: false }, { ...evidence, expectedFault: false }]) {
    const html = render(data)
    assert.doesNotMatch(html, /Payment verified ✓|Completed · Failure recorded/)
    if (data.outcomeNotice) assert.match(html, /Receipt unavailable; do not resend/)
  }
})
test('counter mismatch remains a visible alert', () => {
  assert.match(render({ ...evidence, outcomeProof: { ...evidence.outcomeProof!, countersMatchExpectedDelta: false } }), /role="alert"/)
})
