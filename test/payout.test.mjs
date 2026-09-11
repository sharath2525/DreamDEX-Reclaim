import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBalance, payoutPerContract, summarise, isSettled, oracleExplorerUrl, num, rawStr,
  questionNumberFromRow,
} from "../src/indexer.mjs";

/** 200 contracts (6-decimal tUSDC) held on one leg. */
const row = (outcomeIndex, market) => ({
  account: "0xabc",
  balance: String(200 * 10 ** 6),
  outcomeIndex,
  tokenId: "1",
  market_id: "0xmarket",
  market,
});

test("payoutPerContract reads the payout vector, not winningOutcome", () => {
  const m = { payoutNumerators: ["0", "1"], payoutDenominator: "1", winningOutcome: 1, clobStatus: "Finalized" };
  assert.equal(payoutPerContract(m, 0), 0);
  assert.equal(payoutPerContract(m, 1), 1);
});

test("payoutPerContract falls back to 0.5 per side when voided with no vector", () => {
  const m = { payoutNumerators: null, payoutDenominator: null, voided: true };
  assert.equal(payoutPerContract(m, 0), 0.5);
  assert.equal(payoutPerContract(m, 1), 0.5);
});

test("payoutPerContract honours a non-unit denominator", () => {
  const m = { payoutNumerators: ["3", "1"], payoutDenominator: "4" };
  assert.equal(payoutPerContract(m, 0), 0.75);
  assert.equal(payoutPerContract(m, 1), 0.25);
});

test("a winning leg on a finalized market is claimable at 1 collateral per contract", () => {
  const c = classifyBalance(row(1, {
    clobStatus: "Finalized", finalized: true, quoteDecimals: 6,
    payoutNumerators: ["0", "1"], payoutDenominator: "1", question: "ETH up?", expiry: 1789119480,
  }));
  assert.equal(c.kind, "claimable");
  assert.equal(c.contracts, 200);
  assert.equal(c.value, 200);
  assert.equal(c.outcome, "Down");
});

test("a losing leg is 'lost' with zero value, not claimable", () => {
  const c = classifyBalance(row(0, {
    clobStatus: "Finalized", finalized: true, quoteDecimals: 6,
    payoutNumerators: ["0", "1"], payoutDenominator: "1",
  }));
  assert.equal(c.kind, "lost");
  assert.equal(c.value, 0);
});

test("a position on a Trading market is live, never claimable", () => {
  const c = classifyBalance(row(0, { clobStatus: "Trading", quoteDecimals: 6, expiry: 1789119480 }));
  assert.equal(c.kind, "live");
  assert.equal(c.value, 0);
});

test("a voided market pays 0.5 on BOTH legs — the case that strands money", () => {
  const m = { clobStatus: "Voided", voided: true, quoteDecimals: 6, payoutNumerators: ["1", "1"], payoutDenominator: "2" };
  const up = classifyBalance(row(0, m));
  const down = classifyBalance(row(1, m));
  assert.equal(up.kind, "claimable");
  assert.equal(down.kind, "claimable");
  assert.equal(up.value, 100);
  assert.equal(down.value, 100);
});

test("18-decimal collateral (mainnet USDso) is not mispriced as 6-decimal", () => {
  const c = classifyBalance({
    account: "0xabc", balance: String(2n * 10n ** 18n), outcomeIndex: 0,
    market_id: "0xm",
    market: { clobStatus: "Finalized", finalized: true, quoteDecimals: 18, payoutNumerators: ["1", "0"], payoutDenominator: "1" },
  });
  assert.equal(c.contracts, 2);
  assert.equal(c.value, 2);
});

test("isSettled treats finalized, voided and terminal statuses alike", () => {
  assert.equal(isSettled({ finalized: true }), true);
  assert.equal(isSettled({ voided: true }), true);
  assert.equal(isSettled({ clobStatus: "Finalized" }), true);
  assert.equal(isSettled({ clobStatus: "Trading" }), false);
  assert.equal(isSettled({ clobStatus: "Locked" }), false);
  assert.equal(isSettled(null), false);
});

test("summarise buckets an address and computes a leg win rate", () => {
  const s = summarise([
    row(1, { clobStatus: "Finalized", finalized: true, quoteDecimals: 6, payoutNumerators: ["0", "1"], payoutDenominator: "1" }),
    row(0, { clobStatus: "Finalized", finalized: true, quoteDecimals: 6, payoutNumerators: ["0", "1"], payoutDenominator: "1" }),
    row(0, { clobStatus: "Trading", quoteDecimals: 6, expiry: 1789119480 }),
  ]);
  assert.equal(s.claimable.length, 1);
  assert.equal(s.lost.length, 1);
  assert.equal(s.live.length, 1);
  assert.equal(s.totals.claimableUsd, 200);
  assert.equal(s.totals.winRate, 0.5);
  assert.equal(s.totals.liveContracts, 200);
  assert.equal(s.totals.settledMarkets, 1);
});

test("summarise sorts claimable rows by value, biggest first", () => {
  const big = { ...row(0, { clobStatus: "Finalized", finalized: true, quoteDecimals: 6, payoutNumerators: ["1", "0"], payoutDenominator: "1" }) };
  big.balance = String(900 * 10 ** 6);
  const small = row(0, { clobStatus: "Finalized", finalized: true, quoteDecimals: 6, payoutNumerators: ["1", "0"], payoutDenominator: "1" });
  const s = summarise([small, big]);
  assert.equal(s.claimable[0].contracts, 900);
  assert.equal(s.totals.claimableUsd, 1100);
});

test("num coerces indexer numeric strings and tolerates junk", () => {
  assert.equal(num("123"), 123);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num("not-a-number"), 0);
});

test("oracle explorer deep-link uses the question NUMBER, and refuses the 256-bit questionKey", () => {
  assert.equal(oracleExplorerUrl("4242"), "https://prd.oracle.somnia.host/questions/4242?view=graph");
  assert.equal(oracleExplorerUrl(4242), "https://prd.oracle.somnia.host/questions/4242?view=graph");
  assert.equal(oracleExplorerUrl(null), null);
  assert.equal(oracleExplorerUrl(0), null);
  // Market.oracleQuestionId is a 77-digit hash. Coerced through Number() it becomes
  // 6.96e+75 and the link silently dies — this must return null, never a URL.
  const questionKey = "25506309508645436187755371344209652913996984220476090178008759624263709563421";
  assert.equal(oracleExplorerUrl(questionKey), null);
  assert.equal(oracleExplorerUrl("not-a-number"), null);
});

test("rawStr keeps a 256-bit identifier intact where Number() would mangle it", () => {
  const questionKey = "25506309508645436187755371344209652913996984220476090178008759624263709563421";
  assert.equal(rawStr(questionKey), questionKey);
  assert.equal(rawStr(54113), "54113");
  assert.equal(rawStr(null), null);
  // the bug this guards against:
  assert.notEqual(String(Number(questionKey)), questionKey);
});

test("classifyBalance exposes the questionKey as a string, not a float", () => {
  const key = "25506309508645436187755371344209652913996984220476090178008759624263709563421";
  const c = classifyBalance(row(0, {
    clobStatus: "Finalized", finalized: true, quoteDecimals: 6,
    payoutNumerators: ["1", "0"], payoutDenominator: "1", oracleQuestionId: key,
  }));
  assert.equal(c.oracleQuestionKey, key);
  assert.equal(c.oracleQuestionId, undefined);
});

test("questionNumberFromRow accepts the short counter and rejects the 256-bit questionKey", () => {
  assert.equal(questionNumberFromRow({ oracleQuestionId: "53949" }), "53949");
  assert.equal(questionNumberFromRow({ oracleQuestionId: 53949 }), "53949");
  // 77-digit questionKey from the synthetic pricefeed markets — not an explorer id
  const key = "36455823406084575052488780284643230379752962277400608738598326668603274836042";
  assert.equal(questionNumberFromRow({ oracleQuestionId: key }), null);
  assert.equal(questionNumberFromRow({}), null);
  assert.equal(questionNumberFromRow(null), null);
  assert.equal(questionNumberFromRow({ oracleQuestionId: "0" }), "0"); // rejected later by the URL builder
});
