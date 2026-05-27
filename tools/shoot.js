// Render the viewer in a headless mobile browser and capture screenshots
// + console errors. Usage:
//   node tools/shoot.js                 # all docs in manifest.json
//   node tools/shoot.js welcome.md ...  # specific docs
//   BASE=http://localhost:8000 node tools/shoot.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:8000";
const OUT = "/tmp/shots";
const FULL = process.env.FULL !== "0";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let targets = process.argv.slice(2);
  if (!targets.length) {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    targets = m.files.map((f) => f.name);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, // test env sits behind a TLS-intercepting proxy
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: process.env.COLOR === "dark" ? "dark" : "light",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  await context.addInitScript(() => {
    try { sessionStorage.setItem("mdv_unlocked", "1"); } catch (e) {}
  });

  let totalErrors = 0;
  for (const name of targets) {
    const page = await context.newPage();
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    const url = BASE + "/#" + encodeURIComponent(name);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
    await page.waitForTimeout(900); // let mermaid/katex/highlight finish
    const safe = name.replace(/[^a-z0-9._-]/gi, "_");
    await page.screenshot({ path: path.join(OUT, safe + ".png"), fullPage: FULL }).catch((e) => errors.push("shot: " + e.message));
    if (errors.length) { totalErrors += errors.length; console.log(`\n[${name}]`); errors.forEach((e) => console.log("  " + e)); }
    else console.log(`[${name}] ok`);
    await page.close();
  }
  await browser.close();
  console.log(`\nScreenshots in ${OUT}. Total console/page errors: ${totalErrors}`);
})().catch((e) => { console.error(e); process.exit(1); });
