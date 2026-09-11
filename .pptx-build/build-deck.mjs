import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "D:\\DreamDEX-Reclaim";
const buildDir = path.join(workspaceDir, ".pptx-build");
const outputDir = path.join(workspaceDir, "presentation-output");
const SKILL_DIR = "C:\\Users\\donth\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.909.12148\\skills\\presentations";
const RUNTIME_PYTHON = "C:\\Users\\donth\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const finalPath = path.join(outputDir, "DreamDEX-Reclaim-Hackathon-Deck-v2.pptx");
const candidatePath = path.join(workspaceDir, ".codex-finalizer", "candidate.pptx");

const {
  resolvePresentationFont,
  applyPresentationChartFont,
  finalizePresentation,
} = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.dirname(candidatePath), { recursive: true });

const FONT = resolvePresentationFont({ fontFamily: "Aptos" });
const BG = "#08090C";
const PANEL = "#0E1116";
const FG = "#E8ECF2";
const DIM = "#8B96A8";
const MUTED = "#5F6A7D";
const LINE = "#2A323F";
const GOLD = "#FFC861";
const GREEN = "#3DDC97";
const BLUE = "#6EA8FF";
const RED = "#FF5D73";

const logoPng = path.join(buildDir, "logo.png");
await sharp(path.join(workspaceDir, "public", "logo.svg")).resize(240, 240).png().toFile(logoPng);
const assets = {
  logo: await fs.readFile(logoPng),
  overview: await fs.readFile(path.join(buildDir, "app-overview.png")),
  wallet: await fs.readFile(path.join(buildDir, "wallet-results.png")),
  audit: await fs.readFile(path.join(buildDir, "settlement-audit.png")),
};

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function text(slide, value, position, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    typeface: FONT,
    fontSize: options.size ?? 26,
    bold: options.bold ?? false,
    color: options.color ?? FG,
    alignment: options.align ?? "left",
    verticalAlignment: options.valign ?? "top",
    autoFit: "none",
    wrap: "square",
    insets: options.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
  };
  return shape;
}

function box(slide, position, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? "roundRect",
    position,
    fill: options.fill ?? PANEL,
    line: { fill: options.line ?? LINE, width: options.lineWidth ?? 1 },
    borderRadius: options.radius ?? 18,
  });
}

function image(slide, bytes, position, alt, options = {}) {
  return slide.images.add({
    blob: bytes,
    contentType: "image/png",
    alt,
    fit: options.fit ?? "cover",
    position,
    geometry: options.geometry ?? "roundRect",
    borderRadius: options.radius ?? 18,
    ...(options.crop ? { crop: options.crop } : {}),
  });
}

function base(slide, number, titleValue, subtitleValue = "") {
  slide.background.fill = BG;
  text(slide, titleValue, { left: 72, top: 46, width: 1060, height: 60 }, { size: 44, bold: true });
  if (subtitleValue) text(slide, subtitleValue, { left: 72, top: 108, width: 1090, height: 48 }, { size: 21, color: DIM });
  text(slide, "DreamDEX Reclaim", { left: 72, top: 680, width: 260, height: 20 }, { size: 14, color: MUTED });
  text(slide, String(number).padStart(2, "0"), { left: 1180, top: 676, width: 32, height: 22 }, { size: 14, bold: true, color: MUTED, align: "right" });
}

function note(slide, value) {
  slide.speakerNotes.textFrame.setText(value);
}

// 1. Cover
{
  const slide = deck.slides.add();
  slide.background.fill = BG;
  image(slide, assets.logo, { left: 92, top: 100, width: 118, height: 118 }, "DreamDEX Reclaim logo", { fit: "contain", radius: 28 });
  text(slide, "DreamDEX Reclaim", { left: 90, top: 260, width: 1040, height: 88 }, { size: 68, bold: true });
  text(slide, "Settlement recovery and oracle auditing for DreamDEX Event Contracts", { left: 94, top: 365, width: 980, height: 80 }, { size: 30, color: GOLD });
  text(slide, "Somnia × DreamDEX Event Contracts Hackathon", { left: 94, top: 520, width: 720, height: 34 }, { size: 20, color: DIM });
  text(slide, "Read-only public demo on Somnia Shannon testnet", { left: 94, top: 558, width: 720, height: 30 }, { size: 18, color: MUTED });
  text(slide, "01", { left: 1180, top: 676, width: 32, height: 22 }, { size: 14, bold: true, color: MUTED, align: "right" });
  note(slide, "Project source: DreamDEX Reclaim repository and public application.");
}

// 2. Problem
{
  const slide = deck.slides.add();
  base(slide, 2, "Winning positions can disappear from discovery", "The live-market experience ends before every holder completes the settlement workflow.");
  slide.shapes.add({ geometry: "line", position: { left: 245, top: 335, width: 790, height: 0 }, line: { fill: LINE, width: 4 } });
  const steps = [
    { x: 100, n: "1", title: "Market trades", body: "The position appears in the live Event Contract list.", color: BLUE },
    { x: 465, n: "2", title: "Market finalizes", body: "The finalized binary leaves normal live discovery.", color: GOLD },
    { x: 830, n: "3", title: "Winning tokens remain", body: "A holder can still have redeemable outcome tokens.", color: GREEN },
  ];
  for (const step of steps) {
    box(slide, { left: step.x, top: 250, width: 300, height: 250 }, { fill: PANEL, line: step.color, lineWidth: 2, radius: 24 });
    text(slide, step.n, { left: step.x + 24, top: 273, width: 52, height: 54 }, { size: 38, bold: true, color: step.color });
    text(slide, step.title, { left: step.x + 24, top: 345, width: 250, height: 42 }, { size: 27, bold: true });
    text(slide, step.body, { left: step.x + 24, top: 406, width: 250, height: 68 }, { size: 20, color: DIM });
  }
  text(slide, "The missing product surface: post-settlement discovery and verification", { left: 166, top: 555, width: 948, height: 46 }, { size: 28, bold: true, color: GOLD, align: "center" });
  note(slide, "Source: dreamDEX Event Contracts recipes and gotchas. https://app.dreamdex.io/docs/developers/event-contracts/recipes and https://app.dreamdex.io/docs/developers/event-contracts/gotchas");
}

// 3. Product overview
{
  const slide = deck.slides.add();
  base(slide, 3, "One address opens the recovery workspace", "No wallet connection, authentication, or signature is required for discovery.");
  image(slide, assets.overview, { left: 72, top: 168, width: 820, height: 470 }, "DreamDEX Reclaim address lookup and network evidence");
  text(slide, "Address lookup", { left: 940, top: 190, width: 260, height: 34 }, { size: 27, bold: true, color: BLUE });
  text(slide, "Scan any Somnia address and classify its indexed outcome-token positions.", { left: 940, top: 238, width: 270, height: 94 }, { size: 21, color: DIM });
  text(slide, "Immediate evidence", { left: 940, top: 370, width: 260, height: 34 }, { size: 27, bold: true, color: GOLD });
  text(slide, "The first screen shows a dated network snapshot while live scans run independently.", { left: 940, top: 418, width: 270, height: 96 }, { size: 21, color: DIM });
  text(slide, "Share or export", { left: 940, top: 552, width: 260, height: 34 }, { size: 27, bold: true, color: GREEN });
  text(slide, "Create a direct wallet URL or download a structured recovery report.", { left: 940, top: 598, width: 270, height: 58 }, { size: 20, color: DIM });
  note(slide, "Screenshot captured from the local DreamDEX Reclaim application using the demo address 0xfe7250509634abb94b3cdbd72eb122feccac157c.");
}

// 4. Features
{
  const slide = deck.slides.add();
  base(slide, 4, "The wallet view separates every settlement state", "A non-zero outcome-token balance does not automatically mean a winning claim.");
  text(slide, "UNCLAIMED", { left: 76, top: 190, width: 220, height: 28 }, { size: 18, bold: true, color: GOLD });
  text(slide, "Finalized positions with a non-zero payout, ranked by estimated value.", { left: 76, top: 228, width: 340, height: 74 }, { size: 22 });
  text(slide, "LIVE EXPOSURE", { left: 76, top: 345, width: 220, height: 28 }, { size: 18, bold: true, color: BLUE });
  text(slide, "Positions in markets that remain open for trading.", { left: 76, top: 383, width: 340, height: 68 }, { size: 22 });
  text(slide, "REDEMPTION HISTORY", { left: 76, top: 495, width: 270, height: 28 }, { size: 18, bold: true, color: GREEN });
  text(slide, "Completed collections stay separate from balances that may still need action.", { left: 76, top: 533, width: 340, height: 82 }, { size: 22 });
  box(slide, { left: 455, top: 180, width: 753, height: 445 }, { fill: PANEL, line: LINE, radius: 20 });
  image(slide, assets.wallet, { left: 475, top: 205, width: 713, height: 191 }, "Wallet summary and claimable winnings table", { fit: "contain", radius: 12 });
  text(slide, "83,108", { left: 488, top: 444, width: 190, height: 52 }, { size: 38, bold: true, color: GOLD });
  text(slide, "estimated tUSDC", { left: 490, top: 500, width: 190, height: 28 }, { size: 17, color: DIM });
  text(slide, "427", { left: 753, top: 444, width: 120, height: 52 }, { size: 38, bold: true, color: GREEN });
  text(slide, "claimable markets", { left: 755, top: 500, width: 170, height: 28 }, { size: 17, color: DIM });
  text(slide, "7", { left: 1021, top: 444, width: 90, height: 52 }, { size: 38, bold: true, color: BLUE });
  text(slide, "live positions", { left: 1023, top: 500, width: 145, height: 28 }, { size: 17, color: DIM });
  note(slide, "Screenshot captured from the local DreamDEX Reclaim application. Values reflect changing Shannon testnet state.");
}

// 5. Audit trail
{
  const slide = deck.slides.add();
  base(slide, 5, "Every claim includes a settlement audit", "The interface connects the payout to the oracle record and resolution evidence.");
  box(slide, { left: 72, top: 175, width: 760, height: 430 }, { fill: PANEL, line: LINE, radius: 20 });
  image(slide, assets.audit, { left: 90, top: 205, width: 724, height: 282 }, "Settlement audit with oracle answer, payout vector, and redemption status", { fit: "contain", radius: 12 });
  text(slide, "Resolution evidence shown with each finalized position", { left: 110, top: 530, width: 682, height: 32 }, { size: 18, color: DIM, align: "center" });
  slide.shapes.add({ geometry: "line", position: { left: 885, top: 295, width: 245, height: 0 }, line: { fill: LINE, width: 3 } });
  text(slide, "Market.id", { left: 872, top: 245, width: 135, height: 42 }, { size: 24, bold: true, color: BLUE, align: "center" });
  text(slide, "OracleBind", { left: 1005, top: 245, width: 150, height: 42 }, { size: 24, bold: true, color: GOLD, align: "center" });
  text(slide, "OracleQuestion", { left: 930, top: 338, width: 210, height: 42 }, { size: 24, bold: true, color: GREEN, align: "center" });
  text(slide, "This join produces the numeric question identifier required by the oracle explorer.", { left: 875, top: 420, width: 300, height: 102 }, { size: 21, color: DIM, align: "center" });
  text(slide, "256-bit identifiers remain strings to prevent precision loss.", { left: 875, top: 545, width: 300, height: 64 }, { size: 20, bold: true, color: FG, align: "center" });
  note(slide, "Sources: DreamDEX Reclaim SDK feedback report and dreamDEX settlement documentation. https://app.dreamdex.io/docs/trading/event-contracts/settlement-and-voids");
}

// 6. Evidence
{
  const slide = deck.slides.add();
  base(slide, 6, "86% of represented wallets had an indexed claim", "Dated Shannon testnet snapshot from 2026-09-11. Testnet tUSDC has no customer-dollar value.");
  text(slide, "13,588,395", { left: 80, top: 208, width: 410, height: 76 }, { size: 58, bold: true, color: GOLD });
  text(slide, "estimated unclaimed tUSDC", { left: 84, top: 290, width: 360, height: 34 }, { size: 22, color: DIM });
  text(slide, "31,981", { left: 80, top: 388, width: 260, height: 58 }, { size: 44, bold: true, color: FG });
  text(slide, "non-zero balance rows", { left: 84, top: 451, width: 300, height: 32 }, { size: 20, color: DIM });
  text(slide, "p50 0s", { left: 80, top: 535, width: 260, height: 58 }, { size: 44, bold: true, color: GREEN });
  text(slide, "expiry to resolution", { left: 84, top: 598, width: 300, height: 32 }, { size: 20, color: DIM });
  const chart = slide.charts.add("bar", {
    position: { left: 525, top: 205, width: 670, height: 390 },
    categories: ["Wallets with indexed claims", "Other represented wallets"],
    series: [{
      name: "Wallets",
      values: [6912, 1169],
      points: [{ idx: 0, fill: GOLD }, { idx: 1, fill: LINE }],
    }],
    barOptions: { direction: "bar", grouping: "clustered", gapWidth: 62 },
    hasLegend: false,
    xAxis: { visible: false, majorGridlines: null },
    yAxis: { textStyle: { fill: FG, fontSize: 19, typeface: FONT }, line: { fill: "none", width: 0 } },
    dataLabels: { showValue: true, position: "outEnd", textStyle: { fill: FG, fontSize: 19, bold: true, typeface: FONT } },
    chartFill: BG,
    chartLine: { fill: "none", width: 0 },
    plotAreaFill: BG,
    plotAreaLine: { fill: "none", width: 0 },
  });
  applyPresentationChartFont(chart, { fontFamily: FONT });
  text(slide, "6,912 of 8,081 represented addresses", { left: 635, top: 615, width: 475, height: 30 }, { size: 19, color: DIM, align: "center" });
  note(slide, "Source: DreamDEX Reclaim network scan snapshot captured on 2026-09-11. Figures describe Shannon testnet state and change over time.");
}

// 7. Technical integration
{
  const slide = deck.slides.add();
  base(slide, 7, "Two read paths with limits shown", "The product uses each source for the job it can support.");
  slide.shapes.add({ geometry: "line", position: { left: 255, top: 360, width: 770, height: 0 }, line: { fill: LINE, width: 4 } });
  const layers = [
    { x: 80, color: BLUE, title: "Indexer", body: "Fast wallet discovery\nOutcomeBalance joined to Market\nPaginated recovery view" },
    { x: 470, color: GREEN, title: "Settlement audit", body: "OracleBind resolution join\nPayout vector classification\nOracle explorer evidence" },
    { x: 860, color: GOLD, title: "SDK compatibility", body: "getClaimable candidates\nredeemMany payload preview\nPublic demo stays read-only" },
  ];
  for (const layer of layers) {
    box(slide, { left: layer.x, top: 230, width: 330, height: 285 }, { fill: PANEL, line: layer.color, lineWidth: 2, radius: 24 });
    text(slide, layer.title, { left: layer.x + 26, top: 263, width: 275, height: 42 }, { size: 29, bold: true, color: layer.color });
    text(slide, layer.body, { left: layer.x + 26, top: 330, width: 275, height: 138 }, { size: 21, color: FG });
  }
  text(slide, "SDK v0.30.0 limits its portfolio query to 200 outcome-balance rows. Reclaim labels the result as bounded.", { left: 150, top: 570, width: 980, height: 54 }, { size: 22, bold: true, color: GOLD, align: "center" });
  note(slide, "Source: inspected @somnia-chain/markets-sdk v0.30.0 behavior documented in docs/SDK-FEEDBACK.md. The compatibility path is not presented as independent on-chain authority.");
}

// 8. Close
{
  const slide = deck.slides.add();
  slide.background.fill = BG;
  text(slide, "A visible recovery path for finalized positions", { left: 88, top: 85, width: 1060, height: 72 }, { size: 52, bold: true });
  text(slide, "User outcome", { left: 92, top: 220, width: 240, height: 36 }, { size: 22, bold: true, color: GOLD });
  text(slide, "Holders can find indexed winnings that normal live discovery no longer shows.", { left: 92, top: 270, width: 500, height: 82 }, { size: 27 });
  text(slide, "Ecosystem outcome", { left: 92, top: 405, width: 280, height: 36 }, { size: 22, bold: true, color: GREEN });
  text(slide, "DreamDEX gains a clearer post-settlement experience and reproducible SDK feedback.", { left: 92, top: 455, width: 500, height: 86 }, { size: 27 });
  box(slide, { left: 700, top: 205, width: 475, height: 350 }, { fill: PANEL, line: LINE, lineWidth: 1, radius: 28 });
  text(slide, "TRY THE PRODUCT", { left: 750, top: 255, width: 370, height: 28 }, { size: 18, bold: true, color: BLUE, align: "center" });
  text(slide, "dream-dex-reclaim.vercel.app", { left: 745, top: 312, width: 385, height: 48 }, { size: 27, bold: true, color: FG, align: "center" });
  text(slide, "SOURCE CODE", { left: 750, top: 407, width: 370, height: 28 }, { size: 18, bold: true, color: GOLD, align: "center" });
  text(slide, "github.com/sharath2525/DreamDEX-Reclaim", { left: 735, top: 462, width: 405, height: 64 }, { size: 21, color: FG, align: "center" });
  text(slide, "Somnia Shannon testnet", { left: 91, top: 630, width: 360, height: 28 }, { size: 18, color: MUTED });
  text(slide, "08", { left: 1180, top: 676, width: 32, height: 22 }, { size: 14, bold: true, color: MUTED, align: "right" });
  note(slide, "Live URL: https://dream-dex-reclaim.vercel.app/  Repository: https://github.com/sharath2525/DreamDEX-Reclaim");
}

await (await PresentationFile.exportPptx(deck)).save(candidatePath);

const requirements = {
  explicitTotalSlideCount: 8,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [6],
  materializeLiteralChartWorkbooks: true,
  nativeChartTargetApplication: "powerpoint",
};
const result = await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu", "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: "design", families: [FONT] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(workspaceDir, ".codex-finalizer", "DreamDEX-Reclaim-Hackathon-Deck-v2.validation.json"),
});

console.log(JSON.stringify({ finalPath, font: FONT, result }, null, 2));
