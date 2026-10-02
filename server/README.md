# Agent Proof-of-Service mock server

Run from `server` with Node.js 22+:

```sh
npm install
npm run dev
npm test
npm run typecheck
```

`npm start` runs without watch mode. The API listens on `127.0.0.1:3001`; the mock API does not initialize the optional Fuji layer.

## Phase 3: Job #3 payment verification and operator confirmation

Phase 3 adds only read-only endpoints: `POST /api/phase3/verify`,
`POST /api/phase3/prepare`, and `POST /api/phase3/refresh`. JSON input is:

```json
{"jobId":"3","paymentTransactionHash":"0xfdbaf0372ba3b87e3d0ba77d25adac2af64c09c2d933f4584caecb1f94a143ca"}
```

An optional `confirmationTransactionHash` is accepted for receipt recovery. Other
fields are rejected, including browser-supplied buyer, seller, amount or signing
credentials. Only this approved Job #3 payment is supported. The fixed public
Fuji RPC and registry require no environment configuration. Client initialization
is lazy, on Phase 3 requests; existing mock routes retain their behavior.

The server checks Fuji 43113 and reads the registry job, paymentConfirmer and
sellerStats at one block. It checks the approved buyer, seller, canonical Tokyo
task hash, Created/Paid state, empty resultHash and completion time. It passes
the **registry's** buyer/seller and shared canonical minimum to the unchanged
`verifyNativeAvaxPayment`. Its six checks include both RPC/transaction chain ID,
requested transaction/receipt hashes, mined block agreement, receipt success,
sender, recipient, and value **at least** 1,000,000,000,000 wei. Captured evidence
is the same evidence consumed by that verifier. Phase 3 does not impose the
Phase 2 browser's exact-value/no-calldata check on this existing verifier.

For a verified Created job, a zero-value `eth_call` simulation from the on-chain
paymentConfirmer checks the real contract's authorization, state and private
consumed-payment-reference mapping. A used reference, revert or RPC failure
blocks readiness. This is not a broadcast or a signer. `prepare` repeats all
reads and verification, then returns public unsigned calldata and an operator
command. `verify` and `refresh` return no operator command. There is no send API,
wallet client, child process, password input, account lookup or key-loading code.
Errors do not echo transport details or request bodies. Responses are not cached.

### Manual acceptance (only the operator sends)

1. Start `npm --prefix server start` and `npm --prefix web run dev` in separate
   terminals from the repository root. Use the same browser origin/profile as
   Phase 2. Vite proxies `/api/phase3` to the loopback server. Production hosting
   would require a separately configured same-origin reverse proxy; it is not
   part of this local acceptance flow.
2. Do **not** create another job or click Pay Seller. Job #3 already has one
   successful native payment. Use step 5, **Verify payment**. Expect VERIFIED,
   6/6 checks, the specified buyer/seller and 1,000,000,000,000 actual wei,
   registry Created, zero paymentRef/resultHash, and readiness. Verification
   alone must not create a transaction. Record current seller counters (expected
   2 paid, 1 successful, 1 failed if there has been no other activity).
3. Use step 6, **Confirm payment on Fuji · prepare operator step**. It repeats
   preflight and displays public instructions. It **does not send**. A browser
   handoff marker prevents this button being offered again after refresh or an
   uncertain attempt. It is not an on-chain lock or proof of submission.
4. Immediately before authorization, run this read-only terminal preflight:

   ```sh
   npm --prefix server run --silent phase3:prepare
   ```

   Require exit 0, `confirmationReady: true`, `registryStatus: "Created"`,
   VERIFIED 6/6, zero current paymentRef/resultHash, the exact approved native
   payment hash, target `0x442EacAd079CcE0e3671ee0B2eb75c199f36e917`, chain 43113,
   and `prepared.value: "0"`. Confirm the returned on-chain paymentConfirmer
   equals the **public address of your existing encrypted Foundry account**.
   Confirm no pending, successful or uncertain confirmation attempt already
   exists in your terminal/wallet activity. A Created read alone cannot rule
   out a pending transaction. If there is uncertainty, stop and recover it.
5. Only when you choose to authorize, copy the freshly returned `prepared.command`
   into your own terminal and replace `YOUR_EXISTING_ENCRYPTED_ACCOUNT` with your
   existing encrypted account alias. The command is `cast send` with
   `confirmPayment(uint256,bytes32)`, job 3, the original native-payment hash as
   paymentRef, the fixed registry/RPC/chain, explicit required `--from`, zero
   value, and `--async` to return the confirmation hash promptly. The confirmer
   pays gas; this sends **no new buyer payment**.

   Keep Foundry's hidden local keystore-password prompt. Do not use private-key,
   password, password-file, mnemonic or unlocked-RPC flags. Do not enter secrets
   in the browser/API, command arguments, environment files or logs. Do not run
   this in a terminal configured to supply a password or raw key automatically.
   Do not export/decrypt/copy the account into the application. If the existing
   encrypted account cannot be used with its normal password prompt, stop.
   The application intentionally does not inspect or provision that account.
6. Save the public confirmation transaction hash immediately. Paste it into step
   6 and click **Refresh confirmation receipt & registry state**. Never repeat
   the send command because of a timeout, missing hash or still-Created read.
7. Expect Paid, paymentRef equal to the original payment hash, zero resultHash,
   a successful confirmation receipt/Snowtrace link, and **Created → Paid**.
   The backend validates the confirmation transaction's chain, hashes/block,
   zero value, registry destination, exact calldata, authorized sender and
   matching `PaymentConfirmed` event. It reads the registry before/at that
   receipt block and latest state, plus seller counters. Expect paidJobs +1
   (normally 3), successfulJobs unchanged (1), failedJobs unchanged (1).
   Stop here; no seller call, SLA validation or outcome follows.

### Recovery and limitations

Verification is not persisted as authority: every API request reruns public reads
and verification. Reload and click Verify or Refresh. Confirmation hashes and the
operator-handoff marker persist separately from the Phase 1/2 saved run; cached
data cannot declare Paid. A known confirmation hash while still Created blocks
preparation. If already Paid, the server never prepares/simulates another write.

Recent receipt recovery scans at most the last 8,192 blocks, in four bounded
2,048-block log queries. For older confirmations, paste the public hash. If RPC
history/logs/receipt lookup fails, the UI distinguishes a Paid registry read from
fully verified transition evidence, retains the hash, and asks for a read retry.
No API, CLI preflight or browser action automatically broadcasts or retries.
Two button clicks cannot submit two transactions; the actual terminal command
remains the operator's responsibility. Local storage is not a global transaction
ledger. Clearing it, changing origins or opening other operator terminals does
not establish that resubmission is safe. Never clear it as a retry mechanism.

The contract enforces unique paymentRef and Created → Paid atomically; preflight
cannot reserve a reference or eliminate a race before manual signing. A repeat
manual transaction would revert but could still waste gas, so do not resend.
The existing verifier trusts RPC inclusion data without adding a new finality
policy. Readbacks are snapshots, not irrevocable guarantees. Confirmation-block
counters are aggregate: unrelated activity in the same block can make the delta
larger; the UI reports that instead of attributing service outcomes to this job.
If roles change within a confirmation block, strict sender/readback verification
can be unavailable and requires manual inspection. No contract changes, role
changes, historical-evidence regeneration or canonical-hash changes are needed.

## API

- `GET /api/sellers`: seller metrics, fractional success rates, eligibility, and rejection reasons.
- `GET /api/policy`: buyer requirements and default SLA threshold (1000 ms).
- `POST /api/demo/success`: select seller and validate a normal response.
- `POST /api/demo/failure`: select the same seller and validate a response missing temperatureC.
- `GET /api/sellers/:id/weather?city=Sydney&scenario=success`: deterministic demo seller response. Seller A supports `scenario=failure`, returning HTTP 200 valid JSON without `temperatureC`. The legacy `mode=failure` parameter still works; `scenario` takes precedence. Invalid scenarios return HTTP 400.

Demo POST bodies are optional JSON objects: `{"city":"Sydney","maxResponseTimeMs":1000}`. Invalid input returns HTTP 400. Completed demos return HTTP 200 with a domain `result` of `SUCCESS` or `FAILURE`; API transport success does not imply SLA success. Unknown routes return HTTP 404.

## Scope and assumptions

Selection uses successfulJobs / verifiedJobs (null when there is no history), filters by all three policy requirements, then selects by ascending price. Equal prices are resolved by seller ID. Supplied metrics select Seller A; metrics are fixtures, not independently verified records.

Buyer calls use an in-process mock transport shared with the seller HTTP handlers. Each call has a fixed **simulated** duration of 10 ms, so results are deterministic; this is not measured network latency. The SLA threshold is configurable per demo and strictly exclusive. All six checks are returned separately. Schema checks do not establish factual weather accuracy or require city equality beyond the requested non-empty-string rule.

The failure demo simulates the service-validation portion of a future paid-but-failed scenario. **No payment occurs in either demo.** `payment.status` is `NOT_IMPLEMENTED` and `payment.reference` is null, providing a place for a future payment adapter to attach a reference. `serviceCall.delivered` and the final SLA result are separate. The demo does not use blockchain or RPC; it has no wallet, payment, database, authentication, or persistence. Results are returned for future recording; nothing is recorded now.

The API is local-only and uses no CORS headers; a later frontend can proxy `/api` to port 3001. Real transport deadlines, independently verified history, and durable result/payment correlation remain future integration work.

## Real local HTTP evidence

From the repository root, start the server in one terminal:

```sh
npm --prefix server start
```

In another terminal, generate one-shot SUCCESS-scenario evidence for the requested
Job #1 parameters (seller-a, Tokyo, threshold 1000 ms):

```sh
npm --prefix server run --silent evidence:http -- http://127.0.0.1:3001 seller-a Tokyo success 1000
```

This executes exactly one GET, with no retries or redirect following. It prints
public JSON containing `transport: HTTP`, `timing: MEASURED`, status, exact raw
body string, responseTimeMs, SLA validation/checks, canonical result evidence and
resultHash. JSON escapes in the output preserve the original body string.
`serviceEvidence()` supplies canonicalization and hashing. The command does not
read or bind Job #1, verify its terms/payment, finalize it, call RPC, load credentials,
or write to the blockchain. Retain the output for subsequent authorized steps.
The success scenario can still fail the SLA if the measured duration reaches 1000 ms.

`executeSellerHttp(baseUrl, sellerId, city, scenario)` in `src/sellerHttp.ts` uses
actual fetch and `response.text()` without parsing or reformatting the body.
Node's monotonic `performance.now()` measures elapsed milliseconds immediately
before fetch through full body consumption. Timing is neither simulated nor
clamped, and includes request/response transport and body reading. Non-2xx and
redirect status/body remain evidence; connection or body-read errors throw without
fabricating evidence. No timeout is currently enforced; the SLA evaluates duration
after completion. The base URL is supplied by the caller for local ephemeral tests
or an already-running server.

The seller's weather data remains **deterministic demo data**, not a live weather
oracle. HTTP transport and elapsed timing are real; validation proves only the
configured schema/status/timing checks, **not factual weather truth**. Existing
`callMockSeller()` and `runDemo()` still use deterministic simulated 10 ms evidence.
For planner integration, inject `(seller, city) => executeSellerHttp(baseUrl,
seller.id, city, 'success')` into `executeService()` after its payment prerequisite.

## Read-only Avalanche Fuji layer

`src/avalanche.ts` creates a viem public client and checks the RPC network against
Fuji chain ID **43113**. This layer is read-only: no wallet client, transaction
signing, private-key loading, or transaction submission exists yet. Native Fuji
AVAX is the MVP payment asset.

Set `AVALANCHE_FUJI_RPC_URL` and `SERVICE_PROOF_REGISTRY_ADDRESS` in the runtime
environment; `.env.example` contains only a public RPC URL and an address
placeholder. Environment files are not automatically loaded. Configuration is
required only when initializing this layer; existing demo responses are unchanged.

```ts
import { loadFujiConfig, createFujiClient, createRegistryReader } from './src/avalanche';
import { verifyNativeAvaxPayment, paymentRefForVerifiedPayment } from './src/payment';

const config = loadFujiConfig();
const client = await createFujiClient(config);
const registry = createRegistryReader(client, config.registryAddress);
// Supply the actual transaction hash, buyer, seller and positive bigint minimum.
const result = await verifyNativeAvaxPayment(client, {
  transactionHash, expectedBuyer, expectedSeller, minimumAmountWei,
});
if (result.status === 'VERIFIED') {
  const paymentRef = paymentRefForVerifiedPayment(result);
  // paymentRef is the original transaction hash as bytes32; no new identifier.
}
```

Results expose `VERIFIED` / `REJECTED`, individual checks, and a payment reference
only for verified transfers. Invalid inputs throw. RPC failures or missing/pending
receipts throw and must be treated as unavailable evidence, never payment success.
Wrong networks reject before transaction lookup. Amounts use bigint wei (1 AVAX =
10^18 wei); the minimum must be positive. Address comparison is case-insensitive.

Verification proves the specified on-chain transfer occurred, subject to the
configured RPC returning truthful chain and inclusion data. It checks the direct
transaction sender, recipient and native value, successful receipt, Fuji chain ID,
and matching transaction/receipt hashes and inclusion block. It does not verify
internal contract transfers. It does **not** by itself prove successful service
delivery, associate a transfer with a job, prevent reuse across jobs, or implement
a confirmation-depth/finality policy. Callers must handle RPC errors and possible
reorganizations; these checks are not an independent cryptographic chain proof.

`createRegistryReader` exposes `getJob`, `getSellerStats`, `getPaymentConfirmer`,
and `getValidator`. `src/registryAbi.ts` includes read functions extracted from
the existing Solidity compiler artifact for `contracts/src/ServiceProofRegistry.sol`,
including the Job tuple and uint8 enum representation, plus write signatures checked against Solidity for calldata preparation. Update it when the
contract changes. Contract read errors (including missing jobs) propagate.

The planner below binds job terms to seller/amount and verifies the expected buyer.
Live integration must establish a finality policy and submit prepared
`ServiceProofRegistry.confirmPayment` through the authorized payment confirmer.
The registry's consumed-reference protection will prevent on-chain reuse. Service
validation and outcome recording remain separate integration steps. No token-payment
protocol or identity-registry integration is provided by this layer.

All automated tests use mocked public-client boundaries or a local custom viem
transport; none depend on Fuji RPC availability.

### Payment evidence CLI

From the repository root, pass all five public inputs explicitly:

```sh
npm --prefix server run --silent evidence:payment -- <rpcUrl> <transactionHash> <expectedBuyer> <expectedSeller> <minimumAmountWei>
```

For the already-existing Job #2 payment:

```sh
npm --prefix server run --silent evidence:payment -- https://api.avax-test.network/ext/bc/C/rpc 0x28521fa0c88172f6ee5d59a87efb853b2400495f3c59118c079764a6def38fc9 0x9764b345a014D7Cf08f223e7fF5453916ee15f9B 0x0342ed8eaC11a52C247C9428c450A7288b72f484 1000000000000
```

The CLI creates a read-only viem Fuji public client and reuses
`verifyNativeAvaxPayment()`, including its RPC chain ID check (43113) before
transaction lookup. The minimum is a positive decimal integer in wei. No
environment configuration, registry address, wallet, keys, or keystore is needed
or loaded. It never signs, broadcasts, or sends AVAX.

Stdout contains only JSON fields `status`, `transactionHash`, `paymentRef`, and
`checks`. Exit code is 0 for VERIFIED and 1 for REJECTED or errors. Invalid input
or unavailable RPC evidence produces a generic stderr error and no JSON evidence;
raw transport errors and RPC URLs are not printed. Use `--silent` to suppress npm's
script banner when saving JSON.

VERIFIED proves the specified native Fuji AVAX transfer according to the verifier
checks and RPC trust assumptions above. It does **not prove service delivery**,
bind the transfer to Job #2, or record/confirm payment in the registry. The command
only reads the already-existing transfer. Automated CLI tests are offline and do
not call the real Fuji RPC.

## E2E orchestration (preparation only)

`src/orchestration.ts` exports `E2EPlanner`. It connects the existing seller policy,
registry job reads, native AVAX verifier, injected seller execution, and SLA validator.
It is an in-memory library, separate from the existing mock HTTP demo routes.
It does **not broadcast**, sign, send AVAX, load keys, or create a wallet client.
Constructing a planner or preparing calldata performs no network calls.

Public demo configuration (pass explicitly at runtime; no identities in business logic):

```ts
import { E2EPlanner, DEMO_PAYMENT_WEI } from './src/orchestration';
import { sellers } from './src/service';

const planner = new E2EPlanner({
  registryAddress: '0x442EacAd079CcE0e3671ee0B2eb75c199f36e917',
  buyer: '0x9764b345a014D7Cf08f223e7fF5453916ee15f9B',
  paymentConfirmer: '0x9764b345a014D7Cf08f223e7fF5453916ee15f9B',
  validator: '0x9764b345a014D7Cf08f223e7fF5453916ee15f9B',
  sellerAddresses: { 'seller-a': '0x0342ed8eaC11a52C247C9428c450A7288b72f484' },
  paymentAmountWei: DEMO_PAYMENT_WEI,
}, 'Sydney', 1000, sellers);
const createCall = planner.prepareCreateJob(); // PREPARED only
```

The configurable demo quote is **1,000,000,000,000 wei = 0.000001 native Fuji AVAX**,
excluding gas. The exact same positive bigint is hashed into task terms and passed
as `minimumAmountWei` to verification. Legacy `priceUsd` fixture values remain
inputs to the existing seller ranking policy; they are not the on-chain payment
quote or a conversion rate.

| Stage | Evidence required / action |
| --- | --- |
| PLANNED | Policy selects seller; validate address mapping and task terms. `prepareCreateJob()` returns calldata without advancing state. |
| JOB_CREATED | `observeJobCreated(reader, jobId)` reads Created job matching buyer, seller, taskHash, creation timestamp and empty payment/result fields. Supply actual jobId from the future createJob receipt/event, not a guess. |
| PAYMENT_VERIFIED | `verifyPayment(client, transactionHash)` runs the existing verifier against the committed buyer, seller and minimum wei. A rejection stays JOB_CREATED and exposes no confirmation call. |
| PAYMENT_CONFIRMED | After external submission, `observePaymentConfirmed(reader)` reads Paid with matching paymentRef. Preparing confirmation alone does not advance state. |
| SERVICE_EXECUTED | `executeService(execute)` obtains a response and runs existing SLA validation against committed threshold. A thrown transport error leaves PAYMENT_CONFIRMED; it is not fabricated delivery evidence. |
| OUTCOME_READY | `prepareOutcome()` hashes evidence and returns recordOutcome calldata. SLA failure maps to Failure, not a failed orchestration. |
| FINALIZED | After external submission, `observeFinalized(reader)` reads matching terminal status, resultHash, paymentRef and completion timestamp, then seller stats. Read errors or mismatches do not advance state. |

**PREPARED** means unsigned calldata, target registry, Fuji chain ID, required caller,
function name/arguments, and zero contract-call value. It proves no transaction happened.
**VERIFIED** means the payment verifier accepted included transfer evidence; it does
not mean the registry recorded that payment. **ON-CHAIN CONFIRMED** here means the
injected registry reader returned the matching Paid job. **FINALIZED** means the
matching terminal job and seller statistics were read, not consensus-level finality.
An explicit confirmation-depth/reorganization policy is still required for live use.

Prepared functions use the actual Solidity signatures:
`createJob(address,bytes32)`, `confirmPayment(uint256,bytes32)`, and
`recordOutcome(uint256,uint8,bytes32)` (**jobId, outcome, resultHash**).
Status values are Created=0, Paid=1, Success=2, Failure=3. `paymentRef` is the original
verified transaction hash, not a derived identifier. Configured confirmer/validator
addresses identify required callers; configuration does not grant on-chain authority.

Task canonicalization is a versioned fixed-position JSON tuple encoded as UTF-8
and hashed with keccak256: version, service type, exact city, seller ID, lowercase
seller address, response-time threshold, native asset label, Fuji chain ID, and
base-10 wei string. Object insertion order cannot affect it. City whitespace/case
is preserved; bigint amounts never pass through floating point.

Result canonicalization is another versioned fixed-position JSON tuple: version,
HTTP status, **exact raw body string** (never parsed/reformatted for hashing), finite
nonnegative response time, SLA result, validation scope, threshold, and ordered
`[check ID, passed]` pairs. The snapshot retains the body, validation, canonical
string and hash for audit. Success and missing-temperature responses hash differently.
The executor must supply actual measured timing in real use; `callMockSeller`
still supplies simulated 10 ms timing. Nonfinite timing is rejected as invalid evidence.

The planner owns private state and returns cloned snapshots; callers cannot advance
it by editing snapshots. Transitions reject wrong ordering and concurrent operations.
It invokes verification itself so an unrelated caller-provided VERIFIED object cannot
substitute different buyer/seller/amount terms. The injected payment client and reader
are trusted I/O boundaries: bind the reader to the configured registry on Fuji using
`createRegistryReader`. Mock readers establish only simulated evidence in tests.

For the first real E2E run, separately implement an explicitly authorized submission
adapter and durable storage of task terms, jobId, transfer hash, raw evidence and
receipts. Check the deployed confirmer and validator roles against runtime config.
Submit createJob as buyer and extract jobId from JobCreated; read back the job.
Send the configured native AVAX quote to the selected seller, then verify its hash.
Submit prepared confirmPayment as the authorized confirmer and read Paid. Execute
the actual weather service with measured timing, persist exact evidence, and prepare
recordOutcome. Submit it as the authorized validator, then read the terminal job
and seller stats. Add receipt/finality, retry/recovery and payment-reference reuse
handling; the contract enforces consumed-reference uniqueness. None of those writes
are executed by this implementation. Existing SLA validation checks schema/timing,
not factual accuracy or equality of delivered and requested city.
