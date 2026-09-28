# Agent Proof-of-Service mock server

Run from `server` with Node.js 22+:

```sh
npm install
npm run dev
npm test
npm run typecheck
```

`npm start` runs without watch mode. The API listens on `127.0.0.1:3001`; no environment variables are read by application code.

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

The failure demo simulates the service-validation portion of a future paid-but-failed scenario. **No payment occurs in either demo.** `payment.status` is `NOT_IMPLEMENTED` and `payment.reference` is null, providing a place for a future payment adapter to attach a reference. `serviceCall.delivered` and the final SLA result are separate. There is no blockchain, RPC, wallet, payment, database, authentication, or persistence. Results are returned for future recording; nothing is recorded now.

The API is local-only and uses no CORS headers; a later frontend can proxy `/api` to port 3001. Real transport deadlines, independently verified history, and durable result/payment correlation remain future integration work.
