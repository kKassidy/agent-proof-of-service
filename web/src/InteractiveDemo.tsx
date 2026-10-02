import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { type Address, type Hash } from 'viem'
import { explorer, seller } from './evidence'
import { decodeCreatedJob, discoverWallets, evaluatePolicy, fujiBalance, fujiClient, FUJI_CHAIN_ID, policy, submitCreateJob, switchToFuji, taskHash, walletError, walletState, type CreatedJob, type Wallet } from './wallet'

import { readRun, saveRun, storageKey, validateJobForPayment, requestPayment, checkPayment, paymentBlocked, paymentMessage, type Run } from './payment'
import Phase3Panel from './Phase3Panel'

function InteractivePanel() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [selected, setSelected] = useState('')
  const wallet = wallets.find(w => w.id === selected) ?? wallets[0]
  const [account, setAccount] = useState<Address>()
  const [chain, setChain] = useState<number>()
  const [balance, setBalance] = useState('—')
  const [evaluation, setEvaluation] = useState<ReturnType<typeof evaluatePolicy>>()
  const [run, setRun] = useState<Run | undefined>(() => readRun(localStorage))
  const [jobReady, setJobReady] = useState(false)
  const [paymentChecked, setPaymentChecked] = useState(false)
  const [phase3State, setPhase3State] = useState<'Created' | 'Paid'>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [message, setMessage] = useState('Connect a desktop wallet to begin. Historical evidence remains available below.')
  const [error, setError] = useState('')
  useEffect(() => discoverWallets(window, candidate => setWallets(current => current.some(w => w.provider === candidate.provider) ? current : [...current, candidate])), [])
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return
      setJobReady(false); setPaymentChecked(false)
      try {
        const saved = readRun(localStorage)
        setRun(previous => saved && previous && previous.hash === saved.hash && previous.buyer.toLowerCase() === saved.buyer.toLowerCase() ? { ...saved, job: previous.job } : saved)
      } catch { setError('Saved run cannot be read. Inspect wallet activity; payment is blocked.') }
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    if (!wallet) return
    let active = true
    let revision = 0
    const sync = async () => {
      const request = ++revision
      setBalance('—')
      try {
        const state = await walletState(wallet.provider)
        if (active && request === revision) { setAccount(state.account); setChain(state.chainId) }
      } catch { if (active && request === revision) { setAccount(undefined); setChain(undefined) } }
    }
    const disconnect = () => { revision++; setAccount(undefined); setChain(undefined); setBalance('—') }
    wallet.provider.on('accountsChanged', sync)
    wallet.provider.on('chainChanged', sync)
    wallet.provider.on('disconnect', disconnect)
    void sync()
    return () => {
      active = false
      wallet.provider.removeListener('accountsChanged', sync)
      wallet.provider.removeListener('chainChanged', sync)
      wallet.provider.removeListener('disconnect', disconnect)
    }
  }, [wallet])
  useEffect(() => {
    if (!account) return
    let active = true
    fujiBalance(account).then(value => { if (active) setBalance(value) }).catch(() => { if (active) setBalance('Unavailable') })
    return () => { active = false }
  }, [account, chain, run?.job, run?.payment?.status])
  async function action(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await work() } catch (err) { setError(walletError(err)) }
    finally { lock.current = false; setBusy(false) }
  }
  function remember(value: Run) {
    // Save before requesting a signature, preventing accidental resubmission after refresh.
    const saved = saveRun(localStorage, value)
    setRun(saved)
  }
  async function receipt(value: Run) {
    if (!value.hash) return
    setMessage('Waiting for the Fuji receipt. This does not submit another transaction.')
    const client = fujiClient()
    if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('Unexpected RPC network')
    const result = await client.waitForTransactionReceipt({ hash: value.hash, confirmations: 1, timeout: 120000,
      onReplaced: replacement => { value = { ...value, hash: replacement.transaction.hash }; remember(value) },
    })
    if (result.status !== 'success') { setMessage('Creation transaction reverted. No job was confirmed; inspect the transaction.'); return }
    let job: CreatedJob
    try { job = decodeCreatedJob(result, value.buyer) }
    catch { setMessage('Receipt received, but no matching JobCreated event was verified. Inspect the transaction; do not submit another job.'); return }
    remember({ ...value, hash: job.transactionHash, job })
    setJobReady(false)
    setMessage('Creation receipt validated. Check the registry job before paying Seller A.')
  }
  const boundToOtherAccount = run && account?.toLowerCase() !== run.buyer.toLowerCase()
  return <section className="section interactive" id="try-fuji">
    <div className="section-heading"><div><p className="eyebrow">TRY IT ON FUJI</p><h2>Create your own Proof-of-Service job.</h2></div><span className="badge neutral">Phase 3 · Verify &amp; confirm payment</span></div>
    <p className="section-intro">Create a job, then explicitly approve a native Fuji AVAX payment. Native payment and registry payment confirmation are separate steps.</p>
    <ol className="interactive-steps">
      <li><h3>1. Connect wallet</h3>
        {wallets.length ? <label>Desktop wallet <select value={wallet?.id ?? ''} disabled={busy} onChange={e => { setSelected(e.target.value); setAccount(undefined); setChain(undefined); setBalance('—') }}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : <p>No injected wallet detected. Install or enable MetaMask or Core, then reload. You can still explore the dashboard.</p>}
        <div className="interactive-actions"><button disabled={!wallet || busy} onClick={() => void action(async () => {
          const state = await walletState(wallet!.provider, true); setAccount(state.account); setChain(state.chainId)
          setMessage(state.account ? 'Wallet connected. Evaluate the seller and switch to Fuji if needed.' : 'No account selected in wallet.')
        })}>Connect Wallet</button><button disabled={!wallet || busy || chain === FUJI_CHAIN_ID} onClick={() => void action(async () => {
          await switchToFuji(wallet!.provider); const state = await walletState(wallet!.provider); setAccount(state.account); setChain(state.chainId)
        })}>Switch to Avalanche Fuji</button><a href="https://core.app/tools/testnet-faucet/" target="_blank" rel="noreferrer">Get Fuji AVAX ↗</a></div>
        <dl className="interactive-facts"><dt>Account</dt><dd>{account ?? 'Not connected'}</dd><dt>Current network</dt><dd>{chain === FUJI_CHAIN_ID ? 'Avalanche Fuji (43113)' : chain ? `Chain ${chain} · switch to Fuji` : 'Not connected'}</dd><dt>Fuji AVAX balance</dt><dd>{account ? balance : '—'}</dd></dl>
        <p className="section-note">Job creation requires Fuji AVAX for gas. The faucet opens externally; claiming is manual.</p>
      </li>
      <li><h3>2. Evaluate seller</h3><p className="eyebrow">ILLUSTRATIVE PRE-PURCHASE HISTORY</p>
        <p>Policy: at least {policy.minimumVerifiedJobs} jobs, {policy.minimumSuccessRate * 100}% success, maximum ${policy.maximumPriceUsd.toFixed(2)} illustrative price.</p>
        <button disabled={busy || !!run} onClick={() => { setEvaluation(evaluatePolicy()); setMessage('Seller A qualifies and is selected for this job.') }}>Evaluate policy &amp; select Seller A</button>
        {evaluation && <ul>{evaluation.map(item => <li key={item.seller.id}><strong>{item.seller.name}: {item.eligible ? 'Eligible · Seller A selected' : 'Rejected'}</strong><p>{item.seller.verifiedJobs} illustrative jobs · {item.successRate === null ? 'No success history' : `${(item.successRate * 100).toFixed(1)}% success`} · ${item.seller.priceUsd} quoted price</p><p>{item.eligible ? 'Meets the minimum history, success rate, and maximum price requirements.' : item.rejectionReasons.join(' · ')}</p></li>)}</ul>}
        <p className="section-note">These fixture metrics are not registry history. The real Fuji sellerStats remain in the existing history section.</p>
      </li>
      <li><h3>3. Create job</h3><p className="eyebrow">REAL AVALANCHE FUJI PROOF</p>
        <p>Weather schema request · Tokyo · SLA below 1,000 ms. Existing task terms include a 0.000001 AVAX quote; this action only creates an unpaid job.</p>
        <dl className="interactive-facts"><dt>Seller A</dt><dd>{seller}</dd><dt>Expected taskHash</dt><dd>{taskHash}</dd></dl>
        <button disabled={busy || !!run || !account || chain !== FUJI_CHAIN_ID || !evaluation} onClick={() => void action(async () => {
          const buyer = account!
          const pending: Run = { buyer }
          remember(pending); setMessage('Approve the zero-value createJob contract call in your wallet. Gas applies.')
          let hash: Hash
          try { hash = await submitCreateJob(wallet!.provider, buyer) }
          catch (err) {
            // Only explicit rejection is safe to reset automatically. Unknown errors may follow broadcast.
            if (walletError(err).startsWith('Wallet request rejected')) { localStorage.removeItem(storageKey); setRun(undefined) }
            else setMessage('Submission is uncertain. Inspect wallet activity before starting any other job.')
            throw err
          }
          const submitted = { buyer, hash }; remember(submitted); await receipt(submitted)
        })}>Create Proof-of-Service Job</button>
        {run && <div className="interactive-result">
          <p><strong>Run buyer:</strong> {run.buyer}</p>
          {boundToOtherAccount && <p role="alert">This run belongs to {run.buyer}. Changing wallets or accounts does not change its buyer.</p>}
          {run.hash ? <><p>Creation transaction: <a href={`${explorer}/tx/${run.hash}`} target="_blank" rel="noreferrer">{run.hash} ↗</a></p>{!run.job && <button disabled={busy} onClick={() => void action(() => receipt(run))}>Check creation receipt</button>}</> : <p>Check your wallet for the pending request or transaction. Automatic resubmission is blocked.</p>}
          {run.job && <dl className="interactive-facts"><dt>Actual Job ID</dt><dd>{run.job.jobId}</dd><dt>Buyer</dt><dd>{run.job.buyer}</dd><dt>Seller</dt><dd>{run.job.seller}</dd><dt>taskHash</dt><dd>{run.job.taskHash}</dd><dt>Transaction status</dt><dd>Success · matching JobCreated event confirmed</dd><dt>Registry job state at creation</dt><dd>Created · no registry payment confirmation</dd></dl>}
        </div>}
      </li>
      <li><h3>4. Pay seller</h3><p className="eyebrow">NATIVE FUJI AVAX TRANSFER</p>
        <p>Send exactly <strong>0.000001 Fuji AVAX (1,000,000,000,000 wei)</strong>, plus wallet gas, directly to Seller A. No contract calldata.</p>
        <dl className="interactive-facts"><dt>Original buyer / From</dt><dd>{run?.buyer ?? 'Create or recover a job first'}</dd><dt>To / Seller A</dt><dd>{seller}</dd><dt>Network</dt><dd>Avalanche Fuji · 43113</dd><dt>Pre-payment registry check</dt><dd>{run?.job?.jobId === '3' && phase3State === 'Paid' ? 'Paid · last backend check; see step 6' : jobReady ? 'Created · unpaid in registry (last checked)' : 'Not checked for payment — validate the saved job first'}</dd></dl>
        {boundToOtherAccount && <p role="alert">Select the original buyer wallet {run?.buyer} to pay. This run will not be rebound to another account.</p>}
        <div className="interactive-actions">
          <button disabled={busy || !run?.job} onClick={() => void action(async () => {
            setJobReady(false)
            await validateJobForPayment(run!)
            setJobReady(true)
            setMessage('Registry read confirms the original Created job and approved terms. Native payment is separate from registry confirmation.')
          })}>Check registry job before payment</button>
          <button disabled={busy || !wallet || !jobReady || paymentBlocked(run, account, chain)} onClick={() => void action(async () => {
            setPaymentChecked(false)
            setMessage('Check the exact recipient and 0.000001 AVAX value in your wallet. Approve only if correct.')
            let latest = run!
            const update = (value: Run) => { latest = value; setRun(value) }
            await requestPayment(wallet!.provider, latest, localStorage, update)
            setMessage('Native payment submitted. Waiting for receipt; never retry a payment because of a timeout.')
            const confirmed = await checkPayment(latest, localStorage, update)
            setPaymentChecked(confirmed.payment?.status === 'confirmed')
            setMessage(paymentMessage(confirmed.payment, true))
          })}>Pay Seller · 0.000001 Fuji AVAX</button>
        </div>
        <p role="status">{run?.job?.jobId === '3' && phase3State === 'Paid' ? 'Job #3 is Paid in the registry (last backend check). Do not send another payment.' : paymentMessage(run?.payment, paymentChecked)}</p>
        {run?.payment && <div className="interactive-result">
          <dl className="interactive-facts"><dt>Payment amount</dt><dd>0.000001 Fuji AVAX · 1,000,000,000,000 wei</dd><dt>From (expected)</dt><dd>{run.buyer}</dd><dt>To (expected)</dt><dd>{seller}</dd><dt>Native receipt status</dt><dd>{paymentChecked ? 'Success · exact native transfer confirmed' : `${run.payment.status} · use receipt check for current evidence`}</dd></dl>
          {run.payment.hash && <><p>Payment transaction: <a href={`${explorer}/tx/${run.payment.hash}`} target="_blank" rel="noreferrer">{run.payment.hash} ↗</a></p><button disabled={busy || !run.job} onClick={() => void action(async () => {
            setPaymentChecked(false)
            const confirmed = await checkPayment(run, localStorage, setRun)
            setPaymentChecked(confirmed.payment?.status === 'confirmed')
            setMessage(paymentMessage(confirmed.payment, true))
          })}>Check saved payment receipt</button></>}
          <p>The native transfer itself does not change registry status. Steps 5 and 6 show backend verification and the latest registry read.</p>
        </div>}
      </li>
      <Phase3Panel onRegistryState={setPhase3State} />
    </ol>
    <p role="status" aria-live="polite">{busy ? 'Working… ' : ''}{message}</p>{error && <p className="interactive-error" role="alert">{error}</p>}
  </section>
}
export default class InteractiveDemo extends Component<object, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render(): ReactNode { return this.state.failed ? <section className="section"><h2>Try it on Fuji</h2><p>Wallet interaction is unavailable. The historical dashboard remains available below.</p></section> : <InteractivePanel /> }
}
