import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:4173/?address=0xfe7250509634abb94b3cdbd72eb122feccac157c", {
  waitUntil: "domcontentloaded",
  timeout: 30_000,
});
await page.waitForFunction(
  () => document.querySelector("#result")?.textContent?.includes("Unclaimed winnings"),
  { timeout: 30_000 },
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(250);
await page.screenshot({ path: "D:\\DreamDEX-Reclaim\\.pptx-build\\app-overview.png", fullPage: false });
const resultBox = await page.locator("#result").boundingBox();
if (!resultBox) throw new Error("Wallet results were not measurable");
await page.screenshot({
  path: "D:\\DreamDEX-Reclaim\\.pptx-build\\wallet-results.png",
  clip: { x: resultBox.x, y: resultBox.y, width: resultBox.width, height: Math.min(880, resultBox.height) },
});
await page.locator("#result tr.rowlink").filter({ has: page.locator("a") }).first().click();
await page.waitForFunction(
  () => document.querySelector("#audit")?.textContent?.includes("Redemption open"),
  { timeout: 30_000 },
);
await page.locator("#audit").screenshot({ path: "D:\\DreamDEX-Reclaim\\.pptx-build\\settlement-audit.png" });
await browser.close();
