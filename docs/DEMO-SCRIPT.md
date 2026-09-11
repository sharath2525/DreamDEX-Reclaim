# Demo video script — 2:45

Target: 2 minutes 45 seconds. The live field reached 98 submissions. The first 20 seconds decide
whether they keep watching, so the problem is stated with a number before any product
appears.

**Recording checklist before you start**

```bash
cd DreamDEX-Reclaim
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

> In a September eleventh testnet snapshot, more than sixty-nine hundred wallets held
> about thirteen and a half million testnet tUSDC in winning, non-zero outcome balances.
> These are testnet figures, not customer dollars. The point is the size of the recovery
> surface. Median indexed claim: twenty-four hundred tUSDC.

---

## 0:20 – 0:50 · The reveal

**Do:** click the first suggested address chip, or paste
`0xfe7250509634abb94b3cdbd72eb122feccac157c`.

> Reclaim is address-first. No wallet connection, no signature, nothing to install — so
> it works on any wallet, including one you do not own. That is deliberate: it is what
> makes this demonstrable.

**Screen:** results land in about two seconds. Let them sit for a beat.

> This wallet has hundreds of winning rows and no redemption record. The exact total is
> live indexer data, so I will use the number shown on screen rather than a stale script.
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

**Do:** click **Check SDK candidates**. It can take over a minute, so warm this response
before recording or use a lighter wallet.

> The SDK has the right primitive: `client.getClaimable()` returns rows shaped directly
> as `redeemMany()` input. But in version zero point thirty it builds that result from an
> indexer portfolio query capped at two hundred holdings, with no truncation flag.
> Reclaim pages the indexer for discovery and labels this SDK result as bounded.

**Do:** the SDK panel resolves. Point at the two numbers.

> There it is: the candidate subset returned by the official SDK and its `redeemMany`
> payload shape. This is not independent on-chain confirmation, and it may be incomplete
> for an active wallet. Exposing that limitation is one of our high-severity SDK findings.
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
> Most tools in this ecosystem focus on getting into a position. Reclaim focuses on the
> post-settlement recovery and trust layer.
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
- **Say the dated numbers honestly.** More than 6,900 wallets. About 13.5 million testnet
  tUSDC. SDK result capped at 200 holdings.
  Specific figures are what survive a judging discussion.
- **If the SDK cross-check is slow on camera, leave it running.** A spinner you keep
  talking over reads as "this is really hitting the chain." A spinner you cut away from
  reads as broken.
- **One take is fine.** Imperfect audio beats no video. The rubric gives 15% to
  presentation and most submissions will spend zero effort here.
- **Do not claim a live redemption.** The build is read-only by default and the video
  should not imply otherwise. The dry-run payload on screen is the honest and stronger
  shot.
