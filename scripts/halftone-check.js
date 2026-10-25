// halftone-check.js — verify the chapter halftone dot cards render + interact.
// Serves landing/ over http (file:// taints canvases) and drives a headless
// browser through: paint coverage, hover lens, 7-press burst + recovery,
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
    await page.evaluate(() => document.querySelector(".chapters-grid").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(2500);

    const stats = await page.evaluate(() =>
      [...document.querySelectorAll("[data-halftone]")].map((box) => ({
        hasCanvas: !!box.querySelector("canvas"),
        failed: box.classList.contains("halftone-failed"),
      })));
    t("8 halftone containers", stats.length === 8, "found " + stats.length);
    t("all canvases created", stats.every((s) => s.hasCanvas));
    t("no failed/ tainted loads", stats.every((s) => !s.failed));
    const ratios = await page.evaluate(() =>
      [...document.querySelectorAll("[data-halftone]")].map((box) => {
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
    t("all canvases painted", ratios.every((r) => r > 0.02), ratios.map((r) => r.toFixed(2)).join(","));
    t("zero console errors (desktop)", errors.length === 0, errors.slice(0, 2).join(";"));

    // hover lens moves dots
    const media = page.locator("[data-halftone]").first();
    await media.scrollIntoViewIfNeeded();
    const b1 = await media.boundingBox();
    const s1 = await paintedRatio(page, "[data-halftone]:nth-of-type(1)");
    await page.mouse.move(b1.x + 40, b1.y + b1.height / 2);
    await page.mouse.move(b1.x + b1.width - 40, b1.y + b1.height / 2, { steps: 10 });
    await page.waitForTimeout(500);
    t("hover lens changes rendering", s1 > 0 && (await page.evaluate(() => {
      const c = document.querySelector("[data-halftone] canvas");
      const p = document.createElement("canvas");
      p.width = 40; p.height = 20;
      const x = p.getContext("2d");
      x.drawImage(c, 0, 0, 40, 20);
      return x.getImageData(0, 0, 40, 20).data.some((v, i) => i % 4 === 3 && v > 8);
    })));

    // burst on 7 quick presses, then dots restore
    const media2 = page.locator("[data-halftone]").nth(1);
    await media2.scrollIntoViewIfNeeded();
    const b2 = await media2.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    let burstSeen = false;
    for (let i = 0; i < 7 && !burstSeen; i += 1) {
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(90);
      burstSeen = await page.evaluate(() => !!document.querySelector(".hf-burst"));
    }
    t("7 presses trigger burst layer", burstSeen);
    await page.waitForTimeout(4500);
    const restored = await page.evaluate(() => {
      const box = document.querySelectorAll("[data-halftone]")[1];
      const c = box.querySelector("canvas");
      const p = document.createElement("canvas");
      p.width = 40; p.height = 20;
      const x = p.getContext("2d");
      x.drawImage(c, 0, 0, 40, 20);
      const d = x.getImageData(0, 0, 40, 20).data;
      let painted = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted += 1;
      return painted / (40 * 20);
    });
    t("dots restored after burst", restored > 0.02, "painted " + restored.toFixed(2));

    await page.locator(".chapters-grid").screenshot({ path: path.join(SHOTS, "halftone-desktop.png") });
    await page.close();

    // mobile
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const merr = [];
    mob.on("pageerror", (e) => merr.push(e.message));
    mob.on("console", (m) => { if (m.type() === "error") merr.push(m.text()); });
    await mob.goto(BASE, { waitUntil: "load" });
    await mob.evaluate(() => document.querySelector(".chapters-grid").scrollIntoView({ block: "center" }));
    await mob.waitForTimeout(2200);
    const mobOk = await mob.evaluate(() => {
      const boxes = [...document.querySelectorAll("[data-halftone]")];
      const grid = document.querySelector(".chapters-grid");
      const overflowing = [...grid.querySelectorAll(".chapter")].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > innerWidth + 1;
      });
      return {
        canvases: boxes.filter((b) => b.querySelector("canvas")).length,
        overflowing: overflowing.length,
      };
    });
    t("mobile: 8 canvases render", mobOk.canvases === 8, "found " + mobOk.canvases);
    t("mobile: no card overflow", mobOk.overflowing === 0);
    t("mobile: zero console errors", merr.length === 0, merr.slice(0, 2).join(";"));
    await mob.locator(".chapters-grid").screenshot({ path: path.join(SHOTS, "halftone-mobile.png") });
    await mob.close();

    // reduced motion: static render, no animation loop
    const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await rm.goto(BASE, { waitUntil: "load" });
    await rm.evaluate(() => document.querySelector(".chapters-grid").scrollIntoView({ block: "center" }));
    await rm.waitForTimeout(1500);
    const rmPainted = await paintedRatio(rm, "[data-halftone]");
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
