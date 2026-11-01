#!/usr/bin/env node
/* live-shot.cjs — capture a production URL for post-deploy verification. */
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
(async () => {
  const url = process.argv[2];
  const out = process.argv[3];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: false });
  const hscroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  console.log(`captured ${url} -> ${out}${hscroll ? " !! HORIZONTAL SCROLL" : " (no h-scroll)"}`);
  await browser.close();
})();
