/**
 * PNG card endpoints (spec 04 §3): KV-cached satori renders.
 *
 *   GET /api/cards/og.png   — name-agnostic 1200×630 brand card (no session)
 *   GET /api/cards/:n.png   — story card 1..7, session required
 *
 * Cache keys: `card:og:v1` and `card:{userId}:{year}:card{n}-{hash8(stats)}` —
 * the stats fingerprint invalidates stale cards when aggregates change. Max 8
 * slugs per user-year by construction (7 cards + og). getCardPng is shared
 * with routes/share.ts so the queued card media is byte-identical to the PNG
 * the user previewed.
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { readSessionUserId } from "../lib/session";
import { jsonError } from "../lib/http";
import { loadFonts, hash8 } from "../lib/fonts";
import { renderCardPng, renderOgPng } from "../lib/render";
import { buildDeck } from "./deck";
import type { CardData, Persona, YearStats } from "../../shared/types";

const OG_CACHE_KEY = "card:og:v1";
const CARD_TTL_SEC = 30 * 86400; // 30d (spec 04 §2)

const PNG_HEADERS: Record<string, string> = {
  "content-type": "image/png",
  "cache-control": "public, max-age=3600",
};

export interface DeckContext {
  stats: YearStats;
  cards: CardData[];
  year: number;
  /** Persona row if the ai_cache has one — trait chips render from this. */
  persona: Persona | null;
}

/**
 * Same loader /api/deck uses (buildDeck → buildDeckFromStats), so a card PNG
 * can never disagree with the JSON deck it belongs to.
 */
export async function loadDeckContext(env: Env, userId: string): Promise<DeckContext> {
  const year = new Date().getUTCFullYear();
  const { deck, persona } = await buildDeck(env, userId, year);
  return { stats: deck.stats, cards: deck.cards, year, persona };
}

function pngResponse(body: ArrayBuffer | Uint8Array): Response {
  return new Response(body, { headers: PNG_HEADERS });
}

function findCard(cards: CardData[], n: number): CardData | undefined {
  return cards.find((card) => card.n === n);
}

/**
 * Render (or KV-serve) the story-card PNG for one user + card number.
 * Returns null when the card isn't in the user's deck (unknown n, or an
 * account that only has the empty-state card). Same loader and cache key as
 * GET /:slug — the PNG route and the card-share queue stay byte-identical.
 */
export async function getCardPng(env: Env, userId: string, n: number): Promise<Uint8Array | null> {
  const { stats, cards: deckCards, year, persona } = await loadDeckContext(env, userId);
  const card = findCard(deckCards, n);
  if (!card) return null;
  const cacheKey = `card:${userId}:${year}:card${n}-${hash8(JSON.stringify(stats))}`;
  const cached = await env.CACHE.get(cacheKey, "arrayBuffer");
  if (cached) return new Uint8Array(cached);
  const fonts = await loadFonts(env.ASSETS);
  const png = await renderCardPng(card, fonts, {
    monthly: stats.peaks.monthly,
    spark: stats.rhythm.dowHistogram,
    traits: persona?.traits,
  });
  await env.CACHE.put(cacheKey, png, { expirationTtl: CARD_TTL_SEC });
  return png;
}

const cards = new Hono<HonoEnv>();

cards.get("/og.png", async (c) => {
  const cached = await c.env.CACHE.get(OG_CACHE_KEY, "arrayBuffer");
  if (cached) return pngResponse(cached);
  const fonts = await loadFonts(c.env.ASSETS);
  const png = await renderOgPng(
    { title: "your year in posts", statLine: "7 cards · one alter ego · one queued recap" },
    fonts
  );
  await c.env.CACHE.put(OG_CACHE_KEY, png, { expirationTtl: 2592000 });
  return pngResponse(png);
});

cards.get("/:slug", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) {
    return jsonError(c, 401, "no_session", "sign in with buffer to open your deck");
  }
  const slug = c.req.param("slug") ?? "";
  const match = /^([1-7])\.png$/.exec(slug);
  if (!match) {
    return jsonError(c, 404, "not_found", "unknown card");
  }
  const n = Number(match[1] ?? 0);
  if (!Number.isInteger(n) || n < 1 || n > 7) {
    return jsonError(c, 404, "not_found", "unknown card");
  }
  const png = await getCardPng(c.env, userId, n);
  if (!png) {
    return jsonError(c, 404, "card_unavailable", "card not in your deck yet");
  }
  return pngResponse(png);
});

export default cards;
