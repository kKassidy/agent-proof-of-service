# Proof-of-Service dashboard

React + TypeScript Buildathon demo with a preserved read-only evidence dashboard and optional wallet interaction for Proof-of-Service for Agent Commerce.

```sh
npm --prefix web install
npm --prefix web run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm --prefix web run build
npm --prefix web run lint
```

Offline wallet tests are in `web/test/`; see the commands below.

## Evidence and live reads

- `src/evidence.ts` contains the supplied immutable Job #1 / #2 evidence and explicitly labeled seller-selection fixtures. The fixture history is not the current registry aggregate.
- `src/fuji.ts` reads `sellerStats(address)` from registry `0x442EacAd079CcE0e3671ee0B2eb75c199f36e917` for seller `0x0342ed8eaC11a52C247C9428c450A7288b72f484`.
- Browser fetch uses the public Fuji RPC, checks chain ID 43113, then uses `eth_call`. This existing statistics reader performs no signing or chain writes.
- The request has an eight-second timeout. RPC errors, incorrect chain IDs, and malformed responses use the clearly labeled known demo snapshot: 2 paid, 1 successful, 1 failed. Refresh explicitly retries; there is no background polling.
- Success rate is successful jobs divided by paid jobs. No paid jobs displays an em dash. Current live totals can differ from the two historical proofs.
- Explorer links use `https://testnet.snowtrace.io`, matching the existing server's installed Avalanche Fuji chain configuration.

No environment variables, credentials, or external fonts are required for historical evidence and statistics reads. Public RPC availability and browser CORS policy can affect live reads; historical evidence remains visible independently.

## Interactive v2 — Phase 1 creation

The additive **TRY IT ON FUJI** panel supports desktop injected wallets (EIP-6963
with legacy injection fallback). No wallet framework or backend is required.
Viem is declared in `web/package.json`. No account-access prompt occurs on load.

1. Run `npm --prefix web run dev` from the repository root and open its local URL.
2. Select MetaMask/Core and click **Connect Wallet**. Rejection leaves the dashboard usable.
3. Switch to Avalanche Fuji (43113). Use **Get Fuji AVAX** to open the external
   Core faucet if needed; funding/claiming is manual.
4. Click **Evaluate policy & select Seller A**. The 103-job history is explicitly
   illustrative and is not the on-chain sellerStats.
5. Check the Tokyo / 1,000 ms terms and task hash, then click
   **Create Proof-of-Service Job**. Approve only the Fuji contract call to
   `0x442EacAd079CcE0e3671ee0B2eb75c199f36e917` with zero native value (gas applies).
6. After a successful receipt, the panel displays the actual `JobCreated` ID,
   buyer, seller, task hash, creation transaction and Snowtrace link.
7. Switch accounts: the created job must still show its original buyer.

Task canonicalization is directly shared from `server/src/task.ts`; the existing
server export remains available from `orchestration.ts`. The historical Tokyo
terms hash is `0xe9cddd83f03f2ffa8a7748045a0447f74b1d71ea153de5387609be3bbd651cc5`.
The quote remains in the existing task format. Job creation itself sends no payment.

Only one creation is allowed per saved browser run. Local storage retains the
buyer and submitted hash; after refresh use **Check creation receipt**. A pending
or uncertain submission is never automatically resubmitted. If the browser closes
before the wallet returns its hash, inspect wallet activity manually; this phase
has no automatic transaction discovery. Do not clear `pos.phase1.creation.v1` to retry a payment. Clearing browser data
does not cancel a transaction and removes local duplicate-payment protection.

The historical Job #1/#2 cards, registry stats and trust-model section are unchanged.
Their shared-signer description refers to the historical MVP; this new creation
uses the connected user wallet. Phase 1 adds no payment, verifier calls, seller
HTTP execution, validation, or outcome recording. Created jobs remain unpaid and
do not increment paid/success/failure sellerStats.

Offline Phase 1 + Phase 2 tests (from repository root, using the existing server TS runner):

```sh
server/node_modules/.bin/tsx --test web/test/*.test.ts
```

Tests use synthetic receipts and mock injected providers; they send no transaction.
A real browser wallet approval is a separate manual acceptance test.


## Phase 2 — original buyer native payment only

Use the **same browser profile and exact origin (host and port)** as Phase 1 so
that the saved Job #3 run is available. Do not create another job to recover #3.

1. Connect the original buyer wallet on Fuji:
   `0x51b682f07424b124992C0a42600dCa15c4383aFE`.
2. After refresh, click **Check creation receipt**. Expect Job #3, its original
   buyer and the existing creation transaction
   `0x1b5b66be3f86e550556dda29b952fa95d3babedb11f8600b9da7f05f247399b0`.
3. Click **Check registry job before payment**. This checks the actual creation
   receipt and reads `getJob(3)` from the fixed registry, matching buyer, seller,
   taskHash and the unconfirmed Created state.
4. Check that another account or network disables **Pay Seller**. Restore the
   original buyer on Avalanche Fuji (43113).
5. Click **Pay Seller · 0.000001 Fuji AVAX**. Verify the wallet requests a native
   transfer from the original buyer to
   `0x0342ed8eaC11a52C247C9428c450A7288b72f484`, exactly
   **1,000,000,000,000 wei**, plus gas, on Fuji, with **no calldata**. Approve manually.
6. The hash is saved immediately when returned. A successful receipt and matching
   transfer details produce **Native payment confirmed**. The original job and
   creation proof stay visible. Registry status remains **Created**, awaiting
   Proof-of-Service payment verification; native payment does not call it Paid.
7. Refresh, recheck the creation receipt, registry job, and **Check saved payment
   receipt**. The saved hash must remain, and payment must stay disabled.

The payment helper only reads public Fuji state and delegates a native transfer to
an injected wallet. It does not call the backend, `confirmPayment`, seller HTTP,
SLA validation, or `recordOutcome`. SellerStats do not change from this transfer.

Before the wallet prompt, a durable intent is written under the existing saved-run
key. Web Locks serialize payment attempts across same-origin tabs. Storage is
reread under that lock; any existing attempt blocks repayment. Wallet transport
retries are disabled. A creation-receipt refresh cannot erase a payment marker.

A timeout is never treated as failure: check the saved hash rather than resending.
If no hash was returned, inspect wallet activity manually. Any attempt, including
explicit rejection, reverted receipt or mismatched replacement, remains blocked
in this conservative Phase 2 UI; no automatic or normal retry action is offered.
If saving a returned hash fails, the hash remains visible for copying and the
previous durable intent still blocks repayment on refresh. Receipt checks can be
retried without sending a transaction. Replacement/cancellation hashes are saved,
but only the exact expected native transfer can be shown as confirmed.

Limitations: browser storage is not a global payment ledger. Clearing storage,
changing browser/profile/origin, or manually paying outside this app bypasses its
local protection. Lost storage requires manual reconciliation, not recreating or
repaying Job #3. Web Locks and writable local storage are required (localhost or
HTTPS on a supported desktop browser). There is no unattended recovery service.
All tests use mocks; real wallet approval remains a manual acceptance step.

## Phase 3 — backend verification, manual operator confirmation

Steps 5 and 6 are restricted to the existing approved Job #3 payment. Start the
loopback backend with `npm --prefix server start`, then run this frontend using
the same Phase 2 browser origin/profile. Vite proxies only `/api/phase3` to
`http://127.0.0.1:3001`. No signing credentials or environment files are required.

**Verify payment** calls the backend's unchanged native-payment verifier using
registry buyer/seller and canonical terms. It displays actual sender/recipient,
wei, receipt status, each of the six checks, and observed registry state. It
does not prompt a wallet or send a transaction. All backend readiness and state
are refreshed on demand; browser storage is never verification authority.

**Confirm payment on Fuji · prepare operator step** is a separate action. It
rechecks the backend evidence and simulation, then shows a public terminal
command for the authorized paymentConfirmer. The browser cannot sign or send
it. Use the existing encrypted Foundry account, with its local password prompt;
never enter a password or key in the UI/API. Run the read-only terminal preflight
immediately before deciding whether to authorize the separate `cast send`.
See [the complete operator acceptance procedure](../server/README.md#manual-acceptance-only-the-operator-sends).

After sending manually, save/paste the confirmation hash and use **Refresh
confirmation receipt & registry state**. Expect Created → Paid, a validated
receipt/Snowtrace link, original payment hash as paymentRef, paidJobs +1, and
unchanged successfulJobs/failedJobs. These live counters are shown in step 6;
the historical dashboard and its existing explicit stats refresh are unchanged.
No service execution or outcome is performed.

`pos.phase3.operator.v1` stores only the handoff marker and public confirmation
hash. Reload does not erase an uncertain attempt or offer another normal handoff.
Receipt lookups and registry refreshes never send. If a handoff was started but
instructions were lost to a reload/RPC error, the terminal preflight can recover
public instructions; only proceed after manually ruling out an earlier send.
An already-Paid job is recovered without preparing another call. Recent events
can recover the hash automatically; older events require pasting the hash. A
Paid read with unavailable receipt is labeled accordingly, not fabricated as a
verified transition. Do not clear storage or resend after a timeout.

## Phase 4 — deterministic fault injection and frozen outcome evidence

**Job #3 real Fuji acceptance is complete: Failure, counters 3/1/2.** Recover
using refresh only; do not execute or record its outcome again. The [acceptance
record](../server/README.md#phase-4-frozen-job-3-service-evidence-and-manual-outcome)
documents its public resultHash and outcome transaction separately from unchanged
historical Job #1/#2 evidence. The procedure below describes the completed flow.
The validator/operator is trusted to attest the measured evidence; the contract
does not validate HTTP itself. This demonstration makes no production-readiness claim.

Steps 7 and 8 extend the existing flow for Paid Job #3. Start the same loopback
server on port 3001; Vite proxies `/api/phase4` without exposing a signer.
Use **Refresh Job #3 & frozen evidence** first. Nothing executes on page load.

**Execute & validate · deterministic fault injection** explicitly requests the
existing measured Seller A HTTP route in failure mode for Tokyo. The exact raw
body is `{"city":"Tokyo","condition":"clear"}`: temperatureC is intentionally
omitted. This demonstrates schema failure despite successful payment and HTTP
200, not random/production seller unreliability. The existing validator still
checks schema/timing only; it checks nonempty city, not requested-city equality,
and does not verify factual weather truth.

The backend freezes the raw response, measured timing, six checks, validation,
canonical string and resultHash under ignored `.runtime/phase4-job3/`. A refresh
must return the same evidence/hash, not another measurement. Only the expected
5/6 FAILURE, with finite temperatureC as the sole failed check, may proceed.
Slower-than-SLA or otherwise unexpected evidence is retained and blocks outcome
preparation. An incomplete execution attempt also blocks reruns. Do not remove
runtime files or clear browser storage to retry.

**Prepare recordOutcome · local operator** is separate. It rechecks frozen
evidence and Paid state and simulates the authorized validator call. The command
uses the existing Failure enum (3), Job #3, and the actual frozen resultHash.
It does not broadcast. Follow the [manual acceptance and operator procedure](../server/README.md#manual-job-3-browser-acceptance-and-operator-procedure),
including a fresh `npm --prefix server run --silent phase4:prepare` immediately
before your manual authorization. Enter the encrypted-account password only in
Foundry's local prompt, never in this UI or API.

Paste the resulting public outcome hash into step 8 and refresh. Expect
**Paid → Failure**, unchanged paymentRef, the frozen resultHash, and counters
**3 paid / 1 successful / 2 failed**. After verified receipt/readback, the UI shows:
**Payment verified ✓ · HTTP 200 ✓ · Service requirements ✕ · Final outcome:
FAILURE**, explicitly labeled deterministic fault injection, and
**Payment ≠ Successful Delivery**.

On reload, use step 7/8 refresh to recover final state before earlier-phase
controls. Frozen server evidence is authoritative; the browser stores only a
Phase 4 handoff marker and public outcome hash under `pos.phase4.operator.v1`.
Timeouts never trigger automatic execution or transaction retries. Recent
outcome events can recover the hash; older ones require pasting it. Finalized
jobs cannot execute or prepare again. Runtime directory loss/corruption, RPC
outages or uncertain terminal sends require reconciliation, not a new run.
