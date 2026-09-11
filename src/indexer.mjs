/**
 * indexer.mjs — read-only access to the Somnia Markets indexer (Envio/Hasura GraphQL).
 *
 * This is the fast path. DreamDEX's own `client.getClaimable()` answers from the chain
 * but SDK 0.30.0 builds that answer from an indexer portfolio query capped at 200
 * holdings. We use complete paginated indexer discovery and expose the SDK path only as
 * a bounded compatibility check — see src/sdk.mjs.
 */

export const TESTNET_INDEXER = "https://dev.smk.somnia.host/v1/graphql";
export const MAINNET_INDEXER = "https://prd.smk.somnia.host/v1/graphql";

/** Testnet collateral is tUSDC (6 decimals); mainnet is USDso (18). */
export const DEFAULT_DECIMALS = 6;

const MARKET_FIELDS = `
  id marketId question oracleQuestionId clobStatus finalized voided winningOutcome
  payoutNumerators payoutDenominator expiry tradingStart resolvedAtTimestamp resolvedAtBlock
  cumulativeQuoteVolume tradeCount openInterest venueId series_id nonce
  lotSize tickSize quoteDecimals yesTokenId noTokenId voidPolicy asset strike
  marketAddress poolAddress binaryPoolAddress`;

export class Indexer {
  constructor(url = TESTNET_INDEXER, { timeoutMs = 30_000 } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Run a query. Selection sets are passed bare, so we wrap them in an anonymous
   * operation that declares every variable — Hasura rejects an undeclared one with
   * `unbound variable "x"`. Types matter: a `$String` used where `Int` is expected is
   * rejected, and the indexer's `numeric` scalars come back stringified, so only the
   * pagination and ordering arguments are Int/enum. Everything else declares as String.
   */
  async gql(selection, variables = {}, varTypes = {}) {
    // Hasura rejects an undeclared variable and rejects a wrong type, so every variable is
    // declared here. Scalars that are not String must be named by the caller: `limit`/`offset`
    // are Int, the question id is the indexer's `numeric`, and filter/order types are per-table.
    const VAR_TYPES = { limit: "Int", offset: "Int", ids: "[String!]", qidNum: "numeric", ...varTypes };
    const names = Object.keys(variables);
    const decl = names.length
      ? `(${names.map((n) => `$${n}: ${VAR_TYPES[n] ?? "String"}`).join(", ")})`
      : "";
    const query = `query ${decl} ${selection}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(`indexer: ${json.errors[0].message}`);
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Page through a table. The indexer exposes no aggregates, so counts are client-side. */
  async *pages(table, { where, fields, order_by, pageSize = 1000, max = 200_000 } = {}) {
    let offset = 0;
    while (offset < max) {
      const data = await this.gql(
        `{ ${table}(where: $where, limit: $limit, offset: $offset, order_by: $order) { ${fields} } }`,
        { where, limit: pageSize, offset, order: order_by },
        // Hasura's order_by is a non-null LIST, so the variable type is bracketed.
        { where: `${table}_bool_exp`, order: `[${table}_order_by!]` },
      );
      const rows = data[table] ?? [];
      yield* rows;
      if (rows.length < pageSize) return;
      offset += pageSize;
    }
  }

  /** Every non-zero outcome-token holding, joined to its market's terminal state. */
  async *outcomeBalances() {
    yield* this.pages("OutcomeBalance", {
      where: { balance: { _neq: "0" } },
      order_by: { id: "asc" },
      fields: `id account balance outcomeIndex tokenId market_id market { ${MARKET_FIELDS} }`,
    });
  }

  /** One address's non-zero holdings. Cheap: the indexer filters by account. */
  async balancesFor(account) {
    const data = await this.gql(
      `{ OutcomeBalance(where: { account: { _eq: $account }, balance: { _neq: "0" } }, limit: 5000)
          { balance outcomeIndex tokenId market_id market { ${MARKET_FIELDS} } } }`,
      { account: account.toLowerCase() },
    );
    return data.OutcomeBalance;
  }

  /** Redemption history for one address — what they already claimed. */
  async redemptionsFor(account, limit = 500) {
    const data = await this.gql(
      `{ RedemptionRecord(where: { holder: { _eq: $account } }, limit: $limit, order_by: { timestamp: desc })
          { collateralOut amountBurned outcomeIdx market_id timestamp txHash blockNumber
            market { question clobStatus quoteDecimals } } }`,
      { account: account.toLowerCase(), limit },
    );
    return data.RedemptionRecord;
  }

  /**
   * Resolve a market's settlement question NUMBER.
   *
   * The only path that works is Market.id -> OracleBind.market_id -> OracleBind.oracleQuestionId.
   * Joining Market.oracleQuestionId to OracleQuestion.questionKey does NOT work: the former is a
   * decimal 256-bit integer and the latter a hex string, and they are different values, not two
   * encodings of the same one. Verified against live testnet rows. See docs/SDK-FEEDBACK.md.
   */
  async questionNumberFor(marketId) {
    const data = await this.gql(
      `{ OracleBind(where: { market_id: { _eq: $id } }, limit: 5, order_by: { bindIndex: asc })
          { id oracleQuestionId bindIndex resolvedAt resolvedAtBlock cost charged subsidy
            measuredGas overheadShare txHash } }`,
      { id: marketId },
    );
    return data.OracleBind ?? [];
  }

  /** The settlement audit trail: how a market's answer was produced, step by step. */
  async resolution(marketId) {
    const data = await this.gql(
      `{ Market(where: { id: { _eq: $id } }, limit: 1) { ${MARKET_FIELDS} }
         res: MarketResolutionEvent(where: { market_id: { _eq: $id } }, limit: 10)
           { kind outcomeIdx outcomeSlotCount payoutNumerators payoutDenominator voided
             oracleQuestionId txHash blockNumber timestamp } }`,
      { id: marketId },
    );
    const market = data.Market?.[0] ?? null;
    const binds = await this.questionNumberFor(marketId);

    let answers = [];
    let question = null;
    // Two settlement paths coexist on testnet. Real Event Contracts ("X closes at or
    // above its opening price") carry a short question counter straight on the market row;
    // the synthetic "Pricefeed test:" markets carry a 256-bit questionKey there instead and
    // resolve with no OracleBind row at all. Prefer the bind, fall back to a short row value.
    const qid = binds[0]?.oracleQuestionId ?? (questionNumberFromRow(market) || null);
    if (qid != null) {
      // Both oracle tables key on the question NUMBER (the indexer's `numeric` scalar).
      // `questionKey` is an opaque hash, not the hex of that number — deriving it from the
      // id returns no rows. Verified: question 53949 has key 0x24c03f82…, not 0x…d2bd.
      const second = await this.gql(
        `{ ans: OracleAnswer(where: { oracleQuestionId: { _eq: $qidNum } }, limit: 20)
              { numericValue outcomeIdx outcomeLabel voided voidReason txHash resolvedAt }
           quest: OracleQuestion(where: { oracleQuestionId: { _eq: $qidNum } }, limit: 1)
              { oracleQuestionId questionKey payoutNumerators payoutDenominator resolvedAt voided
                oracleCost scheduler bindCount reuseCount supersededByQuestionId } }`,
        { qidNum: qid },
      );
      answers = second.ans ?? [];
      question = second.quest?.[0] ?? null;
    }
    return {
      market,
      resolutionEvents: data.res ?? [],
      oracleAnswers: answers,
      oracleQuestion: question,
      oracleBinds: binds,
    };
  }

  /**
   * Batch map marketId -> question number, so a wallet with hundreds of settled markets
   * costs one OracleBind query instead of one per market.
   */
  async questionNumbersFor(marketIds) {
    const ids = [...new Set(marketIds.filter(Boolean))];
    const out = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const data = await this.gql(
        `{ OracleBind(where: { market_id: { _in: $ids } }, limit: 2000)
            { market_id oracleQuestionId bindIndex } }`,
        { ids: chunk },
      );
      for (const b of data.OracleBind ?? []) {
        if (!out.has(b.market_id)) out.set(b.market_id, rawStr(b.oracleQuestionId));
      }
    }
    return out;
  }

  /**
   * Batch map marketId -> question number, using the OracleBind row where one exists and
   * the market row's own short counter otherwise. Markets with neither (the synthetic
   * pricefeed ones) are simply absent from the map, and the UI then shows no audit link
   * rather than a dead one.
   */
  async questionNumbersForMarkets(markets) {
    const out = new Map();
    for (const m of markets ?? []) {
      const fromRow = questionNumberFromRow(m);
      if (fromRow) out.set(m.id, fromRow);
    }
    const missing = (markets ?? []).filter((m) => !out.has(m.id)).map((m) => m.id);
    if (missing.length) {
      const binds = await this.questionNumbersFor(missing);
      for (const [id, qn] of binds) if (!out.has(id)) out.set(id, qn);
    }
    return out;
  }

  async venueFees() {
    const data = await this.gql(
      `{ MarketVenue(limit: 20) { venueId makerFeeBps takerFeeBps settlementFeeBps routingFeeBps
          maxBuilderFeeBps feeRecipient operatorId } }`,
    );
    const seen = new Map();
    for (const v of data.MarketVenue ?? []) if (!seen.has(v.venueId)) seen.set(v.venueId, v);
    return [...seen.values()];
  }

  async syncStatus() {
    const data = await this.gql(`{ _meta { block { number } } chain_metadata(limit: 1) { id } }`);
    return data;
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers — no I/O, so they are unit-testable.                   */
/* ------------------------------------------------------------------ */

export const num = (v) => {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The indexer's `numeric` type is stringified, and some of those values are 256-bit.
 * `Number("2550630950…3421")` becomes 2.55e+75 and loses every digit past the 17th, so
 * identifiers must be carried as strings. This returns a plain integer string untouched
 * and coerces anything else, which is what a URL or a JSON field needs.
 */
export const rawStr = (v) => (v == null ? null : String(v));

/**
 * Read the question NUMBER off a market row when it is one.
 *
 * Testnet runs two settlement paths side by side and they populate the same column
 * differently:
 *   - real Event Contracts ("ETH closes at or above its opening price") -> a 5-digit
 *     question counter, e.g. "53949", which is what the oracle explorer wants
 *   - synthetic "Pricefeed test:" markets -> a 77-78 digit 256-bit questionKey, which is
 *     not an explorer id and has no OracleBind row at all
 * Anything too long to be a counter is treated as absent rather than mangled by Number().
 */
export function questionNumberFromRow(market) {
  const s = market?.oracleQuestionId == null ? null : String(market.oracleQuestionId).trim();
  if (!s || !/^\d+$/.test(s) || s.length > 9) return null;
  return s;
}


export const SETTLED_STATUSES = new Set(["Finalized", "Resolved", "Voided", "Settled"]);

export function isSettled(market) {
  if (!market) return false;
  return market.finalized === true || market.voided === true || SETTLED_STATUSES.has(market.clobStatus);
}

/**
 * Payout per whole contract for one outcome leg.
 * Resolved  -> the payout vector (1 for the winner, 0 for the loser).
 * Voided    -> the stored vector, which the protocol sets to 0.5 on both sides.
 */
export function payoutPerContract(market, outcomeIdx) {
  const den = num(market?.payoutDenominator) || 1;
  const nums = (market?.payoutNumerators ?? []).map(num);
  if (nums.length && nums[outcomeIdx] != null) return nums[outcomeIdx] / den;
  if (market?.voided === true) return 0.5;
  if (market?.winningOutcome != null) return market.winningOutcome === outcomeIdx ? 1 : 0;
  return 0;
}

/** Classify one holding row. `kind` drives which UI bucket it lands in. */
export function classifyBalance(row) {
  const market = row.market;
  const decimals = num(market?.quoteDecimals) || DEFAULT_DECIMALS;
  const contracts = num(row.balance) / 10 ** decimals;
  const base = {
    marketId: row.market_id,
    outcomeIdx: row.outcomeIndex,
    outcome: row.outcomeIndex === 0 ? "Up" : "Down",
    contracts,
    question: market?.question ?? null,
    status: market?.clobStatus ?? null,
    expiry: market ? num(market.expiry) : null,
    // 256-bit questionKey — must stay a string, see the docs erratum in docs/SDK-FEEDBACK.md.
    oracleQuestionKey: market ? rawStr(market.oracleQuestionId) : null,
    decimals,
  };
  if (!market) return { ...base, kind: "unknown", value: 0 };
  if (market.clobStatus === "Trading") {
    return { ...base, kind: "live", value: 0 };
  }
  if (!isSettled(market)) {
    return { ...base, kind: "pending", value: 0 };
  }
  const per = payoutPerContract(market, row.outcomeIndex);
  const value = contracts * per;
  return { ...base, kind: value > 0 ? "claimable" : "lost", perContract: per, value };
}

/** Bucket an address's holdings into live / claimable / lost, with rollups. */
export function summarise(rows) {
  const live = [];
  const claimable = [];
  const lost = [];
  const pending = [];
  for (const row of rows) {
    const c = classifyBalance(row);
    if (c.kind === "live") live.push(c);
    else if (c.kind === "claimable") claimable.push(c);
    else if (c.kind === "lost") lost.push(c);
    else pending.push(c);
  }
  claimable.sort((a, b) => b.value - a.value);
  live.sort((a, b) => b.contracts - a.contracts);
  const settledMarkets = new Set([...claimable, ...lost].map((x) => x.marketId));
  return {
    live,
    claimable,
    lost,
    pending,
    totals: {
      claimableUsd: claimable.reduce((s, c) => s + c.value, 0),
      claimableMarkets: new Set(claimable.map((c) => c.marketId)).size,
      claimableLegs: claimable.length,
      liveContracts: live.reduce((s, c) => s + c.contracts, 0),
      liveMarkets: new Set(live.map((c) => c.marketId)).size,
      lostContracts: lost.reduce((s, c) => s + c.contracts, 0),
      settledMarkets: settledMarkets.size,
      winLegs: claimable.length,
      lossLegs: lost.length,
      winRate: claimable.length + lost.length
        ? claimable.length / (claimable.length + lost.length)
        : null,
    },
  };
}

/**
 * Public oracle explorer deep-link.
 *
 * Takes the question NUMBER (OracleQuestion.oracleQuestionId — a small counter like
 * "54113"), NOT Market.oracleQuestionId, which is a 77-digit 256-bit questionKey.
 * Refuses the hash form rather than emitting a dead link, because the two fields share
 * a name and silently produce a 2.55e+75 URL when confused. See docs/SDK-FEEDBACK.md.
 */
export function oracleExplorerUrl(questionNumber) {
  if (questionNumber == null) return null;
  const s = String(questionNumber).trim();
  if (!/^\d+$/.test(s)) return null;
  if (s.length > 9) return null; // a question number is a counter, not a 256-bit hash
  if (Number(s) === 0) return null; // the counter is 1-based; 0 is never a real question
  return `https://prd.oracle.somnia.host/questions/${s}?view=graph`;
}
