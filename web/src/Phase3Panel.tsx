import { useRef, useState } from 'react'
import { explorer } from './evidence'
import { persistOperatorRequest, phase3PaymentHash, readOperatorState, requestPhase3, saveOperatorState, type Phase3Evidence } from './phase3'

const checkLabels = {
  networkMatches: 'RPC and transaction chain: Fuji 43113',
  transactionMatches: 'Requested tx/receipt hashes and mined block agree',
  transactionSucceeded: 'Native payment receipt succeeded',
  buyerMatches: 'Sender matches registry buyer',
  sellerMatches: 'Recipient matches registry seller',
  amountSufficient: 'Value ≥ 1,000,000,000,000 wei',
}
export default function Phase3Panel({ onRegistryState }: { onRegistryState: (state: 'Created' | 'Paid') => void }) {
  const [operator, setOperator] = useState(() => readOperatorState(localStorage))
  const [hash, setHash] = useState(operator.hash)
  const [data, setData] = useState<Phase3Evidence>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function read(action: 'verify' | 'prepare' | 'refresh') {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setData(undefined)
    try {
      // Persist uncertainty before revealing an operator command. This marker
      // is never cleared by a timeout, page refresh or a Created registry read.
      const next = persistOperatorRequest(localStorage, action, hash)
      setOperator(next); setHash(next.hash)
      const evidence = await requestPhase3(action, next.hash)
      setData(evidence)
      onRegistryState(evidence.registryStatus)
      if (evidence.confirmation) {
        const confirmed = { handedOff: true, hash: evidence.confirmation.transactionHash }
        setHash(confirmed.hash); setOperator(confirmed); saveOperatorState(localStorage, confirmed)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence unavailable. Refresh; do not resend.')
    } finally { lock.current = false; setBusy(false) }
  }
  const checks = data?.verification.checks
  return <>
    <li><h3>5. Verify payment</h3>
      <p>Backend verification of the existing Job #3 payment. This action sends no transaction.</p>
      <dl className="interactive-facts"><dt>Job ID</dt><dd>3 · approved acceptance run</dd>
        <dt>Existing native payment</dt><dd><a href={`${explorer}/tx/${phase3PaymentHash}`} target="_blank" rel="noreferrer">{phase3PaymentHash} ↗</a></dd>
        <dt>Expected minimum</dt><dd>0.000001 Fuji AVAX · 1,000,000,000,000 wei</dd></dl>
      <button disabled={busy} onClick={() => void read('verify')}>Verify payment</button>
      {data && <div className="interactive-result">
        <p role="status">{data.verification.status === 'VERIFIED' ? 'Native payment verified ✓' : 'Native payment verification rejected'} · {Object.values(checks!).filter(Boolean).length}/6 payment checks</p>
        <dl className="interactive-facts"><dt>Actual sender</dt><dd>{data.evidence.transaction?.from ?? 'Unavailable'}</dd>
          <dt>Actual recipient</dt><dd>{data.evidence.transaction?.to ?? 'Unavailable'}</dd>
          <dt>Actual amount (wei)</dt><dd>{data.evidence.transaction?.valueWei ?? 'Unavailable'}</dd>
          <dt>Native receipt</dt><dd>{data.evidence.receipt?.status ?? 'Unavailable'}</dd>
          <dt>Registry status</dt><dd>{data.registryStatus} · checked at Fuji block {data.observedBlock}</dd></dl>
        <ul>{Object.entries(checkLabels).map(([key, label]) => <li key={key}>{checks![key as keyof typeof checkLabels] ? '✓' : '✗'} {label}</li>)}</ul>
        <p>{data.readiness}</p>
      </div>}
    </li>
    <li><h3>6. Confirm payment on Fuji</h3>
      <p>Local operator approval is required. This button rechecks the backend evidence and prepares instructions; it does not sign or send. Use your existing encrypted Foundry account and its terminal password prompt.</p>
      <p>Registry status: <strong>{data?.registryStatus ?? 'Not checked — verify or refresh'}</strong></p>
      <button disabled={busy || !data?.confirmationReady || operator.handedOff} onClick={() => void read('prepare')}>Confirm payment on Fuji · prepare operator step</button>
      {operator.handedOff && <p role="status">Operator handoff or submission recorded locally. Inspect terminal/wallet activity before any further action. A timeout or Created read is not proof that submission failed. Do not send again.</p>}
      {data?.prepared && <div className="interactive-result">
        <p>Required paymentConfirmer: <strong>{data.prepared.from}</strong></p>
        <p>Immediately before authorizing, run <code>npm --prefix server run --silent phase3:prepare</code> in your terminal. Continue only with a fresh ready result and no previous/pending confirmation. Replace the account alias below with your existing encrypted account alias. Enter its password only in Foundry’s terminal prompt.</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.prepared.command}</pre>
        <p>Call: confirmPayment(3, existing payment hash). Value: 0 AVAX, plus gas. Copy the returned confirmation transaction hash below. Never repeat the command after an uncertain submission.</p>
      </div>}
      <label>Confirmation transaction hash (public, optional for recent event recovery)
        <input value={hash} onChange={event => setHash(event.target.value.trim())} disabled={busy} placeholder="0x…" spellCheck={false} />
      </label>
      <button disabled={busy} onClick={() => void read('refresh')}>Refresh confirmation receipt &amp; registry state</button>
      {operator.hash && <p>Saved confirmation transaction (receipt may still be pending): <a href={`${explorer}/tx/${operator.hash}`} target="_blank" rel="noreferrer">{operator.hash} ↗</a></p>}
      {data?.confirmationNotice && <p role="status">{data.confirmationNotice}</p>}
      {data && <div className="interactive-result">
        <dl className="interactive-facts"><dt>paymentRef</dt><dd>{data.paymentRef}</dd>
          <dt>resultHash</dt><dd>{data.resultHash}</dd>
          <dt>Seller paidJobs</dt><dd>{data.sellerStats.paidJobs}</dd>
          <dt>Seller successfulJobs</dt><dd>{data.sellerStats.successfulJobs}</dd>
          <dt>Seller failedJobs</dt><dd>{data.sellerStats.failedJobs}</dd></dl>
        <p>Payment confirmation adds 1 to paidJobs. It does not change successfulJobs or failedJobs and records no service outcome.</p>
        {data.confirmation && <>
          <p><strong>Created → Paid</strong> · successful confirmation receipt and registry readback verified.</p>
          <p>Confirmation transaction: <a href={`${explorer}/tx/${data.confirmation.transactionHash}`} target="_blank" rel="noreferrer">{data.confirmation.transactionHash} ↗</a></p>
          <p>{data.confirmation.countersMatchExpectedDelta ? 'Confirmation-block counters verified: paidJobs +1; successfulJobs and failedJobs unchanged.' : 'Aggregate counters changed beyond this payment in the confirmation block. Inspect other activity; no outcome is attributed to this payment.'}</p>
        </>}
      </div>}
      {busy && <p role="status">Reading Fuji evidence…</p>}
      {error && <p role="alert">{error}</p>}
    </li>
  </>
}
