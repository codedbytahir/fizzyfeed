/**
 * Opt-in public share pages (feature 6): /u/{shareId} + public OG/card PNGs,
 * plus the private /api/share-link management router.
 *
 *   default export — private router (mounted at /api/share-link by index.ts):
 *     GET  /status → ShareStatus for the session user
 *     POST /toggle { enabled: boolean } — enable/disable; rev++ on every change
 *     POST /rotate — new share_id (old URL orphaned), enabled unchanged
 *
 *   sharePublic — public router (mounted at /u):
 *     GET /:shareId            → branded HTML (aggregates + card images only)
 *     GET /:shareId/og.png     → 1200×630 OG PNG (KV: pub:{id}:og:{rev}:{hash8})
 *     GET /:shareId/card/:slug → story card PNG  (KV: pub:{id}:card{n}:{rev})
 *
 * Privacy: the page is excerpt-free — no post text, no topics, no persona
 * copy; aggregates + card images only. One link per user: disable keeps
 * share_id (toggle-back restores the same URL), rotate orphans the old id.
 * rev is bumped on every mutation so the public PNG KV cache self-invalidates.
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { BRAND_NAME } from "../../shared/brand";
import type { ShareLinkRow } from "../../shared/schema";
import type { CardData, ShareStatus, YearStats } from "../../shared/types";
import { randomToken } from "../lib/crypto";
import { hash8, loadFonts } from "../lib/fonts";
import { jsonError } from "../lib/http";
import { renderOgPng } from "../lib/render";
import { readSessionUserId } from "../lib/session";
import { getCardPng } from "./cards";
import { buildDeck } from "./deck";

// ── brand palette for the inline page CSS ────────────────────────────────────
//
// The share page ships zero external CSS (it must render anywhere the link is
// pasted), so the palette is re-declared from tokens.css into the template's
// custom properties. Same documented exception as lib/gradients.ts
// (AGENTS.md §1.3): every hex literal carries its token provenance comment.

const TOKEN_INK_950 = "#05070E"; /* token: ink-950 */
const TOKEN_INK_800 = "#131A2B"; /* token: ink-800 */
const TOKEN_INK_700 = "#1F2940"; /* token: ink-700 */
const TOKEN_ELECTRIC_500 = "#0A5CFF"; /* token: electric-500 */
const TOKEN_VOLT_500 = "#00D5FF"; /* token: volt-500 */
const TOKEN_VIOLET_500 = "#6333FF"; /* token: violet-500 */

const PAGE_CSS = `
:root {
  --ink-950: ${TOKEN_INK_950};
  --ink-800: ${TOKEN_INK_800};
  --ink-700: ${TOKEN_INK_700};
  --electric-500: ${TOKEN_ELECTRIC_500};
  --volt-500: ${TOKEN_VOLT_500};
  --violet-500: ${TOKEN_VIOLET_500};
  --text-hi: rgba(255,255,255,0.92);
  --text-body: rgba(255,255,255,0.85);
  --text-dim: rgba(255,255,255,0.7);
  --grad-brand: linear-gradient(135deg, var(--violet-500) 0%, var(--electric-500) 45%, var(--volt-500) 100%);
}
* { box-sizing: border-box; }
html { background: var(--ink-950); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--ink-950);
  color: var(--text-body);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
@font-face {
  font-family: "Space Grotesk";
  src: url("/fonts/space-grotesk-latin-700-normal.woff") format("woff");
  font-weight: 700; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-latin-400-normal.woff") format("woff");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-latin-600-normal.woff") format("woff");
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/jetbrains-mono-latin-500-normal.woff") format("woff");
  font-weight: 500; font-style: normal; font-display: swap;
}
.page { max-width: 960px; margin: 0 auto; padding: 56px 24px 80px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
.dot { width: 12px; height: 12px; border-radius: 999px; flex: none; background: var(--grad-brand); }
.brand {
  font-family: "Space Grotesk", "Inter", system-ui, sans-serif;
  font-weight: 700; font-size: 18px; letter-spacing: -0.01em; color: var(--text-hi);
}
h1 {
  margin: 0;
  font-family: "Space Grotesk", "Inter", system-ui, sans-serif;
  font-weight: 700;
  font-size: clamp(2.375rem, 6vw, 4.75rem);
  line-height: 1.04;
  letter-spacing: -0.03em;
  color: var(--text-hi);
}
.lede { max-width: 34em; margin: 20px 0 0; font-size: 17px; line-height: 1.6; }
.stats {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  margin: 40px 0 56px;
}
.stat { background: var(--ink-800); border: 1px solid var(--ink-700); border-radius: 22px; padding: 18px 20px; }
.stat .v {
  font-family: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
  font-weight: 500; font-size: 26px; font-variant-numeric: tabular-nums; color: var(--text-hi);
}
.stat .l { margin-top: 6px; font-size: 13px; color: var(--text-dim); }
.cards { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.cards img { display: block; width: 100%; height: auto; border-radius: 28px; background: var(--ink-800); }
.cta-row { margin: 56px 0 0; }
.cta {
  display: inline-block;
  padding: 14px 28px;
  border-radius: 999px;
  background: var(--grad-brand);
  color: var(--ink-950);
  font-weight: 600; font-size: 15px; text-decoration: none;
}
.cta:hover, .cta:focus-visible { filter: brightness(1.08); }
@media (prefers-reduced-motion: no-preference) {
  .cards img { transition: transform 160ms ease; }
  .cards img:hover { transform: translateY(-4px); }
}
`;

// ── html helpers ─────────────────────────────────────────────────────────────

/** Escape dynamic text for both element content and quoted attributes. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tabular-friendly number: integers grouped, floats at one decimal. */
function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function dowName(i: number): string {
  return DOW_NAMES[i] ?? "day";
}

/** The honest aggregate line shared by og:description and the OG PNG. */
function statLine(totals: YearStats["totals"]): string {
  return `${totals.posts} posts · ${totals.words} words · ${totals.channels} channels`;
}

const OG_TITLE = "your year in posts";

function brandHead(): string {
  return `<header class="head"><span class="dot" aria-hidden="true"></span><span class="brand">${BRAND_NAME}</span></header>`;
}

function ctaParagraph(origin: string): string {
  return `<p class="cta-row"><a class="cta" href="${esc(origin)}">build yours</a></p>`;
}

function shell(title: string, meta: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta}
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page">
${body}
</main>
</body>
</html>`;
}

function notFoundPage(origin: string, message: string): Response {
  const html = shell(
    `${BRAND_NAME} — nothing here`,
    "",
    `${brandHead()}
<h1>nothing here.</h1>
<p class="lede">${esc(message)}</p>
${ctaParagraph(origin)}`
  );
  return new Response(html, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Branded 500 for the public surface — /api has app.onError, /u needs its own. */
function errorPage(origin: string): Response {
  const html = shell(
    `${BRAND_NAME} — something broke`,
    "",
    `${brandHead()}\n<h1>something broke on our side.</h1>\n<p class="lede">try again in a moment — nothing you did caused this.</p>\n${ctaParagraph(origin)}`
  );
  return new Response(html, {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function sharePageHtml(opts: { origin: string; shareId: string; stats: YearStats; cards: CardData[] }): string {
  const { origin, shareId, stats, cards } = opts;
  const line = statLine(stats.totals);
  const ogImageUrl = `${origin}/u/${shareId}/og.png`;
  const meta = `
<meta name="description" content="${esc(line)}">
<meta property="og:title" content="${OG_TITLE}">
<meta property="og:description" content="${esc(line)}">
<meta property="og:image" content="${esc(ogImageUrl)}">
<meta name="twitter:card" content="summary_large_image">`;
  const statCells: [string, string][] = [
    [fmtNum(stats.totals.posts), "posts"],
    [fmtNum(stats.totals.words), "words"],
    [fmtNum(stats.totals.channels), "channels"],
    [fmtNum(stats.totals.activeDays), "active days"],
    [dowName(stats.rhythm.bestDow), "best day"],
    [fmtNum(stats.rhythm.postsPerWeek), "posts per week"],
    [fmtNum(stats.streaks.longest), "days in a row"],
  ];
  const statHtml = statCells
    .map(([value, label]) => `<div class="stat"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`)
    .join("");
  // excerpt-free by construction: card images + aggregates are all that ship
  const cardImgs = cards
    .map((card) => `<img loading="lazy" src="/u/${esc(shareId)}/card/${card.n}.png" alt="${esc(card.kind)} card">`)
    .join("");
  return shell(
    `${BRAND_NAME} — ${OG_TITLE}`,
    meta,
    `${brandHead()}
<h1>your year in posts.</h1>
<section class="stats" aria-label="year totals">${statHtml}</section>
<section class="cards" aria-label="the deck">${cardImgs}</section>
${ctaParagraph(origin)}`
  );
}

// ── row + status helpers ─────────────────────────────────────────────────────

async function getRowByUser(env: Env, userId: string): Promise<ShareLinkRow | null> {
  return env.DB.prepare(
    "SELECT user_id, share_id, enabled, rev, created_at FROM share_links WHERE user_id = ?"
  )
    .bind(userId)
    .first<ShareLinkRow>();
}

async function getRowByShareId(env: Env, shareId: string): Promise<ShareLinkRow | null> {
  return env.DB.prepare(
    "SELECT user_id, share_id, enabled, rev, created_at FROM share_links WHERE share_id = ?"
  )
    .bind(shareId)
    .first<ShareLinkRow>();
}

function statusOf(env: Env, row: ShareLinkRow | null): ShareStatus {
  const enabled = row !== null && row.enabled === 1;
  const shareId = row?.share_id ?? null;
  return {
    enabled,
    shareId,
    url: enabled && shareId !== null ? `${env.APP_ORIGIN}/u/${shareId}` : null,
  };
}

const PNG_HEADERS: Record<string, string> = {
  "content-type": "image/png",
  "cache-control": "public, max-age=3600",
};

function pngResponse(body: ArrayBuffer | Uint8Array): Response {
  return new Response(body, { headers: PNG_HEADERS });
}

const PNG_TTL_SEC = 7 * 86400; // 7d — rev/hash8 in the key invalidates sooner

// ── private management router (default export; mounted at /api/share-link) ───

const shareLink = new Hono<HonoEnv>();

shareLink.get("/status", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) {
    return jsonError(c, 401, "no_session", "sign in with buffer first");
  }
  const row = await getRowByUser(c.env, userId);
  return c.json(statusOf(c.env, row));
});

shareLink.post("/toggle", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) {
    return jsonError(c, 401, "no_session", "sign in with buffer first");
  }
  let raw: unknown = null;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }
  const enabled =
    typeof raw === "object" && raw !== null ? (raw as { enabled?: unknown }).enabled : undefined;
  if (typeof enabled !== "boolean") {
    return jsonError(c, 400, "bad_request", "send a json body with a boolean enabled field");
  }
  const row = await getRowByUser(c.env, userId);
  if (enabled) {
    if (row) {
      await c.env.DB.prepare("UPDATE share_links SET enabled = 1, rev = rev + 1 WHERE user_id = ?")
        .bind(userId)
        .run();
    } else {
      const shareId = randomToken(32);
      await c.env.DB.prepare(
        "INSERT INTO share_links (user_id, share_id, enabled, rev, created_at) VALUES (?, ?, 1, 1, ?)"
      )
        .bind(userId, shareId, Math.floor(Date.now() / 1000))
        .run();
    }
  } else if (row) {
    // share_id is kept on purpose: toggle-back restores the same URL
    await c.env.DB.prepare("UPDATE share_links SET enabled = 0, rev = rev + 1 WHERE user_id = ?")
      .bind(userId)
      .run();
  }
  const after = await getRowByUser(c.env, userId);
  return c.json(statusOf(c.env, after));
});

shareLink.post("/rotate", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) {
    return jsonError(c, 401, "no_session", "sign in with buffer first");
  }
  const row = await getRowByUser(c.env, userId);
  const shareId = randomToken(32);
  if (row) {
    await c.env.DB.prepare("UPDATE share_links SET share_id = ?, rev = rev + 1 WHERE user_id = ?")
      .bind(shareId, userId)
      .run();
    // audit: user id + event only — the share ids themselves never reach logs
    // (they are capability URLs; writing them down widens the leak surface)
    console.log(`share link rotated: user=${userId}`);
  } else {
    // rotating before the first enable just reserves an id (still disabled)
    await c.env.DB.prepare(
      "INSERT INTO share_links (user_id, share_id, enabled, rev, created_at) VALUES (?, ?, 0, 1, ?)"
    )
      .bind(userId, shareId, Math.floor(Date.now() / 1000))
      .run();
  }
  const after = await getRowByUser(c.env, userId);
  return c.json(statusOf(c.env, after));
});

export default shareLink;

// ── public router (mounted at /u) ────────────────────────────────────────────

export const sharePublic = new Hono<HonoEnv>();

// the public surface has no session, so failures must stay branded + no-store
// (an unhandled D1/KV error here would otherwise leak a bare worker 500 page)
sharePublic.onError((err, c) => {
  console.error(`public share error: ${c.req.method} ${c.req.path} :: ${err.message}`);
  return errorPage(c.env.APP_ORIGIN);
});

sharePublic.get("/:shareId", async (c) => {
  const origin = c.env.APP_ORIGIN;
  const shareId = c.req.param("shareId") ?? "";
  const row = await getRowByShareId(c.env, shareId);
  if (!row || row.enabled !== 1) {
    return notFoundPage(origin, "this share link is off or doesn't exist");
  }
  const { deck } = await buildDeck(c.env, row.user_id, new Date().getUTCFullYear());
  if (deck.stats.totals.posts === 0) {
    return notFoundPage(origin, "this link has nothing to share yet");
  }
  c.header("Cache-Control", "public, max-age=60");
  return c.html(
    sharePageHtml({
      origin,
      shareId: row.share_id,
      stats: deck.stats,
      cards: deck.cards,
    })
  );
});

sharePublic.get("/:shareId/og.png", async (c) => {
  const origin = c.env.APP_ORIGIN;
  const shareId = c.req.param("shareId") ?? "";
  const row = await getRowByShareId(c.env, shareId);
  if (!row || row.enabled !== 1) {
    return notFoundPage(origin, "this share link is off or doesn't exist");
  }
  const { deck } = await buildDeck(c.env, row.user_id, new Date().getUTCFullYear());
  if (deck.stats.totals.posts === 0) {
    return notFoundPage(origin, "this link has nothing to share yet");
  }
  const line = statLine(deck.stats.totals);
  const cacheKey = `pub:${shareId}:og:${row.rev}:${hash8(line)}`;
  const cached = await c.env.CACHE.get(cacheKey, "arrayBuffer");
  if (cached) return pngResponse(cached);
  const fonts = await loadFonts(c.env.ASSETS);
  const png = await renderOgPng({ title: OG_TITLE, statLine: line }, fonts);
  await c.env.CACHE.put(cacheKey, png, { expirationTtl: PNG_TTL_SEC });
  return pngResponse(png);
});

sharePublic.get("/:shareId/card/:slug", async (c) => {
  const origin = c.env.APP_ORIGIN;
  const shareId = c.req.param("shareId") ?? "";
  const row = await getRowByShareId(c.env, shareId);
  if (!row || row.enabled !== 1) {
    return notFoundPage(origin, "this share link is off or doesn't exist");
  }
  const match = /^([1-7])\.png$/.exec(c.req.param("slug") ?? "");
  if (!match) {
    return notFoundPage(origin, "unknown card");
  }
  const n = Number(match[1]);
  const cacheKey = `pub:${shareId}:card${n}:${row.rev}`;
  const cached = await c.env.CACHE.get(cacheKey, "arrayBuffer");
  if (cached) return pngResponse(cached);
  // empty account → nothing to share (same gate as the page route)
  const { deck } = await buildDeck(c.env, row.user_id, new Date().getUTCFullYear());
  if (deck.stats.totals.posts === 0) {
    return notFoundPage(origin, "this link has nothing to share yet");
  }
  const png = await getCardPng(c.env, row.user_id, n);
  if (!png) {
    return notFoundPage(origin, "this card isn't in the deck yet");
  }
  await c.env.CACHE.put(cacheKey, png, { expirationTtl: PNG_TTL_SEC });
  return pngResponse(png);
});
