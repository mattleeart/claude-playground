// Verify the pattern lock unlocks with the configured pattern (0-3-6-7-8).
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8000";
const PATTERN = (process.env.PATTERN || "0-3-6-7-8").split("-").map(Number);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });

  const centers = await page.$$eval(".dot", (els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })
  );
  const pts = PATTERN.map((i) => centers[i]);
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) { await page.mouse.move(pts[i].x, pts[i].y, { steps: 6 }); }
  await page.mouse.up();
  await page.waitForTimeout(600);

  const appVisible = await page.evaluate(() => {
    const app = document.getElementById("app");
    return !!app && !app.hidden;
  });
  console.log("unlocked (app visible):", appVisible);
  console.log("errors:", errors.length ? errors : "none");
  await page.screenshot({ path: "/tmp/shots/_after_unlock.png" });
  await browser.close();
  process.exit(appVisible ? 0 : 2);
})();
