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
and `getValidator`. `src/registryAbi.ts` is the read-only ABI subset extracted from
the existing Solidity compiler artifact for `contracts/src/ServiceProofRegistry.sol`,
including the Job tuple and uint8 enum representation. Regenerate it when the
contract changes. Contract read errors (including missing jobs) propagate.

Later integration must bind trusted job terms to buyer/seller/amount, establish a
finality policy, and link payment authenticity to
`ServiceProofRegistry.confirmPayment` through the authorized payment confirmer.
The registry's consumed-reference protection will prevent on-chain reuse. Service
validation and outcome recording remain separate integration steps. No token-payment
protocol or identity-registry integration is provided by this layer.

All automated tests use mocked public-client boundaries or a local custom viem
transport; none depend on Fuji RPC availability.
