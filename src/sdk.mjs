/**
 * sdk.mjs — the write path. Redemption goes through @somnia-chain/markets-sdk,
 * the only supported developer surface for Event Contracts.
 *
 * `client.getClaimable(account)` returns rows shaped to feed
 * `trader.redeemMany({ entries })` directly. In SDK 0.30.0 it is built from an
 * indexer-backed portfolio query capped at 200 outcome-balance rows. Reclaim therefore
 * exposes it as a bounded SDK compatibility check, not as a complete on-chain authority.
 *
 * Nothing here signs unless a private key is configured.
 */
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";

export const SDK_CONFIG = {
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
};

const PRIVATE_KEY = process.env.PRIVATE_KEY;

let cached;

/** Read-only exchange. No key required — the WebSocket opens lazily on chain I/O. */
export function exchange() {
  if (!cached) cached = new SomniaMarkets({ ...SDK_CONFIG });
  return cached;
}

/**
 * SDK-derived claimable positions for an address. This is intentionally labelled
 * bounded: the SDK's portfolio query selects at most 200 outcome-balance rows.
 */
export async function getClaimable(account) {
  const started = Date.now();
  const positions = await exchange().client.getClaimable(account);
  const ms = Date.now() - started;
  const rawTotal = positions.reduce((s, p) => s + (p.estPayout ?? 0n), 0n);
  return {
    ms,
    count: positions.length,
    bounded: true,
    portfolioRowLimit: 200,
    source: "markets-sdk 0.30.0 (indexer-backed portfolio query)",
    rawEstPayoutTotal: rawTotal.toString(),
    positions: positions.map((p) => ({
      marketId: p.marketId,
      pool: p.pool,
      outcomeIdx: p.outcomeIdx,
      outcome: p.outcomeIdx === 0 ? "Up" : "Down",
      amount: (p.amount ?? 0n).toString(),
      estPayout: (p.estPayout ?? 0n).toString(),
      status: p.status,
    })),
  };
}

/**
 * The exact `redeemMany` payload the SDK expects, built from `getClaimable` output.
 * Exported so the UI can show the user precisely what will be signed before they sign it.
 */
export async function buildRedeemPlan(account) {
  const { positions, ms } = await getClaimable(account);
  const entries = positions.map((p) => ({
    marketId: p.marketId,
    outcomeIdx: p.outcomeIdx,
    amount: BigInt(p.amount ?? "0"),
  }));
  return { entries, positions, ms };
}

/**
 * Execute a redemption. Requires PRIVATE_KEY; throws otherwise rather than pretending.
 * A voided market needs both legs redeemed explicitly (each pays 0.5), which is why we
 * pass every entry `getClaimable` returned instead of guessing the winning side.
 */
export async function redeem(account, { dryRun = true } = {}) {
  const { entries, positions, ms } = await buildRedeemPlan(account);
  // A dry run is a read: it plans and reports, and must work with no key configured.
  // Only the actual signature requires one.
  if (dryRun || entries.length === 0) {
    return {
      dryRun: true,
      entries: entries.length,
      positions,
      ms,
      txHash: null,
      signerReady: Boolean(PRIVATE_KEY),
      note: PRIVATE_KEY ? null : "PRIVATE_KEY is not set — plan only, nothing will be signed",
    };
  }
  if (!PRIVATE_KEY) {
    const err = new Error("PRIVATE_KEY is not set — refusing to sign.");
    err.code = "NO_SIGNER";
    throw err;
  }
  const signerAccount = privateKeyToAccount(PRIVATE_KEY).address;
  if (signerAccount.toLowerCase() !== account.toLowerCase()) {
    const err = new Error(
      `Configured signer ${signerAccount} does not match requested account ${account}; refusing to submit another wallet's redemption plan.`,
    );
    err.code = "ACCOUNT_MISMATCH";
    throw err;
  }
  const signer = new SomniaMarkets({ ...SDK_CONFIG, privateKey: PRIVATE_KEY });
  const result = await signer.trader.redeemMany({ entries });
  return {
    dryRun: false,
    entries: entries.length,
    txHash: result?.receipt?.transactionHash ?? null,
    status: result?.receipt?.status ?? null,
    ms,
  };
}
