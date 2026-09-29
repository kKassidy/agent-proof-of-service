# Proof-of-Service dashboard

Read-only React + TypeScript Buildathon demo for Proof-of-Service for Agent Commerce.

```sh
npm --prefix web install
npm --prefix web run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm --prefix web run build
npm --prefix web run lint
```

There is currently no web test suite.

## Evidence and live reads

- `src/evidence.ts` contains the supplied immutable Job #1 / #2 evidence and explicitly labeled seller-selection fixtures. The fixture history is not the current registry aggregate.
- `src/fuji.ts` reads `sellerStats(address)` from registry `0x442EacAd079CcE0e3671ee0B2eb75c199f36e917` for seller `0x0342ed8eaC11a52C247C9428c450A7288b72f484`.
- Browser fetch uses the public Fuji RPC, checks chain ID 43113, then uses `eth_call`. There are no wallet integrations, signing operations, or chain writes.
- The request has an eight-second timeout. RPC errors, incorrect chain IDs, and malformed responses use the clearly labeled known demo snapshot: 2 paid, 1 successful, 1 failed. Refresh explicitly retries; there is no background polling.
- Success rate is successful jobs divided by paid jobs. No paid jobs displays an em dash. Current live totals can differ from the two historical proofs.
- Explorer links use `https://testnet.snowtrace.io`, matching the existing server's installed Avalanche Fuji chain configuration.

No environment variables, credentials, external fonts, or new dependencies are required. Public RPC availability and browser CORS policy can affect live reads; historical evidence remains visible independently.
