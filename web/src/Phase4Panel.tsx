import { useRef, useState, type RefObject } from 'react'
import { explorer } from './evidence'
import { persistOperatorRequest, readOperatorState, saveOperatorState } from './phase3'
import { phase4OperatorStorage, requestPhase4, type Phase4Evidence } from './phase4'

const labels: Record<string, string> = {
  httpStatus200: 'HTTP status = 200', validJson: 'Valid JSON', cityNonEmptyString: 'Nonempty city',
  temperatureFiniteNumber: 'Finite temperatureC', conditionNonEmptyString: 'Nonempty condition',
  responseTimeBelowThreshold: 'Measured response time < 1000 ms',
}
export default function Phase4Panel({ onRegistryState, onEvidence, refreshRef }: { onEvidence?: (data: Phase4Evidence | undefined) => void; refreshRef?: RefObject<HTMLButtonElement | null>; onRegistryState: (state: 'Paid' | 'Success' | 'Failure') => void }) {
  const [operator, setOperator] = useState(() => readOperatorState(phase4OperatorStorage(localStorage)))
  const [hash, setHash] = useState(operator.hash)
  const [data, setData] = useState<Phase4Evidence>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function action(kind: 'execute' | 'prepare' | 'refresh') {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setData(undefined); onEvidence?.(undefined)
    try {
      const storage = phase4OperatorStorage(localStorage)
      const next = persistOperatorRequest(storage, kind === 'prepare' ? 'prepare' : 'refresh', hash)
      setOperator(next); setHash(next.hash)
      const evidence = await requestPhase4(kind, next.hash)
      setData(evidence); onEvidence?.(evidence); onRegistryState(evidence.registryStatus)
      if (evidence.outcomeProof) {
        const confirmed = { handedOff: true, hash: evidence.outcomeProof.transactionHash }
        setHash(confirmed.hash); setOperator(confirmed); saveOperatorState(storage, confirmed)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Evidence unavailable. Refresh; do not rerun or resend.') }
    finally { lock.current = false; setBusy(false) }
  }
  const frozen = data?.frozen
  const finalized = data && data.registryStatus !== 'Paid'
  return <>
    <li><h3>7. Execute &amp; validate service</h3>
      <p className="eyebrow">DETERMINISTIC FAULT INJECTION · JOB #3</p>
      <p>Seller A’s localhost weather route intentionally omits temperatureC. This is an approved demonstration, not a random seller failure. The backend measures the real HTTP response for Tokyo and checks the existing schema and strictly-below-1000-ms SLA.</p>
      <div className="interactive-actions">
        <button ref={refreshRef} disabled={busy} onClick={() => void action('refresh')}>Refresh Job #3 &amp; frozen evidence</button>
        <button disabled={busy || !data?.canExecute || operator.handedOff} onClick={() => void action('execute')}>Execute &amp; validate · deterministic fault injection</button>
      </div>
      <p>{finalized ? 'Completed — this finalized proof run cannot be executed or recorded again.' : 'Refresh first to check Paid state. Execution occurs only on the explicit Execute action. Once attempted, it cannot be automatically repeated; timing and resultHash are never silently regenerated.'}</p>
      {data && <p role="status">{data.notice}</p>}
      {frozen && <div className="interactive-result">
        <p><strong>Service response received ✓</strong> · {frozen.transport} / {frozen.timing}</p>
        <dl className="interactive-facts"><dt>HTTP status</dt><dd>{frozen.response.status}</dd>
          <dt>Measured responseTimeMs</dt><dd>{frozen.response.responseTimeMs}</dd>
          <dt>Schema / SLA</dt><dd>{frozen.validation.result} · {frozen.validation.checks.filter(check => check.passed).length}/6 checks</dd>
          <dt>{finalized ? 'Recorded outcome' : 'Proposed outcome'}</dt><dd>{finalized ? data.registryStatus : data?.expectedFault ? frozen.validation.result : 'Blocked: unexpected scenario evidence'}</dd>
          <dt>Frozen Job #3 resultHash</dt><dd>{frozen.resultHash}</dd></dl>
        <p>Exact raw response body:</p><pre>{frozen.response.body}</pre>
        <ul>{frozen.validation.checks.map(check => <li key={check.id}>{check.passed ? '✓' : '✕'} {labels[check.id] ?? check.id}</li>)}</ul>
        <details><summary>Canonical evidence bound by resultHash</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{frozen.canonical}</pre></details>
        <p>Validation checks schema and timing only. It does not establish factual weather truth or require the returned city to equal the requested city.</p>
      </div>}
    </li>
    <li><h3>8. Record outcome on Fuji</h3>
      <p>Registry status: <strong>{data?.registryStatus ?? 'Not checked — refresh Job #3'}</strong>. {data?.registryStatus === 'Paid' && 'No outcome recorded yet.'}</p>
      <p>{data?.outcomeProof ? 'Completed by authorized operator. The receipt, outcome event and registry readback are verified.' : finalized ? 'Registry finalized. Recover the outcome proof below; do not send another transaction.' : 'Preparation rereads the registry, checks the frozen evidence and validator role, and simulates the authorized call. Only you can send it later from your local encrypted Foundry account.'}</p>
      <button disabled={busy || !data?.preparationReady || operator.handedOff} onClick={() => void action('prepare')}>Prepare recordOutcome · local operator</button>
      {operator.handedOff && !data?.outcomeProof && <p role="status">Operator handoff or outcome submission recorded locally. Inspect terminal activity before any further action. Do not repeat the send after a timeout.</p>}
      {data?.prepared && <div className="interactive-result">
        <p>Required validator: {data.prepared.from}</p>
        <p>Prepared recordOutcome(3, {data.prepared.outcome}, {data.prepared.resultHash}) · 0 AVAX plus gas.</p>
        <p>Immediately before authorizing, run <code>npm --prefix server run --silent phase4:prepare</code>. Require the same frozen resultHash and no earlier/pending outcome attempt. Replace only the encrypted-account alias in its freshly returned command. Enter the password only in Foundry’s local terminal prompt.</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.prepared.command}</pre>
      </div>}
      <details open={!data?.outcomeProof}><summary>Transaction recovery and public references</summary>
      <label>Public outcome transaction hash
        <input value={hash} onChange={event => setHash(event.target.value.trim())} disabled={busy} placeholder="0x…" spellCheck={false} />
      </label>
      <button disabled={busy} onClick={() => void action('refresh')}>Refresh outcome receipt &amp; registry</button>
      {operator.hash && <p>Saved outcome transaction (not proof of success): <a href={`${explorer}/tx/${operator.hash}`} target="_blank" rel="noreferrer">{operator.hash} ↗</a></p>}
      </details>
      {data && <div className="interactive-result">
        <dl className="interactive-facts"><dt>paymentRef</dt><dd>{data.paymentRef}</dd>
          <dt>Registry resultHash</dt><dd>{data.resultHash}</dd>
          <dt>Seller paidJobs</dt><dd>{data.sellerStats.paidJobs}</dd>
          <dt>Seller successfulJobs</dt><dd>{data.sellerStats.successfulJobs}</dd>
          <dt>Seller failedJobs</dt><dd>{data.sellerStats.failedJobs}</dd></dl>
        <p>Observed at Fuji block {data.observedBlock}. Expected outcome delta: paidJobs unchanged, successfulJobs unchanged, failedJobs +1.</p>
        {data.outcomeNotice && <p role="status">{data.outcomeNotice}</p>}
        {data.outcomeProof && <>
          <p><strong>Paid → Failure</strong> · receipt, event, frozen resultHash and registry readback verified.</p>
          <p>Outcome transaction: <a href={`${explorer}/tx/${data.outcomeProof.transactionHash}`} target="_blank" rel="noreferrer">{data.outcomeProof.transactionHash} ↗</a></p>
          <p>{data.outcomeProof.countersMatchExpectedDelta ? 'Outcome-block counters verified: paidJobs unchanged; successfulJobs unchanged; failedJobs +1.' : 'Aggregate counters include other activity in this block. Inspect it before attributing a counter delta.'}</p>
          {data.paymentVerified && data.expectedFault && <div role="status"><p>Payment verified ✓ · HTTP 200 ✓ · Service requirements ✕</p><p><strong>Final outcome: FAILURE</strong> · Deterministic fault injection</p><p><strong>Payment ≠ Successful Delivery</strong></p></div>}
        </>}
        {finalized && <p>This job is finalized. Execution and outcome preparation are disabled.</p>}
      </div>}
      {busy && <p role="status">Working… No transaction is being sent.</p>}
      {error && <p role="alert">{error}</p>}
    </li>
  </>
}

// Presentation only: verified claims come exclusively from the existing readback.
export function Job3Proof({ data }: { data?: Phase4Evidence }) {
  const verified = data?.registryStatus === 'Failure' && data.paymentVerified && data.expectedFault && !!data.frozen && !!data.outcomeProof
  if (!verified) return <div className="job-proof" role="status">
    <strong>{data ? `Registry status: ${data.registryStatus}` : 'Current proof not checked — refresh Job #3'}</strong>
    <p>{data?.notice ?? 'The completed acceptance run is available for read-only inspection. No service or transaction is replayed.'}</p>
    {data?.outcomeNotice && <p>{data.outcomeNotice}</p>}
  </div>
  const frozen = data.frozen!
  return <div className="job-proof" role="status">
    <p className="badge positive">Completed · Failure recorded on Fuji</p>
    <p className="eyebrow">DETERMINISTIC FAULT INJECTION</p>
    <div className="proof-verdict"><strong>Payment verified ✓</strong><strong>HTTP 200 ✓</strong><strong className="service-failure">Service requirements ✕ — temperatureC missing</strong></div>
    <p>Validation {frozen.validation.checks.filter(check => check.passed).length}/6 · <strong>Final outcome: FAILURE</strong></p>
    <pre>{frozen.response.body}</pre>
    <p>Measured response: {frozen.response.responseTimeMs} ms · schema/SLA only.</p>
    <h3>Payment ≠ Successful Delivery</h3>
    <p>The proof workflow completed successfully; the service failed validation intentionally. No factual weather-truth or returned-city equality check.</p>
    <p>Paid → Failure · receipt, outcome event and frozen resultHash match verified.</p>
    <p>Seller history: {data.sellerStats.paidJobs} paid / {data.sellerStats.successfulJobs} successful / {data.sellerStats.failedJobs} failed.</p>
    <p><a href={`${explorer}/tx/${data.paymentRef}`} target="_blank" rel="noreferrer">Inspect buyer payment ↗</a> · <a href={`${explorer}/tx/${data.outcomeProof!.transactionHash}`} target="_blank" rel="noreferrer">Inspect Failure outcome transaction ↗</a></p>
    <p>Fuji readback captured at block {data.observedBlock}. Completed by authorized operator; validation remains off-chain.</p>
    {!data.outcomeProof!.countersMatchExpectedDelta && <p role="alert">Counter changes include other activity; inspect the outcome block before attributing a delta.</p>}
    <details><summary>Full frozen evidence and registry references</summary><dl className="interactive-facts"><dt>paymentRef</dt><dd>{data.paymentRef}</dd><dt>resultHash</dt><dd>{data.resultHash}</dd></dl><pre>{frozen.canonical}</pre>
    <ul>{frozen.validation.checks.map(check => <li key={check.id}>{check.passed ? '✓' : '✕'} {labels[check.id]}</li>)}</ul></details>
  </div>
}
