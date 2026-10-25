// critic-shots.js — captures the review set for the design critic agent.
// Serves landing/ over http (animations + canvas need real loads) and screenshots
// the page at desktop + mobile into landing/_critic/. Read-only for the page itself.
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..", "landing");
const OUT = path.join(ROOT, "_critic");
fs.mkdirSync(OUT, { recursive: true });

const mime = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".txt": "text/plain", ".xml": "application/xml",
  ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon",
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/\/+$/, "/index.html");
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(rel)] || "application/octet-stream" });
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();

  const shoot = async (page, sel, file, settle) => {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.scrollIntoView({ block: "center" });
    }, sel);
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT, file) });
    console.log("shot", file);
  };

  // desktop
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, "01-hero.png") });
  console.log("shot 01-hero.png");
  await shoot(page, "#how", "02-how.png", 2000);
  await shoot(page, "#chapters", "03-chapters-fan.png", 2900);
  await shoot(page, "#persona", "04-persona.png", 2200);
  await shoot(page, "#cta", "05-cta.png", 2200);
  await shoot(page, "footer", "06-footer.png", 1600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "07-full.png"), fullPage: true });
  console.log("shot 07-full.png");
  await page.close();

  // mobile
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mob.goto(BASE, { waitUntil: "load" });
  await mob.waitForTimeout(2200);
  await mob.screenshot({ path: path.join(OUT, "08-mobile-hero.png") });
  console.log("shot 08-mobile-hero.png");
  await shoot(mob, "#chapters", "09-mobile-chapters.png", 2600);
  await shoot(mob, "#cta", "10-mobile-cta.png", 2200);
  await mob.close();

  await browser.close();
  server.close();
  console.log("done ->", OUT);
})();
