# DoraHacks submission copy

Paste-ready text for each field of the BUIDL form.

---

## Project name

```
DreamDEX Reclaim
```

## One-line summary

```
Settlement recovery for DreamDEX Event Contracts — find every settled market your wallet
never claimed, see exactly how each one resolved, and redeem them all in one transaction.
```

## Short description (if the form has one)

```
Event Contracts settle on schedule and then leave the live market list, so a winning
position stops appearing anywhere. On Shannon testnet right now 6,892 wallets are holding
13.56M tUSDC they can redeem and have no way to find. Reclaim scans any address's on-chain
outcome balances, shows what is claimable with the payout vector applied, traces each
resolution back through the oracle, and redeems in one batched call.
```

## Detailed description

```markdown
# DreamDEX Reclaim

## The problem

DreamDEX Event Contracts settle on a schedule — and then the settled market leaves the
live list. The docs say it plainly in `Gotchas` #10:

> `loadMarkets()` will not show you a settled market … the registry sweep behind
> `loadMarkets()` skips finalized binaries — so filtering it for inactive rows returns
> nothing and a redeem-by-scan bot reports no winnings while real ones sit unclaimed.

A winning position therefore stops appearing in any UI. No badge, no notification, no
reminder. The collateral is there, redeemable, and invisible.

Settlement itself is not the problem. Measured across 9,974 settled testnet markets:
**p50 = 0 seconds** from expiry to resolved, p90 = 1s, p99 = 6s, void rate 0.12%. The
reactivity-driven resolution path is fast and reliable. **Collection is entirely on the
user, and nothing helps them do it.**

The scale on Shannon testnet, measured 2026-09-11:

| Metric | Value |
|---|---|
| Non-zero outcome-token holdings | 31,906 across 8,085 addresses |
| Wallets holding unclaimed winnings | **6,892** |
| Total unclaimed | **13,564,410 tUSDC** |
| Median claim | 2,400 tUSDC |

Every number is served live by `GET /api/network` and reproduced from the public indexer.

## The product

Paste a wallet address. No wallet connection, no signature, nothing to install — which
also means it works on an address you do not own, and that is what makes it demonstrable.

1. **Unclaimed winnings** — every settled market still holding redeemable outcome tokens,
   payout vector applied, sorted by value, with contracts and per-contract payout shown.
2. **Settlement audit** — click any row to trace the resolution: the question, the oracle
   answer and the interval it chose, the reactivity callback, the payout vector, the gas
   charged, and a deep link to the oracle explorer showing every price source and its
   receipt.
3. **Live exposure** — open positions on markets still trading, with time to close.
4. **Already claimed** — redemption history from `RedemptionRecord`.
5. **Network view** — the chain-wide picture, ranked by what each wallet is owed.

Redemption is one batched `trader.redeemMany({ entries })` call using exactly the entries
`client.getClaimable()` returns. Read-only by default; nothing signs without a key.

## How it uses Event Contracts

The SDK's `client.getClaimable()` is the best-designed seam on the Event Contracts surface
— it returns rows already shaped as `redeemMany()` input. It is also unusable as a read
path: **one wallet, one call, 31,573 ms**, batched per position with no pagination.

So Reclaim runs two read paths and shows both:

| Path | What it reads | Speed |
|---|---|---|
| Indexer GraphQL | `OutcomeBalance ⋈ Market` | ~1.5s per wallet |
| `client.getClaimable()` | the chain, authoritative | ~31s for a heavy wallet |

~20× on the same question. Indexer for discovery, SDK as the authority consulted
immediately before signing. The **Cross-check on-chain** button runs the SDK live and
displays its own answer next to the indexer's, plus the `redeemMany` payload it produced.

Indexer tables used: `OutcomeBalance`, `Market`, `RedemptionRecord`, `OracleBind`,
`OracleQuestion`, `OracleAnswer`, `MarketResolutionEvent`, `MarketVenue`. SDK surface
used: `client.getClaimable`, `trader.redeemMany`, `SomniaMarkets`, `somniaShannon`,
`SOMNIA_TESTNET_ADDRESSES`.

## Settlement transparency

The docs recommend surfacing the oracle explorer; no other submission does. Following the
docs literally produces a dead link — `Market.oracleQuestionId` is a 77-digit 256-bit
`questionKey` on most testnet markets, and `Number()` turns it into `6.96e+75`. The join
that works goes through `OracleBind`. Verified on market `0x…019d3b`:

```
question         ETH closes at or above its opening price
question number  53949
explorer         https://prd.oracle.somnia.host/questions/53949?view=graph   (200 OK)
oracle answer    numericValue 245752, interval ">= 0.00"
payout           Up 0 · Down 1  →  winning outcome Down
settled in       1s
resolution cost  1,957,530 gas · 0.02105271 SOMI charged
```

Settlement transparency is the largest trust gap in prediction markets. Showing a trader
*why* they won or lost, source by source, is what makes them willing to put size in.

## Engineering

- **16 unit tests** over the pure payout logic: the payout vector, the voided case
  (0.5 per side, both legs must be redeemed), the 6-vs-18 decimal trap, and the
  identifier overflow that silently breaks oracle links. Tests import product code; they
  do not re-implement it. `npm test`.
- **No build step.** One HTML file, inline CSS, no framework. Judges do not run a bundler.
- **Zero dependencies at runtime** beyond the SDK. No database, no backend infra.
- Keyed by `marketId`, never pool address (pools are recycled — `Gotchas` #12).
- Decimals derived, never hardcoded (testnet tUSDC 6, mainnet USDso 18 — a 10^12 factor
  that misprices silently).
- 256-bit identifiers carried as strings; `Number()` loses every digit past the 17th.

## Ecosystem impact

This is the retention layer, not another trading terminal. Every other tool in this
ecosystem helps you get *into* a position; nothing helps you get your money *out*.

- **Direct:** recovers capital that is currently stranded, for any wallet.
- **Trust:** settlement transparency converts "I think I won" into a verifiable audit
  trail — the precondition for larger positions.
- **Adoption:** an address-first tool with no wallet connection is the lowest-friction
  on-ramp available. It works on an address a new user was merely given.
- **Sustainable:** the same core — outcome balances ⋈ settled markets — powers wallet
  notifications, a Telegram claim bot, treasury reconciliation, and market-health
  monitoring. One read path, several products.
- **Feedback loop:** shipped with a documentation feedback report containing two
  high-severity, reproducible findings that affect every builder on this SDK.

## Roadmap

1. Browser wallet connect (EIP-6963) so users sign client-side.
2. Telegram/Discord claim bot — "you have 2,400 tUSDC unclaimed" pushed, not pulled.
3. Mainnet. Addresses are identical (CREATE3); the decimals difference is handled but not
   yet exercised.
4. Market-health monitor for the DreamDEX team: void rate, settlement latency, resolution
   gas cost, unclaimed backlog.

## Feedback report

Submitted as `SDK-FEEDBACK.md`. Five findings, each with the query that reproduces it:
the broken oracle-explorer join, `getClaimable` latency, indexer ergonomics, a version
pin conflict between the docs and the official starter template, and several
undocumented sentinel values. Also records what worked well, because `Gotchas` #10, #11
and #12 each saved real bugs.
```

## Links

```
GitHub:   <your repo URL>
Live:     <your deployed URL>
Video:    <your demo video URL>
```

## Tags

```
DeFi · Prediction Markets · Event Contracts · dreamDEX · Somnia
```

---

## Repo description (GitHub)

```
Settlement recovery for DreamDEX Event Contracts on Somnia — find and redeem unclaimed
winnings, and audit how every market resolved.
```

## Topics

```
somnia dreamdex event-contracts prediction-market onchain defi settlement typescript hackathon
```
