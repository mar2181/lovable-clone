// Live verification that imported image assets actually render (not broken).
// Usage: node qa/verify-image-render.mjs <projectId> [baseUrl]
import { chromium } from "@playwright/test";

const PROJECT_ID = process.argv[2];
const BASE = process.argv[3] || "https://hswebappbuilder.space";
const URL = `${BASE}/editor/${PROJECT_ID}`;
const SHOT = "qa/screenshots/image-render.png";
const ERR = /could not find|cannot find module|module not found|failed to (compile|resolve)|is not defined|unexpected token|exited with|dependency not found/i;

if (!PROJECT_ID) { console.error("need projectId"); process.exit(2); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErr = [];
page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".sp-preview iframe", { timeout: 60000 });
const preview = page.frameLocator(".sp-preview iframe");

let verdict = "TIMEOUT";
let imgs = [];
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const overlay = await page.locator(".sp-overlay, .sp-error").allInnerTexts().then((a) => a.join(" ")).catch(() => "");
  const iframeErr = await preview.locator("body").innerText().catch(() => "");
  if (ERR.test(overlay) || ERR.test(iframeErr)) {
    verdict = "ERROR";
    console.log("error text:", (overlay + " " + iframeErr).match(ERR)?.[0]);
    break;
  }
  // Inspect every <img> the imported app rendered: a real, decoded image has naturalWidth > 0.
  imgs = await preview.locator("img").evaluateAll((els) =>
    els.map((el) => ({
      src: (el.getAttribute("src") || "").slice(0, 50),
      w: el.naturalWidth,
      h: el.naturalHeight,
    })),
  ).catch(() => []);
  if (imgs.length > 0 && imgs.some((i) => i.w > 0 && i.h > 0)) {
    verdict = "RENDERED";
    break;
  }
  await page.waitForTimeout(1500);
}

await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});

console.log("\n================ RESULT ================");
console.log("verdict:", verdict);
console.log("images found:", imgs.length);
for (const i of imgs) console.log(`  ${i.w}x${i.h}  src=${i.src}…`);
const relevant = consoleErr.filter((e) => ERR.test(e)).slice(0, 6);
console.log("module-resolution console errors:", relevant.length ? "" : "NONE");
for (const e of relevant) console.log("  -", e.slice(0, 160));
console.log("screenshot:", SHOT);
console.log("=======================================");

await browser.close();
process.exit(verdict === "RENDERED" ? 0 : 1);
