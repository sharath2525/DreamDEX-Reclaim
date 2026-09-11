# DreamDEX Reclaim

**Settlement recovery for DreamDEX Event Contracts.** Find every settled market a wallet
never claimed, see exactly how each one resolved, and redeem them all in one transaction.

Built for the **Somnia × DreamDEX Event Contracts Hackathon** on the Somnia Shannon testnet.

---

## The problem

Event Contracts settle on a schedule and then leave the live market list. From the
DreamDEX docs, `Gotchas` #10:

> `loadMarkets()` will not show you a settled market … the registry sweep behind
> `loadMarkets()` skips finalized binaries — so filtering it for inactive rows returns
> nothing and a redeem-by-scan bot reports no winnings while real ones sit unclaimed.

So a winning position stops appearing anywhere. There is no UI surface that shows it, no
notification, and no reminder. The money is there, redeemable, and invisible.

This is not a corner case. Measured on Shannon testnet on 2026-09-11:

| Metric | Value |
|---|---|
| Binary markets on testnet | 10,000+ (26 live, 9,974 finalized in the first page) |
| Non-zero outcome-token holdings | **31,981** across **8,085** addresses |
| Wallets holding unclaimed winnings | **6,895** |
| Total unclaimed | **13,573,162 tUSDC** |
| Median claim | 2,400 tUSDC |
| Settlement latency (expiry → resolved) | p50 **0s**, p90 1s, p99 6s |
| Void rate | 0.12% (12 of 9,974) |

Settlement is instant and reliable. Collection is entirely on the user, and nothing helps
them do it.

Reproduce any row: `curl -s localhost:4173/api/network`.

## What it does

Paste any wallet address. No connection, no signature, nothing to install.

1. **Unclaimed winnings** — every settled market still holding redeemable outcome tokens,
   with the payout vector applied, sorted by value.
2. **Settlement audit** — click any row to trace it: the question, the oracle answer, the
   reactivity callback, the payout vector, the gas charged, and a deep link to the oracle
   explorer showing each price source, its receipt, and the median.
3. **Live exposure** — open positions on markets still trading, with time to close.
4. **Already claimed** — redemption history, so you can see what has been collected.
5. **Network view** — the chain-wide picture: who is owed what, ranked.

Redemption is a single batched `trader.redeemMany({ entries })` call, using exactly the
entries `client.getClaimable()` returns.

## Why it works: two read paths

| Path | What | Speed |
|---|---|---|
| **Indexer** `dev.smk.somnia.host` | `OutcomeBalance ⋈ Market` GraphQL | ~1.5s per wallet |
| **SDK** `client.getClaimable()` | reads the chain directly, authoritative | ~31s for a heavy wallet |

`getClaimable()` is correct but batched per position with no pagination — one wallet, one
call, 31,573 ms. It cannot back a UI. So Reclaim uses the indexer for discovery and the
SDK as the authority consulted immediately before signing. Both numbers are shown, so
they can be cross-checked. Click **Cross-check on-chain** to see the SDK's own answer and
the `redeemMany` payload it produces.

That ~20× gap, and what to do about it, is finding #2 in
[SDK-FEEDBACK.md](./SDK-FEEDBACK.md).

## Settlement transparency

The docs recommend surfacing the oracle explorer and no submitted project does. Following
the docs literally produces a dead link: `Market.oracleQuestionId` is a 77-digit 256-bit
`questionKey` for most testnet markets, and routing it through `Number()` yields
`6.96e+75`. The join that works goes through `OracleBind`:

```
Market.id ──> OracleBind.market_id ──> OracleBind.oracleQuestionId ──> OracleQuestion
```

Verified on market `0x…019d3b`:

```
question        ETH closes at or above its opening price
questionNumber  53949
explorer        https://prd.oracle.somnia.host/questions/53949?view=graph   (200 OK)
oracle answer   numericValue 245752, interval ">= 0.00"
payout          Up 0 · Down 1  →  winning outcome Down
settled in      1s
resolution cost 1,957,530 gas · 0.02105271 SOMI charged
```

Full write-up, including the two traps inside that join: [SDK-FEEDBACK.md](./SDK-FEEDBACK.md) §1.

## Run it

```bash
npm install
npm start            # http://localhost:4173
npm test             # 16 tests over the payout/claim logic
```

No `.env` needed. The indexer is public and every read path is unauthenticated.

### Endpoints

```
GET /api/address?address=0x…      wallet: claimable, live, lost, redemption history
GET /api/resolution?marketId=0x…  full settlement audit trail for one market
GET /api/sdk?address=0x…          authoritative chain read + redeemMany payload (slow, ~30s)
GET /api/network                  full chain scan, ~50s, cached 2 min
GET /api/fees                     per-venue fee schedule
GET /api/health
```

### Executing a redemption

Read-only by default — nothing signs without a key. To execute:

```bash
PRIVATE_KEY=0x… npm start
```

Redemption runs through `trader.redeemMany()`. Every entry `getClaimable()` returns is
passed, including both legs of a voided market, because a void pays 0.5 on each side and
there is no winning outcome to infer.

## Project layout

```
src/indexer.mjs    read-only GraphQL client + pure payout classification
src/sdk.mjs        write path: getClaimable, redeemMany plan, redeem
src/server.mjs     zero-dependency HTTP server and API
public/index.html  the whole UI, no build step
test/payout.test.mjs
```

The payout logic is pure and unit-tested — 16 tests covering the payout vector, the
voided case, the 6-vs-18 decimal trap, and the identifier overflow that breaks oracle
links. Nothing in `test/` re-implements product code; it imports it.

## Design notes

- **No build step.** One HTML file, inline CSS, no framework. Judges should not have to
  run a bundler to see the product.
- **Key state by `marketId`, never by pool address.** Pools are recycled across windows
  (`Gotchas` #12); confirmed in the data.
- **Derive decimals, never hardcode.** Testnet tUSDC is 6 decimals, mainnet USDso is 18 —
  a factor of 10^12 that misprices everything silently.
- **256-bit identifiers stay strings.** `Number()` on a 77-digit questionKey loses every
  digit past the 17th. There is a test for this.
- **Show both read paths.** When two sources can answer, show both and let the user
  check. Trust is the product.

## What is not done

- **No wallet connect.** The demo is address-first by design — it works on any wallet
  including one you do not own, which is what makes it demonstrable. Signing is
  server-side via `PRIVATE_KEY`. A browser-wallet path is the obvious next step.
- **No mainnet.** Addresses are identical across testnet and mainnet (CREATE3), so the
  switch is a config change — but the collateral decimals differ by 10^12 and that has
  not been exercised against mainnet.
- **Synthetic pricefeed markets have no audit link.** 375 of one sample wallet's 472
  settled markets are `"Pricefeed test:"` markets with a 256-bit questionKey and no
  `OracleBind` row. They show no audit link rather than a dead one.

## Links

- [DreamDEX Event Contracts docs](https://docs.dreamdex.io/developers/event-contracts)
- [`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk) 0.30.0
- [DreamDEX Bot Kit](https://github.com/somnia-chain/dreamdex-bot-kit)
- [Oracle explorer](https://prd.oracle.somnia.host/questions/53949?view=graph)
- [Somnia Shannon explorer](https://shannon-explorer.somnia.network/)
- [SDK & documentation feedback report](./SDK-FEEDBACK.md)
