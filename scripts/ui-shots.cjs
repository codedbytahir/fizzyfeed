#!/usr/bin/env node
/**
 * ui-shots.cjs — full-page captures of every client screen against the BUILT
 * SPA (app/dist/client), with /api/* mocked from shared/types shapes.
 *
 * Usage:
 *   node scripts/ui-shots.cjs <out-dir> [--mobile-extra]
 *
 * Demo fixtures only (local design verification, never shipped): numbers are
 * invented here so screens render fully; they must never be copied into the
 * product or docs (AGENTS.md §1.5 honesty law).
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "app", "dist", "client");
const OUT = process.argv[2] || path.join(ROOT, ".hallmark", "shots");
const PORT = 8931;

// ── deterministic demo year (365 daily slots) ───────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const daily = (() => {
  const rnd = mulberry32(20261101);
  const out = [];
  for (let i = 0; i < 365; i++) {
    const season = 0.55 + 0.45 * Math.sin((i / 365) * Math.PI * 2 - 1.1);
    const v = Math.max(0, Math.round(season * (0.4 + rnd() * 2.6)));
    out.push({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      count: v,
    });
  }
  return out;
})();
const sum = (a) => a.reduce((x, y) => x + y, 0);
const totalPosts = sum(daily.map((d) => d.count));

const CHANNELS = [
  { id: "ch_tw_1", service: "twitter", serviceId: "tw-1", name: "@tahir_builds", avatarUrl: "" },
  { id: "ch_li_1", service: "linkedin", serviceId: "li-1", name: "Tahir Rasool", avatarUrl: "" },
  { id: "ch_ig_1", service: "instagram", serviceId: "ig-1", name: "@tahir.makes", avatarUrl: "" },
];

const STATS = {
  year: 2026,
  totals: { posts: totalPosts, words: totalPosts * 61, channels: 3, activeDays: daily.filter((d) => d.count > 0).length },
  firstPost: { at: Date.UTC(2026, 0, 3, 9, 14) / 1000, excerpt: "new year, new repo: shipping the thing I sketched on the train", channel: "twitter" },
  rhythm: { bestDow: 2, favoriteHour: 9, postsPerWeek: Math.round(totalPosts / 52), dowHistogram: [12, 40, 61, 55, 48, 30, 18], hourHistogram: daily.slice(0, 24).map((d) => d.count * 3) },
  streaks: { longest: 41, longestStart: Date.UTC(2026, 2, 8) / 1000, busiestWeek: Date.UTC(2026, 8, 7) / 1000, busiestWeekPosts: 29 },
  mix: { channels: [ { service: "twitter", count: Math.round(totalPosts * 0.54), pct: 54 }, { service: "linkedin", count: Math.round(totalPosts * 0.31), pct: 31 }, { service: "instagram", count: Math.round(totalPosts * 0.15), pct: 15 } ], topTopics: ["ship logs", "parsers", "dev tools", "type safety", "css"] },
  peaks: { bestMonth: 8, bestMonthPosts: 96, bestWeekPosts: 29, monthly: [22, 30, 45, 38, 41, 52, 47, 58, 96, 71, 44, 39] },
  daily,
};

const DECK = {
  year: 2026,
  stats: STATS,
  persona: { name: "the midnight compiler", origin: "41-day streak, 62% of posts after 22:00 UTC — the wall sees a night owl who ships.", traits: ["ships at night", "streak keeper", "verbose in code"] },
  cards: [
    { n: 1, kind: "kickoff", date: "january 3, 2026", excerpt: "new year, new repo: shipping the thing I sketched on the train", gradient: "bolt" },
    { n: 2, kind: "rhythm", bestDow: "wednesday", favoriteHour: "09:00 UTC", postsPerWeek: 8, spark: [3, 9, 6, 11, 8, 12, 5, 9, 14, 7, 10, 6], gradient: "aurora" },
    { n: 3, kind: "streaks", longest: 41, busiestWeekPosts: 29, gradient: "fizz" },
    { n: 4, kind: "mix", channels: [ { service: "twitter", pct: 54 }, { service: "linkedin", pct: 31 }, { service: "instagram", pct: 15 } ], topTopics: ["ship logs", "parsers", "dev tools"], gradient: "grape" },
    { n: 5, kind: "peaks", bestMonth: "september", bestMonthPosts: 96, gradient: "sunset" },
    { n: 6, kind: "persona", name: "the midnight compiler", origin: "41-day streak, 62% of posts after 22:00 UTC — the wall sees a night owl who ships.", gradient: "nebula" },
    { n: 7, kind: "recap", totals: STATS.totals, gradient: "coral" },
  ],
};

const RECAP_PREVIEW = {
  text: "my year in posts: 1,024 posts across 3 channels, a 41-day streak, and 96 posts in september alone. the year, honestly drawn.",
  channels: CHANNELS,
  needsWriteScope: false,
  personaUsed: true,
};

const HITS = [
  { postId: "p1", excerpt: "the parser post that started the whole rewrite: 41 comments in, still wrong, still shipping", channel: "twitter", metric: { name: "impressions", value: 48213 } },
  { postId: "p2", excerpt: "shipped the thing I sketched on the train in january. six months later it pays for the train", channel: "linkedin", metric: { name: "impressions", value: 36890 } },
  { postId: "p3", excerpt: "css taught me patience; typescript taught me humility. a year of both", channel: "twitter", metric: { name: "impressions", value: 29105 } },
  { postId: "p4", excerpt: "open sourcing the deck renderer: same gradients on the web and in the PNG, finally", channel: "github" , metric: { name: "stars", value: 1842 } },
  { postId: "p5", excerpt: "the streak note: 41 days in a row, one post a day, what it actually took", channel: "instagram", metric: { name: "likes", value: 1503 } },
  { postId: "p6", excerpt: "d1 migrations at the edge: zero-downtime and one very long night", channel: "linkedin", metric: { name: "impressions", value: 12760 } },
  { postId: "p7", excerpt: "hot take: your feed should read like a ledger, not a billboard", channel: "twitter", metric: { name: "impressions", value: 11088 } },
  { postId: "p8", excerpt: "the recap experiment: one post, every channel, zero rewrites", channel: "twitter", metric: { name: "impressions", value: 9841 } },
  { postId: "p9", excerpt: "month nine: 96 posts, one very tired keyboard, all real numbers", channel: "instagram", metric: { name: "likes", value: 872 } },
];

// ── static server (SPA fallback) ────────────────────────────────────────────
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json" };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
      if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      fs.createReadStream(path.join(DIST, "index.html")).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

// ── api mocks ───────────────────────────────────────────────────────────────
function apiMock(mode) {
  // mode: "anon" | "authed" | "backfilling" | "hits-gate"
  return (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const err = (status, code, message) => json({ error: { code, message } }, status);

    if (p === "/api/auth/me") {
      if (mode === "anon") return err(401, "http_401", "no session — connect buffer first.");
      return json({
        id: "usr_demo", displayName: "Tahir", channels: CHANNELS, connected: true, backfillDone: mode !== "backfilling",
      });
    }
    if (p === "/api/deck") {
      if (mode === "anon") return err(401, "http_401", "no session.");
      if (mode === "backfilling") return err(503, "backfill_running", "the year is still indexing.");
      return json(DECK);
    }
    if (p === "/api/yearize/status") {
      return json({ backfillDone: mode !== "backfilling", lastPolledAt: Date.now() / 1000, postsIndexed: 842 });
    }
    if (p === "/api/recap/preview") return json(RECAP_PREVIEW);
    if (p === "/api/share-link/status") return json({ enabled: true, shareId: "demo", url: `https://fizzyfeed.app/u/dem0share` });
    if (p === "/api/greatest-hits/status") {
      if (mode === "hits-gate") return json({ enabled: false });
      return json({ enabled: true, since: Date.UTC(2026, 9, 12) / 1000 });
    }
    if (p === "/api/greatest-hits/refresh" && req.method() === "POST") return json({ top: HITS });
    return json({ error: { code: "not_found", message: "no such api route (mock)" } }, 404);
  };
}

// ── capture list ────────────────────────────────────────────────────────────
const SHOTS = [
  { name: "connect-desktop", url: "/", mode: "anon", vp: { width: 1280, height: 800 } },
  { name: "connect-mobile", url: "/", mode: "anon", vp: { width: 390, height: 844 } },
  { name: "deck-desktop", url: "/app", mode: "authed", vp: { width: 1280, height: 800 } },
  { name: "deck-mobile", url: "/app", mode: "authed", vp: { width: 390, height: 844 } },
  { name: "deck-loading-desktop", url: "/app", mode: "backfilling", vp: { width: 1280, height: 800 } },
  { name: "persona-desktop", url: "/app/persona", mode: "authed", vp: { width: 1280, height: 800 } },
  { name: "recap-desktop", url: "/app/recap", mode: "authed", vp: { width: 1280, height: 800 } },
  { name: "hits-gate-desktop", url: "/app/greatest-hits", mode: "hits-gate", vp: { width: 1280, height: 800 } },
  { name: "hits-desktop", url: "/app/greatest-hits", mode: "authed", vp: { width: 1280, height: 800 }, click: "text=pull top posts" },
  { name: "notfound-desktop", url: "/nope", mode: "anon", vp: { width: 1280, height: 800 } },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await startServer();
  const browser = await chromium.launch();
  const overflow = [];
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({ viewport: shot.vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route("**/api/**", apiMock(shot.mode));
    await page.goto(`http://localhost:${PORT}${shot.url}`, { waitUntil: "networkidle" });
    if (shot.click) {
      await page.click(shot.click).catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(900); // entrances settle
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: true });
    const hscroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    if (hscroll) overflow.push(shot.name);
    await ctx.close();
    console.log(`shot ${shot.name}${hscroll ? "  !! horizontal scroll" : ""}`);
  }
  await browser.close();
  srv.close();
  if (overflow.length) console.log(`HORIZONTAL SCROLL: ${overflow.join(", ")}`);
  console.log(`done → ${OUT}`);
})();
