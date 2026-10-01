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

## Interactive v2 — Phase 1 only

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
The quote remains in the existing task format, but no payment is sent.

Only one creation is allowed per saved browser run. Local storage retains the
buyer and submitted hash; after refresh use **Check creation receipt**. A pending
or uncertain submission is never automatically resubmitted. If the browser closes
before the wallet returns its hash, inspect wallet activity manually; this phase
has no automatic transaction discovery. After reconciling an abandoned/rejected
run, use browser developer tools to remove only `pos.phase1.creation.v1` from this
site's Local Storage if you deliberately want to start another job. Clearing that
entry does not cancel any on-chain transaction.

The historical Job #1/#2 cards, registry stats and trust-model section are unchanged.
Their shared-signer description refers to the historical MVP; this new creation
uses the connected user wallet. Phase 1 adds no payment, verifier calls, seller
HTTP execution, validation, or outcome recording. Created jobs remain unpaid and
do not increment paid/success/failure sellerStats.

Offline Phase 1 tests (from repository root, using the existing server TS runner):

```sh
server/node_modules/.bin/tsx --test web/test/wallet.test.ts
```

Tests use synthetic receipts and mock injected providers; they send no transaction.
A real browser wallet approval is a separate manual acceptance test.
