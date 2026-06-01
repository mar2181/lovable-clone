import { chromium } from "@playwright/test";

const PROJECT_ID = process.argv[2] || "M-Yzb7a7-R";
const BASE = process.argv[3] || "https://hswebappbuilder.space";
const URL = `${BASE}/editor/${PROJECT_ID}`;
const SHOT = "qa/screenshots/import-render.png";

const ERR = /could not find|cannot find module|module not found|failed to (compile|resolve)|is not defined|unexpected token|exited with|dependency not found/i;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErr = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErr.push(m.text());
});

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".sp-preview iframe", { timeout: 60000 });

const preview = page.frameLocator(".sp-preview iframe"); // the Sandpack preview iframe specifically

let verdict = "TIMEOUT";
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  // Compile/resolve errors render either in a parent overlay or inside the iframe.
  const parentOverlay = await page
    .locator(".sp-overlay, .sp-error")
    .allInnerTexts()
    .then((a) => a.join(" "))
    .catch(() => "");
  const iframeErr = await preview
    .locator("body")
    .innerText()
    .catch(() => "");
  if (ERR.test(parentOverlay) || ERR.test(iframeErr)) {
    verdict = "ERROR";
    console.log("error text:", (parentOverlay + " " + iframeErr).match(ERR)?.[0]);
    break;
  }

  // App-specific content proves alias + npm deps + svg all resolved.
  const countBtn = await preview.locator("text=/Count is:/i").count().catch(() => 0);
  const badge = await preview.locator("text=/shadcn\\/ui/i").count().catch(() => 0);
  if (countBtn > 0 && badge > 0) {
    verdict = "RENDERED";
    break;
  }
  await page.waitForTimeout(1500);
}

let bodyText = "";
try {
  bodyText = (await preview.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 300);
} catch {}
await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});

console.log("\n================ RESULT ================");
console.log("verdict:", verdict);
console.log("preview iframe text:", JSON.stringify(bodyText));
const relevant = consoleErr.filter((e) => ERR.test(e)).slice(0, 6);
console.log("module-resolution console errors:", relevant.length ? "" : "NONE");
for (const e of relevant) console.log("  -", e.slice(0, 200));
console.log("screenshot:", SHOT);
console.log("=======================================");

await browser.close();
process.exit(verdict === "RENDERED" ? 0 : 1);
