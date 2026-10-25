// smoke-test-landing.js — render landing + each fx module headlessly, catch errors, screenshot
const { chromium } = require("playwright");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ROOT = path.join(REPO, "landing");
const SHOTS = path.join(ROOT, "_smoke");
const targets = [
  { name: "landing", file: `${ROOT}/index.html`, wait: 9000 },
  { name: "fx-01-hero-deck", file: `${ROOT}/animations/fx-01-hero-deck/index.html`, wait: 6000 },
  { name: "fx-02-feed-to-deck", file: `${ROOT}/animations/fx-02-feed-to-deck/index.html`, wait: 6000 },
  { name: "fx-03-deck-fan", file: `${ROOT}/animations/fx-03-deck-fan/index.html`, wait: 5000 },
  { name: "fx-04-yearline-draw", file: `${ROOT}/animations/fx-04-yearline-draw/index.html`, wait: 7000 },
  { name: "fx-05-persona-morph", file: `${ROOT}/animations/fx-05-persona-morph/index.html`, wait: 6000 },
  { name: "fx-06-queue-recap", file: `${ROOT}/animations/fx-06-queue-recap/index.html`, wait: 6000 },
];

(async () => {
  const fs = require("fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let failures = 0;

  for (const t of targets) {
    const errors = [];
    const onConsole = (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
    const onPageError = (e) => errors.push("pageerror: " + String(e).slice(0, 200));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    try {
      await page.goto("file://" + t.file, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(t.wait);
      // scroll landing through its sections so modules activate
      if (t.name === "landing") {
        for (const sel of ["#how", "#chapters", "#persona", "#cta"]) {
          await page.locator(sel).scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(1200);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);
      }
      await page.screenshot({ path: path.join(SHOTS, `${t.name}.png`) });
      const netErrors = errors.filter((e) => !/net::ERR_|esm\.sh|fonts\.g/.test(e));
      const extFail = errors.filter((e) => /esm\.sh|fonts\.g/.test(e));
      console.log(`${t.name}: console-errors=${netErrors.length} external=${extFail.length}`);
      if (netErrors.length) { failures++; console.log("  ⚠", netErrors.slice(0, 3).join(" | ")); }
      if (extFail.length) console.log("  ℹ external fetch issue (offline ok):", extFail.slice(0, 2).join(" | "));
    } catch (e) {
      failures++;
      console.log(`${t.name}: FAILED ${String(e).slice(0, 200)}`);
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    }
  }
  await browser.close();
  console.log(failures ? `SMOKE: ${failures} failure(s)` : "SMOKE: all pages rendered clean");
  process.exit(failures ? 1 : 0);
})();
