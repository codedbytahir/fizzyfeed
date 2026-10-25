// halftone-check.js — verify the deck-fan halftone chapter art renders correctly.
// The 7 fx-deck-fan cards each carry a .fx-deck-fan__art host; halftone.js paints
// the chapter image as an ink dot print over the card gradient. The chapters-grid
// below the fan is the plain 5023ee0 bento list (no halftone there).
// Serves landing/ over http (file:// taints canvases) and drives a headless
// browser through: paint coverage, decorative pointer rules, grid restore,
// mobile layout, reduced-motion static render. Output -> landing/_smoke/.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");

const REPO = path.resolve(__dirname, "..");
const ROOT = path.join(REPO, "landing");
const SHOTS = path.join(ROOT, "_smoke");
fs.mkdirSync(SHOTS, { recursive: true });

const mime = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/\/+$/, "/index.html");
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(rel)] || "application/octet-stream" });
    res.end(buf);
  });
});

const paintedRatio = (page, sel) => page.evaluate((sel) => {
  const c = document.querySelector(sel + " canvas");
  if (!c) return -1;
  const p = document.createElement("canvas");
  p.width = 40; p.height = 20;
  const x = p.getContext("2d");
  x.drawImage(c, 0, 0, 40, 20);
  const d = x.getImageData(0, 0, 40, 20).data;
  let painted = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
  return painted / (40 * 20);
}, sel);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  const ok = [], bad = [];
  const t = (name, cond, detail) => (cond ? ok : bad).push(`${name}${detail ? " — " + detail : ""}`);
  const browser = await chromium.launch();

  try {
    // desktop
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => document.querySelector(".fx-deck-fan").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(2800);

    const art = await page.evaluate(() =>
      [...document.querySelectorAll(".fx-deck-fan__art")].map((box) => ({
        host: box.hasAttribute("data-halftone"),
        canvas: !!box.querySelector("canvas"),
        failed: box.classList.contains("halftone-failed"),
        pointer: getComputedStyle(box).pointerEvents,
        inFan: !!box.closest(".fx-deck-fan"),
      })));
    t("7 art hosts in the fan", art.length === 7, "found " + art.length);
    t("all hosts are data-halftone + in fan", art.every((a) => a.host && a.inFan));
    t("all canvases created", art.every((a) => a.canvas));
    t("no failed/ tainted loads", art.every((a) => !a.failed));
    t("art is decorative (pointer-events none)", art.every((a) => a.pointer === "none"));

    const ratios = await page.evaluate(() =>
      [...document.querySelectorAll(".fx-deck-fan__art")].map((box) => {
        const c = box.querySelector("canvas");
        if (!c) return -1;
        const p = document.createElement("canvas");
        p.width = 40; p.height = 20;
        const x = p.getContext("2d");
        x.drawImage(c, 0, 0, 40, 20);
        const d = x.getImageData(0, 0, 40, 20).data;
        let painted = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
        return painted / (40 * 20);
      }));
    t("all 7 canvases painted", ratios.every((r) => r > 0.02), ratios.map((r) => r.toFixed(2)).join(","));

    // the grid below must be the plain restored bento list
    const grid = await page.evaluate(() => {
      const g = document.querySelector(".chapters-grid");
      return {
        cards: g ? g.querySelectorAll(".chapter").length : 0,
        media: g ? g.querySelectorAll(".chapter-media").length : -1,
        halftone: g ? g.querySelectorAll("[data-halftone]").length : -1,
      };
    });
    t("grid restored: 8 plain cards", grid.cards === 8 && grid.media === 0 && grid.halftone === 0,
      JSON.stringify(grid));
    t("no [data-halftone] outside the fan", await page.evaluate(() =>
      [...document.querySelectorAll("[data-halftone]")].every((el) => !!el.closest(".fx-deck-fan"))));
    t("zero console errors (desktop)", errors.length === 0, errors.slice(0, 2).join(";"));

    await page.locator(".fx-deck-fan").screenshot({ path: path.join(SHOTS, "halftone-fan-desktop.png") });
    await page.close();

    // mobile
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const merr = [];
    mob.on("pageerror", (e) => merr.push(e.message));
    mob.on("console", (m) => { if (m.type() === "error") merr.push(m.text()); });
    await mob.goto(BASE, { waitUntil: "load" });
    await mob.evaluate(() => document.querySelector(".fx-deck-fan").scrollIntoView({ block: "center" }));
    await mob.waitForTimeout(2400);
    const mobOk = await mob.evaluate(() => ({
      canvases: document.querySelectorAll(".fx-deck-fan__art canvas").length,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    t("mobile: 7 canvases render", mobOk.canvases === 7, "found " + mobOk.canvases);
    t("mobile: no page overflow", mobOk.pageOverflow <= 1, "delta " + mobOk.pageOverflow);
    t("mobile: zero console errors", merr.length === 0, merr.slice(0, 2).join(";"));
    await mob.locator(".fx-deck-fan").screenshot({ path: path.join(SHOTS, "halftone-fan-mobile.png") });
    await mob.close();

    // reduced motion: static render, no animation loop
    const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await rm.goto(BASE, { waitUntil: "load" });
    await rm.evaluate(() => document.querySelector(".fx-deck-fan").scrollIntoView({ block: "center" }));
    await rm.waitForTimeout(1800);
    const rmPainted = await paintedRatio(rm, ".fx-deck-fan__art");
    t("reduced-motion: static dots still render", rmPainted > 0.02, "painted " + rmPainted.toFixed(2));
    await rm.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log("=== PASS (" + ok.length + ") ===");
  ok.forEach((l) => console.log("  ✓ " + l));
  if (bad.length) {
    console.log("=== FAIL (" + bad.length + ") ===");
    bad.forEach((l) => console.log("  ✗ " + l));
    process.exit(1);
  }
  console.log("done -> " + SHOTS);
})();
