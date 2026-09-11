# Demo video script — 2:45

Target: 2 minutes 45 seconds. Judges are watching 93 of these. The first 20 seconds decide
whether they keep watching, so the problem is stated with a number before any product
appears.

**Recording checklist before you start**

```bash
cd dreamdex-reclaim
npm start                                  # http://localhost:4173
curl -s localhost:4173/api/network > /dev/null   # warm the cache — the scan takes ~50s
```

Warm the cache first or the network panel will spin on camera. Zoom the browser to 110%.
Record at 1080p. Hide bookmarks bar. Use a clean profile so no extensions bleed in.

---

## 0:00 – 0:20 · The problem (no product on screen)

**Screen:** the app's hero, nothing clicked yet.

> DreamDEX Event Contracts settle on a schedule — and then the settled market disappears
> from the live list. The docs are explicit about it: `loadMarkets()` skips finalized
> binaries, so a redeem-by-scan finds nothing while real winnings sit unclaimed.
>
> Here is what that looks like on Shannon testnet right now.

**Do:** the hero stats are already loaded. Point at them.

> Six thousand eight hundred and ninety-two wallets are holding thirteen and a half
> million tUSDC they can redeem today — and there is no screen in the product that shows
> it to them. Median claim: twenty-four hundred.

---

## 0:20 – 0:50 · The reveal

**Do:** click the first suggested address chip, or paste
`0xfe7250509634abb94b3cdbd72eb122feccac157c`.

> Reclaim is address-first. No wallet connection, no signature, nothing to install — so
> it works on any wallet, including one you do not own. That is deliberate: it is what
> makes this demonstrable.

**Screen:** results land in about two seconds. Let them sit for a beat.

> This wallet has won two hundred and twenty-nine markets. It has never redeemed a single
> one — zero redemptions on record. Forty-six thousand tUSDC is sitting there.
>
> And notice it is still trading: seven live markets, fourteen hundred contracts open.
> This is an active trader, not an abandoned account.

**Do:** scroll the claimable table slowly. Two or three seconds is enough.

> Each row is a settled market still holding redeemable tokens, with the payout vector
> already applied.

---

## 0:50 – 1:30 · The audit (this is the differentiator — do not rush it)

**Do:** click one row that says **ETH closes at or above its opening price**. The audit
panel opens below.

> Click any row and it traces the resolution.

**Do:** walk down the panel as it renders.

> The question. The oracle's answer — value two-four-five-seven-five-two, and the
> interval it selected. The reactivity callback that delivered it to the OracleHub, with
> the gas it cost: about two million, two hundredths of a SOMI. The payout vector it
> wrote — Down wins. And it settled in one second.

**Do:** click the **oracle explorer ↗** link. Let the explorer page load.

> And here is the part the docs recommend and nobody else has built: every market's
> settlement question is public. This is the oracle explorer for question fifty-three
> nine hundred and forty-nine — each price source, the value it returned, its receipt,
> the median, and the interval chosen.
>
> Settlement transparency is the biggest trust gap in prediction markets. A trader who
> can verify *why* they lost is a trader who will put size in next time.

**Do:** back to the app.

> Worth saying: the docs tell you to deep-link this, and following them literally gives
> you a dead link. The market row's question id is a seventy-seven-digit hash, not the
> explorer's number. The join that works goes through a different table. That is in the
> feedback report.

---

## 1:30 – 2:05 · The engineering (Technical Implementation is 25% — spend the time)

**Do:** click **Cross-check on-chain**. It takes ~30 seconds, so keep talking over it.

> The SDK already has the right primitive: `client.getClaimable()` returns rows shaped
> directly as `redeemMany()` input. Good design.
>
> It is also unusable as a read path. One wallet, one call — thirty-one seconds, batched
> per position, no pagination. So Reclaim runs two paths: the indexer for discovery at
> about a second and a half, the SDK as the authority consulted right before signing.

**Do:** the SDK panel resolves. Point at the two numbers.

> There it is — one hundred and two positions confirmed on-chain, and the exact
> `redeemMany` payload it produced. One transaction redeems all of them, including both
> legs of any voided market, because a void pays a half on each side and there is no
> winning outcome to infer.
>
> Sixteen unit tests cover the payout logic: the payout vector, the void case, the
> six-versus-eighteen decimal trap between testnet and mainnet, and the identifier
> overflow that silently breaks those oracle links.

---

## 2:05 – 2:30 · Impact and vision

**Do:** scroll to the network panel.

> This is the whole chain: thirty-one thousand holdings, eight thousand addresses,
> thirteen and a half million tUSDC unclaimed.
>
> Every other tool in this ecosystem helps you get *into* a position. Nothing helps you
> get your money *out*. This is the retention layer.
>
> Same core, four products: a Telegram claim bot that pushes instead of pulls, browser
> wallet connect, mainnet — the addresses are identical, so it is a config change — and a
> market-health monitor for the DreamDEX team tracking void rate, settlement latency and
> the unclaimed backlog.

---

## 2:30 – 2:45 · Close

> DreamDEX Reclaim. Settlement is instant and it is reliable — p50 zero seconds. The
> missing piece was never resolution. It was collection.
>
> Repo, live demo, and a documentation feedback report with two high-severity findings
> are in the submission. Thanks.

---

## Notes

- **Do not narrate the code.** Show one table and one audit panel. Judges reward the
  product working, not the file tree.
- **Say the numbers out loud.** 6,892 wallets. 13.56 million. 31 seconds versus 1.5.
  Specific figures are what survive a judging discussion.
- **If the SDK cross-check is slow on camera, leave it running.** A spinner you keep
  talking over reads as "this is really hitting the chain." A spinner you cut away from
  reads as broken.
- **One take is fine.** Imperfect audio beats no video. The rubric gives 15% to
  presentation and most submissions will spend zero effort here.
- **Do not claim a live redemption.** The build is read-only by default and the video
  should not imply otherwise. The dry-run payload on screen is the honest and stronger
  shot.
