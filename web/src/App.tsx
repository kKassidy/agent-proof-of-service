import { useEffect, useState } from 'react'
import { explorer, jobs, registry, seller, sellers } from './evidence'
import { readSellerStats, snapshot, type Stats } from './fuji'
import './App.css'
import InteractiveDemo from './InteractiveDemo'

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`
function ExplorerLink({ value, kind = 'tx', label }: { value: string; kind?: 'tx' | 'address'; label: string }) {
  return <a className="hash" href={`${explorer}/${kind}/${value}`} target="_blank" rel="noreferrer" title={value} aria-label={`${label}: ${value} (opens explorer in new tab)`}>{short(value)} <span aria-hidden="true">↗</span></a>
}
function History() {
  const [state, setState] = useState<{ stats: Stats; source: 'loading' | 'live' | 'snapshot' }>({ stats: snapshot, source: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    readSellerStats(controller.signal).then(stats => {
      if (!controller.signal.aborted) setState({ stats, source: 'live' })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ stats: snapshot, source: 'snapshot' })
    })
    return () => controller.abort()
  }, [attempt])
  const { stats, source } = state
  const rate = stats.paid === 0n ? '—' : `${Number(stats.success * 1000n / stats.paid) / 10}%`
  return <section id="history" className="section">
    <div className="section-heading"><div><p className="eyebrow">03 / THE RECORD</p><h2>On-chain service history</h2></div><span className={`badge ${source === 'live' ? 'positive' : 'neutral'}`} role="status">{source === 'live' ? '● Live from Fuji' : source === 'loading' ? 'Snapshot · checking Fuji…' : 'Snapshot · RPC unavailable'}</span></div>
    <p className="section-intro">Real Proof-of-Service records on Avalanche Fuji · independent of the demo selection scenario.</p>
    <div className="history-panel"><div className="history-identity"><div><strong>Seller A</strong><p>Registry aggregate · chain 43113</p></div><ExplorerLink value={seller} kind="address" label="Seller A address" /></div>
      <div className="stats">{[['Paid jobs', stats.paid.toString()], ['Successful jobs', stats.success.toString()], ['Failed jobs', stats.failed.toString()], ['Verified success rate', rate]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="history-note"><p>{source === 'live' ? 'Read directly from sellerStats. Success rate = successful jobs / paid jobs. Current totals may grow beyond the two historical jobs.' : 'Historical snapshot covering Jobs #1/#2: 2 paid, 1 successful, 1 failed. Success rate = successful jobs / paid jobs.'} These registry totals are separate from the illustrative pre-purchase selection scenario above.</p><button disabled={source === 'loading'} onClick={() => { setState({ stats: snapshot, source: 'loading' }); setAttempt(n => n + 1) }}>Refresh stats <span aria-hidden="true">↻</span></button></div>
    </div>
  </section>
}
function App() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark" aria-hidden="true">P<span>✓</span></span>Proof-of-Service <span className="brand-tag">BUILDATHON MVP</span></a><nav aria-label="Main navigation"><a href="#try-fuji">Job #3 proof</a><a href="#evidence">History</a><a href="#history">Registry</a><a href="#trust">Trust model</a></nav><span className="network"><span aria-hidden="true">▲</span> Avalanche Fuji</span></header>
    <main id="main">
      <section className="hero"><div className="hero-copy"><span className="badge neutral"><span className="live-dot" /> Avalanche Fuji · Completed proof run</span><h1>Proof-of-Service<br />for <span>Agent Commerce</span></h1><p className="subtitle">Bind agent reputation to verifiable economic interactions.</p><p className="hero-description">Verify money moved. Record whether the service met its requirements.</p><div className="hero-actions"><a className="primary-button" href="#try-fuji">Inspect Job #3 proof <span aria-hidden="true">↗</span></a><span className="contract-link">Registry <ExplorerLink value={registry} kind="address" label="Registry contract" /></span></div></div>
        <aside className="hero-thesis"><p className="eyebrow">JOB #3 · COMPLETED PROOF</p><h2>Payment <span>≠</span><br />Successful Delivery.</h2><p>Real wallet payment.<br />Measured HTTP response.<br /><strong>Recorded service failure.</strong></p><p>Deterministic fault injection · inspect and refresh the proof below. Recorded acceptance is distinct from a fresh live read.</p></aside>
      </section>
      <p className="section-intro">Fuji records the economic interaction and enforces authorized job transitions, unique payment references, and final outcome integrity. Service-response validation remains off-chain.</p>
      <InteractiveDemo />
      <section className="section" id="selection"><div className="section-heading"><div><p className="eyebrow">01 / THE DECISION</p><h2>Illustrative policy before purchase.</h2></div><span className="badge neutral">Illustrative fixture · not registry reputation</span></div>
        <div className="policy"><strong>BUYER POLICY</strong><span>Verified jobs <b>≥ 20</b></span><span>Success rate <b>≥ 90%</b></span><span>Maximum price <b>$0.02</b></span></div>
        <p className="scenario-note">Seller selection uses illustrative pre-purchase history. The Proof-of-Service records below are real Avalanche Fuji transactions.</p>
        <div className="seller-grid">{sellers.map(s => <article key={s.id} className={`seller-card ${s.selected ? 'selected' : ''}`}><div className="card-top"><span className="seller-id">SELLER {s.id}</span><span className={`badge ${s.selected ? 'positive' : 'neutral'}`}>{s.selected ? '✓ ELIGIBLE / SELECTED' : 'REJECTED'}</span></div><h3>{s.name}</h3><div className="seller-price"><span className="price-label">Demo quoted price</span>{s.price}<span> / request</span></div><dl className="seller-metrics"><div><dt>Verified jobs</dt><dd>{s.jobs}</dd></div><div><dt>Success / failures</dt><dd>{s.success} / {s.failures}</dd></div><div><dt>Success rate</dt><dd className={s.selected ? 'positive-text' : ''}>{s.rate}</dd></div></dl><p className="seller-reason">{s.selected ? '✓' : '−'} {s.reason}</p></article>)}</div>
        <p className="section-note">The Buyer Agent applies explicit policy over raw verifiable metrics rather than relying on star ratings. No arbitrary trust score.</p>
      </section>
      <section className="section" id="evidence"><div className="section-heading"><div><p className="eyebrow">HISTORICAL SUPPORTING EVIDENCE</p><h2>Historical Supporting Evidence</h2></div><span className="badge neutral">Real Fuji transactions · real HTTP</span></div><p className="section-intro">Historical Jobs #1 and #2 both returned HTTP 200. Only Job #1 satisfied the machine-verifiable service contract.</p>
        <div className="proof-grid">{jobs.map(job => <article className={`proof-card ${job.success ? 'success' : 'failure'}`} key={job.id}><div className="proof-title"><div><p className="eyebrow">JOB #{job.id}</p><h3>Verified {job.success ? 'success' : 'failure'}</h3></div><span className="outcome-icon" aria-hidden="true">{job.success ? '✓' : '×'}</span></div><p className="task">Weather schema request · Tokyo</p>
          <ol className="timeline"><li><div className="step-heading"><h4>Payment authenticated</h4><span className="badge positive">VERIFIED</span></div><p><strong>0.000001 AVAX</strong><span>6 / 6 checks passed</span></p><div className="reference"><span>Payment tx</span><ExplorerLink value={job.payment} label={`Job ${job.id} payment transaction`} /></div></li>
          <li><div className="step-heading"><h4>Service response received</h4><span className="badge neutral">REAL HTTP</span></div><p><strong>HTTP 200</strong><span>{job.latency} ms measured</span></p><div className="code-label">EXACT RESPONSE</div><pre><code>{job.response}</code></pre></li>
          <li className="validation"><div className="step-heading"><h4>SLA validated</h4><strong>{job.checks} / 6 checks passed</strong></div><p className="validation-message">{job.success ? 'All machine-verifiable requirements satisfied.' : <><span className="failed-label">Failed requirement</span><strong>temperatureC must be a finite number</strong></>}</p></li></ol>
          <div className="proof-footer"><div className="final-outcome"><span>FINAL OUTCOME</span><strong>{job.success ? 'SUCCESS' : 'FAILURE'}</strong></div><div className="reference"><span>resultHash</span><code className="result-hash" title={job.result} tabIndex={0}>{job.result}</code></div><div className="reference"><span>Outcome tx</span><ExplorerLink value={job.outcome} label={`Job ${job.id} outcome transaction`} /></div></div>
        </article>)}</div>
      </section>
      <History />
      <section className="section" id="flow"><div className="section-heading"><div><p className="eyebrow">04 / THE MECHANISM</p><h2>From intent to verifiable history.</h2></div></div><ol className="flow">{['Buyer Agent', 'Policy + Job Creation', 'Avalanche Payment', 'Seller HTTP Service', 'SLA Validation', 'Proof recorded on Fuji'].map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span><strong>{step}</strong>{i === 4 && <small>SUCCESS / FAILURE</small>}{i === 5 && <small>Verifiable history</small>}{i < 5 && <b aria-hidden="true">→</b>}</li>)}</ol><p className="section-note">Payment proof and service outcome are separate pieces of evidence. The registry connects them into an auditable service history.</p></section>
      <section className="section trust" id="trust">
        <div className="section-heading"><div><p className="eyebrow">05 / THE BOUNDARIES</p><h2>MVP trust model</h2></div></div>
        <div className="trust-groups">
          <div className="trust-group"><h3>Verified by this MVP</h3><ul>
            <li>Payment authenticity from Avalanche Fuji transaction evidence.</li>
            <li>Machine-verifiable service outcome against schema/SLA rules.</li>
            <li>Contract-enforced payment-reference uniqueness and final outcome integrity.</li>
          </ul></div>
          <div className="trust-group limitations"><h3>Explicit limitations</h3><ul>
            <li>Deterministic demo weather content; no factual weather-truth claim.</li>
            <li>Historical Jobs #1/#2 shared a buyer/verifier signer. Job #3 used a buyer wallet and trusted local operators for registry writes; verification is not decentralized.</li>
            <li>No claim of Sybil resistance.</li>
            <li>No arbitrary trust score is used.</li>
          </ul></div>
        </div>
      </section>
    </main><footer><span>Proof-of-Service <span className="muted">/ for Agent Commerce</span></span><span>Inspect proof without a wallet · Wallet and operator actions are separate</span></footer>
  </>
}
export default App
