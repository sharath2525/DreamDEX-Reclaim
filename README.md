<p align="center">
  <img src="./public/logo.svg" alt="DreamDEX Reclaim logo" width="92" />
</p>

<h1 align="center">DreamDEX Reclaim</h1>

<p align="center">
  <strong>Settlement recovery and oracle auditing for DreamDEX Event Contracts.</strong><br />
  Find winnings a wallet has not collected, verify how each market resolved, and prepare SDK-compatible batch-redemption candidates.
</p>

Built for the **Somnia × DreamDEX Event Contracts Hackathon** on Somnia Shannon testnet.

> DreamDEX Reclaim is an independent hackathon project. The public demo is read-only,
> testnet tUSDC has no customer-dollar value, and no private key is required to explore a wallet.

## The problem it solves

Prediction-market discovery and settlement recovery are different jobs.
DreamDEX's normal live-market flow is designed for markets that users can still trade. Once
a binary Event Contract is finalized, it can disappear from that live list even when an
address still holds winning outcome tokens. A product that only scans currently listed
markets can therefore report nothing while a valid redemption remains uncollected.

This creates three concrete user problems:

1. **Discovery:** a holder may not know which finalized markets still contain value.
2. **Trust:** seeing a payout is not enough; the holder needs to understand the oracle
   answer, payout vector, timing, and resolution transaction.
3. **Collection:** claimable positions must be transformed into correctly shaped
   `redeemMany` entries without losing voided-market legs or mixing market identifiers.

DreamDEX Reclaim gives those post-settlement tasks a dedicated interface.

## What the project does

Paste any Somnia address to get a settlement-recovery workspace:

- **Unclaimed winnings** — finalized positions whose outcome balance still maps to a
  non-zero payout, sorted by estimated tUSDC value.
- **Settlement audit** — the question, winning outcome, payout vector, resolution timing,
  oracle answer, gas charged, transaction, and a valid oracle-explorer link when available.
- **Live exposure** — outcome-token positions on markets that have not finalized yet.
- **Redemption history** — positions already collected, separated from balances that may
  still need action.
- **Network view** — an aggregate testnet snapshot showing the scale and distribution of
  indexed unclaimed balances.
- **SDK compatibility check** — `client.getClaimable(address)` output converted to a
  `trader.redeemMany({ entries })`-shaped plan, with the SDK's current completeness limit
  shown explicitly.
- **Share and export** — every successful wallet scan gets a reusable `?address=` URL and
  a one-click JSON recovery report for evidence, debugging, or handoff.

The public interface never asks for a wallet connection and never signs a transaction.
The server-side module supports redemption only when an operator deliberately configures
a matching private key.

## User flow

```text
Paste wallet address
        │
        ├── discover indexed outcome balances
        │      ├── finalized + winning payout → Unclaimed
        │      ├── active market             → Live exposure
        │      └── redemption event          → Already claimed
        │
        ├── select a finalized market
        │      └── join Market → OracleBind → OracleQuestion/Answer
        │          → explain settlement and link to the oracle explorer
        │
        └── run optional SDK compatibility check
               └── preview redeemMany-shaped candidates; sign only if configured
```

## Why it matters to DreamDEX

Reclaim turns the end of the Event Contract lifecycle into a user-facing product surface.
That can improve the ecosystem in four ways:

- recover value that would otherwise remain unnoticed;
- bring users back after settlement and create repeat engagement;
- make oracle-driven outcomes easier to verify rather than asking users to trust a label;
- reveal SDK and documentation edge cases with reproducible evidence that can improve the
  integration experience for every builder.

## Measured testnet evidence

The UI includes this dated submission snapshot so the story appears immediately while a
live network refresh runs independently.

| Shannon testnet metric | Snapshot on 2026-09-11 |
|---|---:|
| Binary markets inspected | 10,000+ |
| Non-zero outcome-balance rows | 31,981 |
| Addresses represented | 8,081 |
| Addresses with an indexed claim | 6,912 |
| Estimated unclaimed testnet value | 13,588,395 tUSDC |
| Median estimated claim | 2,400 tUSDC |
| Resolution latency | p50 0s · p90 1s · p99 6s |
| Voided finalized markets | 12 of 9,974 (0.12%) |

These are **testnet observations, not financial claims**. The state changes over time and
the numbers should be refreshed through `GET /api/network` before being quoted elsewhere.
The measurements suggest that settlement itself is fast; the remaining gap is discovery,
explanation, and collection.

## DreamDEX and Somnia integration

### Read path

The fast wallet view queries the DreamDEX indexer and joins `OutcomeBalance` records to
their `Market` records. Pure payout-classification code then determines whether each
position is active, losing, voided, already redeemed, or still redeemable.

### Settlement-audit path

The market's `oracleQuestionId` is a 256-bit question key, not the small numeric question
number accepted by the oracle-explorer route. The verified join is:

```text
Market.id → OracleBind.market_id → OracleBind.oracleQuestionId → OracleQuestion
```

Keeping that identifier as a string prevents JavaScript precision loss. The resulting
audit view combines the oracle record, resolution event, payout vector, and cost data.
For synthetic pricefeed markets without an `OracleBind` row, the UI omits the explorer
link instead of producing a broken one.

### SDK and redemption path

`@somnia-chain/markets-sdk` v0.30.0 provides:

- `client.getClaimable(address)` for candidate discovery;
- `trader.redeemMany({ entries })` for batched redemption.

In this SDK version, `getClaimable()` is itself indexer-backed and its portfolio query is
limited to 200 outcome-balance rows. It is therefore presented as a **bounded compatibility
check**, not an independent on-chain source or proof of completeness. For an active wallet,
the complete paginated indexer scan can materially exceed the SDK result.

Before executing a production redemption flow, page the full balance set, confirm every
candidate against current contract state, and then submit. The implementation preserves
both legs of a voided market and refuses to sign when the requested address does not match
the configured private key.

See [SDK and documentation feedback](./docs/SDK-FEEDBACK.md) for the queries, examples,
and proposed fixes behind these findings.

## Correctness decisions

- **Key all UI state by `marketId`.** Binary pools can be recycled across market windows;
  a pool address is not a durable market identifier.
- **Derive collateral decimals.** Shannon tUSDC uses 6 decimals while mainnet USDso uses
  18. Hardcoding one side silently creates a factor-of-10¹² error.
- **Keep 256-bit identifiers as strings.** JavaScript `Number` cannot preserve a 77-digit
  oracle question key.
- **Apply the payout vector.** A non-zero outcome-token balance is not automatically a
  winning balance; the finalized payout vector determines value.
- **Preserve both voided legs.** A void can pay both outcomes, so collapsing to one side
  loses redeemable value.
- **Expose source limitations.** The indexer and SDK panels describe what they prove and
  what they do not prove.

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| Interface | `public/index.html` | Address-first dashboard, audit view, SDK comparison, dated network snapshot |
| Branding | `public/logo.svg` | Reusable project logo and browser icon |
| HTTP/API | `src/server.mjs` | Static server, validation, routes, caching, concurrent-request deduplication |
| Indexer | `src/indexer.mjs` | GraphQL queries, pagination, joins, normalization, pure payout classification |
| SDK/write path | `src/sdk.mjs` | Claimable-candidate lookup, payload construction, signer/account safeguards |
| Vercel adapter | `api/*.js` | Native serverless GET routes that reuse the shared API logic |
| Tests | `test/payout.test.mjs` | Payout, decimal, void, identifier, and classification edge cases |

The browser has no build step and the API server uses Node's built-in HTTP module. The
DreamDEX SDK and `viem` are the only runtime dependencies.

## Run locally

Requirements: Node.js 20 or newer and network access to the Somnia/DreamDEX testnet
services.

```bash
git clone <repository-url>
cd DreamDEX-Reclaim
npm install
npm start
```

Open [http://localhost:4173](http://localhost:4173).

To open a wallet directly, append its address:

```text
http://localhost:4173/?address=0xfe7250509634abb94b3cdbd72eb122feccac157c
```

No `.env` file is needed for the read-only application. Useful commands:

```bash
npm start          # start the UI and API on port 4173
npm test           # run the 16 payout and classification tests
```

## Configuration and signing safety

Copy `.env.example` only if you intentionally need server-side signing.

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP port; defaults to `4173` |
| `PRIVATE_KEY` | No | Enables server-side redemption for the matching account |

Never commit a private key. When `PRIVATE_KEY` is absent, the SDK path returns a plan only.
When present, the signer address must equal the address passed into the redemption call or
the module throws `ACCOUNT_MISMATCH`.

## API reference

| Method and path | Returns |
|---|---|
| `GET /api/address?address=0x…` | Claimable positions, live exposure, losing/finalized positions, and redemption history for one wallet |
| `GET /api/resolution?marketId=0x…` | Settlement and oracle audit data for one market |
| `GET /api/sdk?address=0x…` | Bounded SDK candidates and a `redeemMany`-shaped preview |
| `GET /api/network` | Full indexed network scan; cached for two minutes |
| `GET /api/fees` | Per-venue fee schedule; cached for five minutes |
| `GET /api/health` | Service health and timestamp |

Example:

```bash
curl "http://localhost:4173/api/address?address=0xfe7250509634abb94b3cdbd72eb122feccac157c"
```

The network scan is deliberately separate from wallet lookup because it is much heavier.
Concurrent requests for the same expensive route share one in-flight operation instead of
launching duplicate scans.

## Optional redemption module

The included write-path code is not exposed as a public HTTP mutation. That is deliberate:
a public demo should not accept secret keys or create transactions on behalf of visitors.
An operator who configures `PRIVATE_KEY` can invoke the server-side library's redemption
function, which validates the account and calls `trader.redeemMany({ entries })`.

This is a reference integration, not a custody design. A production consumer application
should add browser-wallet signing, transaction simulation, a final confirmation screen,
and post-transaction receipt tracking.

## Tests

```bash
npm test
```

The 16 tests import the real payout/classification functions and cover:

- Up and Down winners;
- losing and zero balances;
- voided markets and two-leg redemption;
- 6-decimal versus 18-decimal collateral;
- finalized/live classification;
- very large oracle identifiers and precision safety.

## Deployment

### Docker

```bash
docker build -t dreamdex-reclaim .
docker run --rm -p 4173:4173 dreamdex-reclaim
```

### Vercel

`vercel.json` routes API requests to the exported Node handler and includes the public
assets. The dated snapshot makes the first screen useful even if the full network scan
exceeds a serverless execution window; per-wallet lookup and resolution audit remain
separate operations.

## Project structure

```text
DreamDEX-Reclaim/
├── api/                           # Vercel-native serverless route adapters
├── public/
│   ├── index.html                # complete browser interface
│   └── logo.svg                  # project logo and favicon
├── src/
│   ├── indexer.mjs               # read and classification path
│   ├── sdk.mjs                   # SDK plan and optional redemption path
│   └── server.mjs                # HTTP server and API routes
├── test/
│   └── payout.test.mjs           # 16 unit tests
├── docs/
│   ├── HACKATHON-SUBMISSION.md   # DoraHacks submission copy
│   ├── DEMO-SCRIPT.md            # 2–3 minute demo plan
│   └── SDK-FEEDBACK.md           # reproducible SDK/docs findings
├── .env.example
├── Dockerfile
├── package.json
└── vercel.json
```

Generated dependencies such as `node_modules/` are ignored by Git and are not part of the
project source.

## Hackathon judging fit

| Criterion | How DreamDEX Reclaim addresses it |
|---|---|
| Innovation and originality | Treats post-settlement recovery and oracle audit as a product, rather than building another market list or trading bot |
| Technical implementation | Uses Event Contract balances, market payouts, resolution/oracle joins, the official SDK candidate flow, and batched-redemption payloads |
| User experience and design | Requires only an address, separates claims/live/history, and explains every resolution before action |
| Business and ecosystem impact | Can recover dormant engagement, increase successful redemptions, and improve trust in Event Contract outcomes |
| Presentation and demo | Provides dated evidence, ready-to-scan test wallets, a visible audit trail, and an honest SDK comparison |

In a review of 98 listed hackathon entries, no other submission title or public summary was
centered on both post-settlement recovery and oracle-level audit. That is a positioning
observation, not a guarantee of judging outcome.

## Current limitations

- Shannon testnet only; mainnet collateral and configuration have not been exercised.
- Public UI is read-only; browser-wallet signing is not implemented.
- The SDK v0.30.0 compatibility result can be incomplete for wallets with more than 200
  outcome-balance rows.
- Network-wide scanning is slower than a wallet lookup and may not fit every serverless
  timeout.
- Synthetic pricefeed markets without an `OracleBind` record cannot link to the oracle
  explorer; the app reports that limitation rather than inventing a URL.

## Roadmap

1. Add non-custodial browser-wallet redemption with simulation and receipt tracking.
2. Replace the bounded SDK discovery path when a paginated or contract-authoritative API
   becomes available.
3. Add notifications for newly settled claimable positions.
4. Add mainnet configuration with explicit collateral-decimal validation.
5. Persist historical network snapshots to measure recovered value and repeat usage.

## Project documents

- [Hackathon submission copy](./docs/HACKATHON-SUBMISSION.md)
- [2–3 minute demo script](./docs/DEMO-SCRIPT.md)
- [SDK and documentation feedback](./docs/SDK-FEEDBACK.md)

## External resources

- [DreamDEX Event Contracts documentation](https://docs.dreamdex.io/developers/event-contracts)
- [DreamDEX Bot Kit](https://github.com/somnia-chain/dreamdex-bot-kit)
- [`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk)
- [Somnia Shannon explorer](https://shannon-explorer.somnia.network/)
- [DreamDEX oracle explorer example](https://prd.oracle.somnia.host/questions/53949?view=graph)
