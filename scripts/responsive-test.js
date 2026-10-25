// responsive-test.js — screenshot landing sections at phone/tablet/desktop viewports
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "..");
const PAGE = path.join(REPO, "landing", "index.html");
const OUT = path.join(__dirname, "_responsive");
const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
];
const SECTIONS = [null, "#how", "#chapters", "#persona", "#cta"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto("file://" + PAGE, { waitUntil: "load", timeout: 45000 });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(2200);
    for (const sel of SECTIONS) {
      if (sel) {
        await p.evaluate((s) => {
          const el = document.querySelector(s);
          if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
        }, sel);
      }
      await p.waitForTimeout(1800);
      const name = sel ? sel.slice(1) : "hero";
      await p.screenshot({ path: path.join(OUT, `${v.name}-${name}.png`) });
      // report overflow
      const overflow = await p.evaluate(() => {
        const bad = [];
        const vw = document.documentElement.clientWidth;
        document.querySelectorAll("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 2 || r.left < -2)) {
            const c = el.className && typeof el.className === "string" ? el.className.split(" ")[0] : el.tagName;
            if (!/glow|noise/i.test(c)) bad.push(`${c}(${Math.round(r.left)}..${Math.round(r.right)})`);
          }
        });
        return [...new Set(bad)].slice(0, 8);
      });
      console.log(`${v.name} ${name}: overflow=${overflow.length ? overflow.join(" ") : "none"}`);
    }
    // full page height report
    const h = await p.evaluate(() => document.body.scrollHeight);
    console.log(`${v.name}: pageHeight=${h}`);
    await ctx.close();
  }
  await browser.close();
  console.log("done ->", OUT);
})();
