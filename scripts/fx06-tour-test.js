// fx06-tour-test.js — capture the new courier choreography at key beats
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "..");
const PAGE = path.join(REPO, "landing", "index.html");
const OUT = path.join(__dirname, "_fx06tour");

// beats in the 15s cycle (module clock starts when #cta scrolls into view)
const BEATS = [
  { t: 6.45, name: "a-born" },     // courier just popped at card centre
  { t: 7.75, name: "b-early" },    // first chip checked, courier heading to 2nd
  { t: 9.00, name: "c-mid" },      // mid-arc sweep
  { t: 10.45, name: "d-last" },    // final arrivals
  { t: 12.60, name: "e-hold" },    // all queued + pulse
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));

  await p.goto("file://" + PAGE, { waitUntil: "load", timeout: 45000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);

  // scroll to #cta -> IntersectionObserver starts the module clock
  await p.evaluate(() => {
    const el = document.querySelector("#cta");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
  });
  await p.waitForTimeout(300); // IO threshold fire + first frame ≈ clock t=0

  for (const b of BEATS) {
    const waitMs = Math.max(0, b.t * 1000 - 300);
    await p.waitForTimeout(b.t === BEATS[0].t ? waitMs : (b.t - BEATS[BEATS.indexOf(b) - 1].t) * 1000);
    await p.screenshot({ path: path.join(OUT, `desk-${b.name}.png`) });
    console.log("shot:", b.name);
  }

  // mobile spot-check: one mid-tour frame
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto("file://" + PAGE, { waitUntil: "load", timeout: 45000 });
  await m.waitForTimeout(1200);
  await m.evaluate(() => {
    const el = document.querySelector("#cta");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
  });
  await m.waitForTimeout(8700); // mid-tour
  await m.screenshot({ path: path.join(OUT, "mob-mid.png") });
  console.log("shot: mob-mid");

  console.log("pageerrors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
})();
