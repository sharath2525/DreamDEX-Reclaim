# SDK & Documentation Feedback Report

**Project:** DreamDEX Reclaim — settlement recovery for Event Contracts
**Submitted to:** Somnia × DreamDEX Event Contracts Hackathon (optional deliverable)
**Author:** solo builder
**Date:** 2026-09-11

Everything below was found by building against the live Shannon testnet on 2026-09-11.
Each finding carries the command or query that reproduces it. Nothing here is inferred
from reading the docs — that is the point of the report.

**Environment**

```
@somnia-chain/markets-sdk  0.30.0   (published 2026-09-10T13:29:35Z)
node                       v20.20.2
indexer                    https://dev.smk.somnia.host/v1/graphql
chain                      somniaShannon (50312)
ws                         wss://api.infra.testnet.somnia.network/ws
```

---

## Summary

The Event Contracts surface is genuinely good. `client.getClaimable()` already solves
the hardest half of a recovery tool and returns rows pre-shaped for `trader.redeemMany()`
— that is a well-designed seam. The `Gotchas` page is the best doc page I have read for
any prediction-market venue, and three of its twelve entries saved me from bugs I would
otherwise have shipped.

Four things cost me real time. Two of them will cost every builder the same time,
because the docs actively point the wrong way.

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High** | The oracle-explorer deep link in the docs does not work. `Market.oracleQuestionId` is not the explorer's question number. |
| 2 | **High** | `client.getClaimable()` is slow and silently incomplete above 200 outcome-balance rows. |
| 3 | Medium | The indexer has no aggregates, and every variable must be explicitly declared *and* correctly typed. |
| 4 | Medium | The official starter template pins `^0.28.1`; the docs require `>= 0.29.0`; latest is `0.30.0`. |
| 5 | Low | Several indexer tables contain duplicate rows and undocumented sentinel values. |

---

## 1. The oracle-explorer deep link in the docs is broken

**Where:** *Market Structure & Lifecycle* → "Auditing a resolution"

The docs say:

> A market row carries an `oracleQuestionId`, and that id is the question's number on the
> oracle explorer, so you can deep-link any market straight to its own resolution:
> `https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph`
> … Worth surfacing in any interface you build on top of event contracts.

That instruction produces a dead link. I followed it exactly and got this:

```
https://prd.oracle.somnia.host/questions/6.96764262294372e+75?view=graph
```

**Why.** `Market.oracleQuestionId` is not one field with one meaning. Testnet runs two
settlement paths and they populate that column differently:

| Market kind | `Market.oracleQuestionId` | `OracleBind` row | Auditable? |
|---|---|---|---|
| Real Event Contract (`"ETH closes at or above its opening price"`) | 5-digit counter, e.g. `"53949"` | present | yes |
| Synthetic pricefeed market (`"Pricefeed test: will BTC/USDC …"`) | 77–78 digit 256-bit `questionKey` | **absent** | no |

Measured across one wallet's 472 settled markets: 97 real Event Contracts (short counter,
all with binds) and 375 synthetic pricefeed markets (256-bit key, none with binds).

Because the indexer's `numeric` type is stringified, a builder who routes this through
`Number()` — the obvious thing to do — silently gets `2.55e+75` and a URL that resolves to
nothing. There is no error. The link just does not work, and it looks like a data problem
rather than a docs problem.

**The join that actually works** is through `OracleBind`:

```
Market.id  ──>  OracleBind.market_id  ──>  OracleBind.oracleQuestionId  ──>  OracleQuestion
                                              (this is the explorer number)
```

Verified on market `0x…019d3b`:

```graphql
{ Market(where: {id: {_eq: "0x…019d3b"}}) { question oracleQuestionId } }
# -> "ETH closes at or above its opening price", oracleQuestionId "53949"  (short here)

{ OracleBind(where: {market_id: {_eq: "0x…019d3b"}}) { id oracleQuestionId resolvedAt } }
# -> { id: "53949_1", oracleQuestionId: "53949", resolvedAt: "1789103101" }

{ OracleAnswer(where: {oracleQuestionId: {_eq: "53949"}}) { numericValue outcomeLabel } }
# -> { numericValue: "245752", outcomeLabel: ">= 0.00" }
```

Explorer confirms reachable: `GET https://prd.oracle.somnia.host/questions/53949?view=graph`
→ `200`, `text/html`, 28,063 bytes.

**Two traps inside the join:**

- `OracleQuestion.questionKey` is an **opaque hash**, not the hex of the question number.
  Question `53949` has key `0x24c03f827a16a5d9828cde4b0c332d967bbdae50cc813b532d1f2bb1bef4d1ff`,
  whereas `0x…d2bd` is what `BigInt("53949").toString(16)` gives. Filtering
  `OracleQuestion` by a derived key returns **zero rows**. Join on `oracleQuestionId`.
- `OracleAnswer.oracleQuestionId` is the `numeric` scalar, `OracleBind.market_id` is
  `String`, and `OracleQuestion.questionKey` is `String` — three different filter types
  for what reads like one identifier.

**Suggested fix.** Two changes, both small:

1. Rename the field in the indexer or in the docs. `Market.oracleQuestionId` holding two
   different things under one name is the root cause. Call the hash
   `oracleQuestionKey` and keep `oracleQuestionId` for the counter only.
2. Until then, replace the docs snippet with the `OracleBind` join above, and state
   plainly that synthetic pricefeed markets have no bind and therefore no explorer link.

The feature the docs recommend is a good one — settlement transparency is the biggest
trust gap in prediction markets, and surfacing it is worth doing. It just needs a join
that works.

---

## 2. `client.getClaimable()` is bounded and can silently omit claims

This is the single most useful method on the Event Contracts surface and the one a
recovery product is built on. Its output shape is excellent, but SDK 0.30.0 builds it
from `BinaryPortfolio.getPortfolio()`, whose GraphQL query hard-codes:

```graphql
OutcomeBalance(
  where: { account: { _eq: $acct }, balance: { _gt: "0" } }
  order_by: { balance: desc }
  limit: 200
)
```

That limit is not exposed in `getClaimable()`, and the result has no truncation flag.
An active wallet can therefore receive a valid-looking but incomplete redemption list.

Measured on the same demo wallet on 2026-09-11:

```
complete OutcomeBalance scan  -> 275 winning rows / 53,443.702 tUSDC
client.getClaimable(...)      -> 108 candidates   / 21,600.000 tUSDC / 81,860 ms
```

The SDK result is not an independent on-chain cross-check: its portfolio leg reads the
same indexer and then fetches fees for winning markets. The per-market work also makes
the call slow; observed latency ranged from roughly 31 to 82 seconds for this wallet.

The complete address-scoped indexer read is much faster:

```
GET /api/address?address=0xfe72…   ->  all non-zero holdings in a few seconds
```

Reclaim now labels `getClaimable()` as a bounded SDK compatibility check. It does not
describe the result as complete or authoritative.

**Suggested fixes, cheapest first:**

1. Remove the hard-coded 200-row cap, or page `OutcomeBalance` internally.
2. Add `{ limit, offset }` or a cursor and return `total` plus `truncated`.
3. Document that the method is indexer-backed; do not imply an on-chain balance sweep.
4. Batch or cache the per-market fee reads to reduce latency.

The output shape is already correct for `redeemMany` — `marketId` / `outcomeIdx` /
`amount` / `estPayout` / `status`. That part needs no change.

---

## 3. Indexer ergonomics

Three things, all fixable in the docs, one in the indexer.

**(a) No aggregates.** `Market_aggregate`, `market_aggregate`, `count` — none exist.
132 query fields, and counting markets means paging the table and counting client-side.
A network-wide "how much is unclaimed" query therefore pulls every row. For a hackathon
project that is fine at 32k rows; for anything with real volume it is not.

```graphql
{ Market_aggregate { aggregate { count } } }
# -> field 'Market_aggregate' not found in type: 'query_root'
```

**(b) Variables must be declared, and typed exactly.** Selection sets passed bare are
rejected with `unbound variable "x"`. Then every type must match:

| Declaration | Result |
|---|---|
| `$limit: String` | `variable 'limit' is declared as 'String', but used where 'Int' is expected` |
| `$qid: String` on `OracleAnswer.oracleQuestionId` | `used where 'numeric' is expected` |
| `$where: String` | `used where 'OutcomeBalance_bool_exp' is expected` |
| `$order: OutcomeBalance_order_by` | `used where '[OutcomeBalance_order_by!]' is expected` |
| `$ids: String` on `_in` | `used where '[String!]' is expected` |

Correct set: `limit`/`offset` are `Int`, `order_by` is a **non-null list** `[Table_order_by!]`,
`_in` takes `[String!]`, question ids take `numeric`, filters take `Table_bool_exp`.
None of this is in the docs, and each failure only names one variable at a time.

**(c) Relations need a selection set even when you want the scalar.** `OracleBind.market`
and `OracleBind.question` are objects; asking for them as scalars returns
`missing selection set for 'Market'`. The scalar foreign key is `market_id`, which is not
obvious from the field list.

A short "reading the indexer directly" page with a working paginated query would remove
all three. The SDK hides this today, which is good — but any analytics or backend work
needs it, and the docs' own advice to "derive the scale from the collateral's `decimals()`"
already implies people will.

---

## 4. Version guidance contradicts the official starter

| Source | Requires |
|---|---|
| Docs, *Event Contracts* → Install | "Use version 0.29.0 or newer" |
| `ec-dreamdex-hackathon-template/typescript/package.json` | `"@somnia-chain/markets-sdk": "^0.28.1"` |
| npm `latest` | `0.30.0`, published 2026-09-10 — **during** the submission window |

`^0.28.1` does not resolve to `0.29.0` or later. A team that forks the official template
and follows the official docs gets a version the docs say is too old, and the docs list
three separate breakages below `0.29.0` including a silent 10,000-market cap.

Also: the docs say "Use version 0.29.0 or newer" and then describe floors for `0.23.0`,
`0.28.0` and `0.29.0`. That reads as though `0.30.0` was not anticipated. Suggest bumping
the template to `^0.30.0` and restating the guidance as a single floor.

---

## 5. Smaller items

- **`MarketVenue` returns duplicate rows** for the same `venueId` (four identical rows for
  `0xcc6988…792f` in one fetch). Dedupe by `venueId` before use. `settlementFeesCollected`
  is `null` on all of them.
- **`OracleAnswer.outcomeIdx = 255` is a sentinel for a voided answer**, with `voidReason = 3`
  and an empty `outcomeLabel`. Not documented anywhere. Anyone charting outcomes will plot
  255 as a real bucket.
- **`OracleBind.resolvedAt`, `cost`, `charged`, `subsidy`, `measuredGas` are all `null`**
  until the question resolves, and populate after. Worth a note — it looks like missing
  data rather than pending state.
- **`OracleCallback`** (`marketsResolved`, `measuredGas`, `overheadGasAttributed`,
  `subsidy`, `totalCharged`) is the gas-accounting view of the whole settlement rail. It is
  in the indexer and in no documentation. Genuinely interesting data.
- **`raw_events`** is exposed on the query root and undocumented.
- **Testnet collateral is tUSDC at 6 decimals; mainnet USDso is 18.** The docs cover this
  well, but the 10^12 factor is worth stating as a headline warning rather than a
  paragraph — it is the kind of thing that misprices an entire app with no error.

---

## What worked well

Worth recording, because the negatives above are easier to fix than the positives are to
build:

- **`Gotchas` #10 is exactly right.** `loadMarkets()` really does hide settled markets. I
  measured 9,974 finalized binary markets on testnet against 26 live — the recovery use
  case is not hypothetical, it is the normal state of the venue.
- **`Gotchas` #11 saved me.** "Redeeming a losing position succeeds and pays 0" and "on a
  voided market, redeem both sides explicitly" are the two facts a naive redeemer gets
  wrong. Mine would have.
- **`Gotchas` #12** (pools are recycled, key by `marketId`) is confirmed by the data —
  `poolAddress` repeats across unrelated markets in the same series.
- **Settlement is as fast as advertised.** Across 9,974 settled markets: p50 = 0s,
  p90 = 1s, p99 = 6s from expiry to resolved. Void rate 0.12% (12 of 9,974). The
  reactivity-driven resolution path is real and it is fast — that is a genuine
  differentiator over keeper-based venues and the docs should lead with the numbers.
- **Zero fees confirmed on-chain.** Every venue reports `makerFeeBps`, `takerFeeBps`,
  `settlementFeeBps`, `routingFeeBps` and `maxBuilderFeeBps` all `0`.
- **`getClaimable` → `redeemMany` is a well-designed pair.** Returning rows already shaped
  as write input is the right call.
- **The SDK ships its sources** (`src/` in the published tarball) with human-readable ABI
  signatures. Reading `src/binary/settlement.ts` answered more questions than the docs did.
  Please keep doing that.

---

## Reproduce

```bash
git clone <this repo> && cd DreamDEX-Reclaim
npm install
npm test          # 16 tests, pure payout/claim classification logic
npm start         # http://localhost:4173

curl -s "localhost:4173/api/address?address=0xfe7250509634abb94b3cdbd72eb122feccac157c"
curl -s "localhost:4173/api/resolution?marketId=0x…019d3b"
curl -s "localhost:4173/api/network"        # full chain scan, ~50s
```

Every number in this report is served by one of those three endpoints.
