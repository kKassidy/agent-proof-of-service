# Agent Proof-of-Service mock server

Run from `server` with Node.js 22+:

```sh
npm install
npm run dev
npm test
npm run typecheck
```

`npm start` runs without watch mode. The API listens on `127.0.0.1:3001`; the mock API does not initialize the optional Fuji layer.

## API

- `GET /api/sellers`: seller metrics, fractional success rates, eligibility, and rejection reasons.
- `GET /api/policy`: buyer requirements and default SLA threshold (1000 ms).
- `POST /api/demo/success`: select seller and validate a normal response.
- `POST /api/demo/failure`: select the same seller and validate a response missing temperatureC.
- `GET /api/sellers/:id/weather?city=Sydney`: each mock seller's weather response. Seller A supports `&mode=failure`.

Demo POST bodies are optional JSON objects: `{"city":"Sydney","maxResponseTimeMs":1000}`. Invalid input returns HTTP 400. Completed demos return HTTP 200 with a domain `result` of `SUCCESS` or `FAILURE`; API transport success does not imply SLA success. Unknown routes return HTTP 404.

## Scope and assumptions

Selection uses successfulJobs / verifiedJobs (null when there is no history), filters by all three policy requirements, then selects by ascending price. Equal prices are resolved by seller ID. Supplied metrics select Seller A; metrics are fixtures, not independently verified records.

Buyer calls use an in-process mock transport shared with the seller HTTP handlers. Each call has a fixed **simulated** duration of 10 ms, so results are deterministic; this is not measured network latency. The SLA threshold is configurable per demo and strictly exclusive. All six checks are returned separately. Schema checks do not establish factual weather accuracy or require city equality beyond the requested non-empty-string rule.

The failure demo simulates the service-validation portion of a future paid-but-failed scenario. **No payment occurs in either demo.** `payment.status` is `NOT_IMPLEMENTED` and `payment.reference` is null, providing a place for a future payment adapter to attach a reference. `serviceCall.delivered` and the final SLA result are separate. The demo does not use blockchain or RPC; it has no wallet, payment, database, authentication, or persistence. Results are returned for future recording; nothing is recorded now.

The API is local-only and uses no CORS headers; a later frontend can proxy `/api` to port 3001. Real transport deadlines, independently verified history, and durable result/payment correlation remain future integration work.

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
