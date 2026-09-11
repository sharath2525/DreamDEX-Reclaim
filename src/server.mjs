/**
 * server.mjs — zero-dependency HTTP server for DreamDEX Reclaim.
 *
 * Two data paths, deliberately:
 *   /api/address  -> indexer GraphQL (fast, ~1-2s) for discovery and display
 *   /api/sdk      -> markets-sdk client.getClaimable compatibility check
 * SDK 0.30.0 builds that result from an indexer-backed portfolio query capped at 200
 * outcome-balance rows, so it is deliberately labelled as bounded rather than authoritative.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Indexer, summarise, num, oracleExplorerUrl, questionNumberFromRow, TESTNET_INDEXER,
} from "./indexer.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUB = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const indexer = new Indexer(TESTNET_INDEXER);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const cache = new Map(); // key -> { at, ttl, value }
const inflight = new Map(); // key -> Promise; avoid multiplying an expensive full scan
function memo(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const pending = Promise.resolve()
    .then(fn)
    .then((value) => {
      cache.set(key, { at: Date.now(), ttl: ttlMs, value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

const isAddress = (s) => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

/* --------------------------- network-wide scan --------------------------- */

const HARDHAT_TEST_ACCOUNTS = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
]);

async function scanNetwork() {
  const perAddress = new Map();
  let rows = 0;
  for await (const row of indexer.outcomeBalances()) {
    rows++;
    const s = summarise([row]);
    const key = row.account.toLowerCase();
    const e = perAddress.get(key) ?? {
      account: key, claimableUsd: 0, claimableMarkets: new Set(), liveContracts: 0, liveMarkets: new Set(), legs: 0,
    };
    for (const c of s.claimable) {
      e.claimableUsd += c.value;
      e.claimableMarkets.add(c.marketId);
      e.legs++;
    }
    for (const c of s.live) {
      e.liveContracts += c.contracts;
      e.liveMarkets.add(c.marketId);
    }
    perAddress.set(key, e);
  }
  const list = [...perAddress.values()].map((e) => ({
    account: e.account,
    claimableUsd: e.claimableUsd,
    claimableMarkets: e.claimableMarkets.size,
    liveContracts: e.liveContracts,
    liveMarkets: e.liveMarkets.size,
    legs: e.legs,
    isTestAccount: HARDHAT_TEST_ACCOUNTS.has(e.account),
  }));
  const withClaims = list.filter((e) => e.claimableUsd > 0 && !e.isTestAccount);
  withClaims.sort((a, b) => b.claimableUsd - a.claimableUsd);
  const values = withClaims.map((e) => e.claimableUsd).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;
  return {
    scannedRows: rows,
    addressesSeen: list.length,
    addressesWithClaims: withClaims.length,
    totalClaimableUsd: withClaims.reduce((s, e) => s + e.claimableUsd, 0),
    medianClaimUsd: median,
    addressesWithLivePositions: list.filter((e) => e.liveMarkets > 0).length,
    top: withClaims.slice(0, 25),
    scannedAt: new Date().toISOString(),
  };
}

/* ------------------------------- handlers ------------------------------- */

async function handleAddress(account) {
  if (!isAddress(account)) {
    return { status: 400, body: { error: "expected a 0x… 40-hex-char address" } };
  }
  const [balances, redemptions] = await Promise.all([
    indexer.balancesFor(account),
    indexer.redemptionsFor(account),
  ]);
  const summary = summarise(balances);
  const claimedUsd = redemptions.reduce(
    (s, r) => s + num(r.collateralOut) / 10 ** (num(r.market?.quoteDecimals) || 6),
    0,
  );
  // Question numbers come from two places: the market row when it holds a short counter,
  // otherwise a single batched OracleBind query. Markets with neither get no audit link
  // rather than a dead one.
  const byId = new Map();
  for (const r of balances) if (r.market) byId.set(r.market_id, r.market);
  const qnums = new Map();
  for (const c of summary.claimable) {
    const fromRow = questionNumberFromRow(byId.get(c.marketId));
    if (fromRow) qnums.set(c.marketId, fromRow);
  }
  const missing = summary.claimable.map((c) => c.marketId).filter((id) => !qnums.has(id));
  if (missing.length) {
    for (const [id, qn] of await indexer.questionNumbersFor(missing)) qnums.set(id, qn);
  }
  return {
    status: 200,
    body: {
      account: account.toLowerCase(),
      network: "Somnia Shannon testnet (50312)",
      source: "indexer: dev.smk.somnia.host",
      ...summary,
      alreadyClaimed: {
        usd: claimedUsd,
        redemptions: redemptions.length,
        lastAt: redemptions[0]?.timestamp ? Number(redemptions[0].timestamp) : null,
      },
      claimableRows: summary.claimable.map((c) => {
        const qn = qnums.get(c.marketId) ?? null;
        return {
          ...c,
          questionNumber: qn,
          oracleExplorer: oracleExplorerUrl(qn),
        };
      }),
    },
  };
}

async function handleSdk(account) {
  if (!isAddress(account)) {
    return { status: 400, body: { error: "expected a 0x… 40-hex-char address" } };
  }
  const { getClaimable } = await import("./sdk.mjs");
  try {
    // One SDK read, not two. In v0.30.0 this is an indexer-backed portfolio query whose
    // OutcomeBalance leg is capped at 200 rows; it is useful as an SDK compatibility
    // check, but must not be presented as a complete or on-chain authority result.
    const sdkResult = await getClaimable(account);
    const entries = sdkResult.positions.map((p) => ({
      marketId: p.marketId, outcomeIdx: p.outcomeIdx, amount: p.amount,
    }));
    return {
      status: 200,
      body: {
        account,
        ...sdkResult,
        plan: {
          entries: entries.length,
          dryRun: true,
          sampleEntry: entries[0] ?? null,
          note: "SDK-shaped redemption candidates; bounded by the SDK portfolio query",
        },
        source: "markets-sdk 0.30.0 (indexer-backed portfolio query)",
        bounded: true,
        portfolioRowLimit: 200,
        signerReady: Boolean(process.env.PRIVATE_KEY),
      },
    };
  } catch (err) {
    return { status: 502, body: { error: err.message, code: err.code ?? "SDK_ERROR" } };
  }
}

async function handleResolution(marketId) {
  const res = await indexer.resolution(marketId);
  if (!res.market) return { status: 404, body: { error: "market not found" } };
  const per = (idx) => {
    const den = num(res.market.payoutDenominator) || 1;
    const nums = (res.market.payoutNumerators ?? []).map(num);
    return nums.length ? nums[idx] / den : null;
  };
  const questionNumber = res.oracleBinds[0]?.oracleQuestionId ?? null;
  const bind = res.oracleBinds[0] ?? null;
  const gasUsedSOMI = bind?.charged ? Number(bind.charged) / 1e18 : null;
  return {
    status: 200,
    body: {
      marketId,
      question: res.market.question,
      status: res.market.clobStatus,
      voided: res.market.voided,
      winningOutcome: res.market.winningOutcome,
      payout: { up: per(0), down: per(1) },
      expiry: num(res.market.expiry),
      resolvedAt: num(res.market.resolvedAtTimestamp),
      settlementLatencySec:
        num(res.market.resolvedAtTimestamp) && num(res.market.expiry)
          ? num(res.market.resolvedAtTimestamp) - num(res.market.expiry)
          : null,
      // The 256-bit questionKey on the market row is NOT the explorer id. See docs/SDK-FEEDBACK.md.
      oracleQuestionKey: res.market.oracleQuestionId ?? null,
      questionNumber,
      oracleExplorer: oracleExplorerUrl(questionNumber),
      resolutionCost: {
        chargedSOMI: gasUsedSOMI,
        subsidySOMI: bind?.subsidy ? Number(bind.subsidy) / 1e18 : null,
        measuredGas: bind?.measuredGas ? Number(bind.measuredGas) : null,
        txHash: bind?.txHash ?? null,
      },
      oracleQuestion: res.oracleQuestion,
      oracleAnswers: res.oracleAnswers,
      oracleBinds: res.oracleBinds,
      resolutionEvents: res.resolutionEvents,
    },
  };
}

async function handleFees() {
  return { status: 200, body: { venues: await indexer.venueFees() } };
}

/* -------------------------------- router -------------------------------- */

export async function route(url) {
  const u = new URL(url, "http://x");
  const p = u.pathname;
  if (p === "/api/health") return { status: 200, body: { ok: true, service: "dreamdex-reclaim", ts: Date.now() } };
  if (p === "/api/network") return { status: 200, body: await memo("network", 120_000, scanNetwork) };
  if (p === "/api/address") return handleAddress(u.searchParams.get("address") ?? "");
  if (p === "/api/sdk") return handleSdk(u.searchParams.get("address") ?? "");
  if (p === "/api/resolution") return handleResolution(u.searchParams.get("marketId") ?? "");
  if (p === "/api/fees") return memo("fees", 300_000, handleFees);
  return null;
}

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(PUB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUB)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  });
}

export async function handler(req, res) {
  const url = req.url ?? "/";
  try {
    if (url.startsWith("/api/")) {
      const out = await route(url);
      if (!out) { res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}'); return; }
      res.writeHead(out.status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      return;
    }
    serveStatic(url.split("?")[0], res);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export default handler;
export const createServer = () => http.createServer(handler);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`DreamDEX Reclaim listening on http://0.0.0.0:${PORT}`);
    console.log(`indexer: ${TESTNET_INDEXER}`);
  });
}
