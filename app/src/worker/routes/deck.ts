/**
 * Deck assembly + GET /api/deck (spec 04 §1, spec 01 §5).
 *
 * Cards 1–5 and 7 come from YearStats alone; card 6 (alter ego) is injected
 * only when a persona row exists in ai_cache (agent 5-a writes that row — this
 * module only reads it). Empty account → single friendly state card.
 * buildDeck() is shared with routes/cards.ts so PNG slugs and the JSON deck
 * can never disagree.
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { readSessionUserId } from "../lib/session";
import { jsonError } from "../lib/http";
import { computeYearStats } from "../lib/yearize";
import type { CardData, Deck, Persona, YearStats } from "../../shared/types";
import type { PostRow } from "../../shared/schema";

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function monthName(i: number): string {
  return MONTH_NAMES[i] ?? "month";
}

function dowName(i: number): string {
  return DOW_NAMES[i] ?? "day";
}

/** 0→"12am", 12→"12pm", 13→"1pm", 23→"11pm" (deck copy convention). */
export function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function clamp(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function firstPostDate(at: number): string {
  const d = new Date(at * 1000);
  return `${monthName(d.getUTCMonth())} ${d.getUTCDate()}`;
}

const EMPTY_STATE_COPY = "not enough year yet — connect your buffer and post a little more";

/** The single "not enough year yet" card (bolt gradient, spec 04 §1). */
export function emptyDeckCard(): CardData {
  return { n: 1, kind: "kickoff", date: "", excerpt: EMPTY_STATE_COPY, gradient: "bolt" };
}

/**
 * Pure deck assembly: YearStats (+ optional persona) → CardData[], per spec 04
 * §1. Persona card (n=6) is inserted at index 5, before the recap (n=7).
 */
export function buildDeckFromStats(stats: YearStats, persona: Persona | null): CardData[] {
  if (stats.totals.posts === 0 || !stats.firstPost) {
    return [emptyDeckCard()];
  }
  const kickoff: CardData = {
    n: 1,
    kind: "kickoff",
    date: firstPostDate(stats.firstPost.at),
    excerpt: clamp(stats.firstPost.excerpt, 120),
    gradient: "bolt",
  };
  const rhythm: CardData = {
    n: 2,
    kind: "rhythm",
    bestDow: dowName(stats.rhythm.bestDow),
    favoriteHour: hourLabel(stats.rhythm.favoriteHour),
    postsPerWeek: stats.rhythm.postsPerWeek,
    spark: stats.rhythm.dowHistogram.slice(0, 7),
    gradient: "aurora",
  };
  const streaks: CardData = {
    n: 3,
    kind: "streaks",
    longest: stats.streaks.longest,
    busiestWeekPosts: stats.streaks.busiestWeekPosts,
    gradient: "fizz",
  };
  const mix: CardData = {
    n: 4,
    kind: "mix",
    channels: stats.mix.channels.map((ch) => ({ service: ch.service, pct: ch.pct })),
    topTopics: stats.mix.topTopics.slice(0, 5),
    gradient: "grape",
  };
  const peaks: CardData = {
    n: 5,
    kind: "peaks",
    bestMonth: monthName(stats.peaks.bestMonth),
    bestMonthPosts: stats.peaks.bestMonthPosts,
    gradient: "sunset",
  };
  const recap: CardData = {
    n: 7,
    kind: "recap",
    totals: stats.totals,
    gradient: "coral",
  };
  const cards: CardData[] = [kickoff, rhythm, streaks, mix, peaks, recap];
  if (persona) {
    cards.splice(5, 0, { n: 6, kind: "persona", name: persona.name, origin: persona.origin, gradient: "nebula" });
  }
  return cards;
}

function parsePersona(json: string): Persona | null {
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { name?: unknown; origin?: unknown; traits?: unknown };
    if (typeof p.name !== "string" || p.name.trim().length === 0) return null;
    if (typeof p.origin !== "string") return null;
    const traits = Array.isArray(p.traits)
      ? p.traits.filter((t): t is string => typeof t === "string").slice(0, 3)
      : [];
    return {
      name: p.name.trim().slice(0, 28),
      origin: p.origin.slice(0, 90),
      traits,
    };
  } catch {
    return null; // malformed cache row → deck simply renders without the persona
  }
}

async function loadPersona(env: Env, userId: string, year: number): Promise<Persona | null> {
  const row = await env.DB.prepare(
    "SELECT payload_json FROM ai_cache WHERE user_id = ? AND kind = 'persona' AND year = ?"
  )
    .bind(userId, year)
    .first<{ payload_json: string }>();
  if (!row) return null;
  return parsePersona(row.payload_json);
}

export interface DeckBundle {
  deck: Deck;
  persona: Persona | null;
}

/**
 * Shared loader for /api/deck and /api/cards: posts + persona cache → Deck.
 * Keeps the JSON deck and the PNG slugs on the exact same data — the PNG cache
 * keys hash `deck.stats`, so any aggregate change self-invalidates cards.
 */
export async function buildDeck(env: Env, userId: string, year: number): Promise<DeckBundle> {
  const posts = await env.DB.prepare(
    "SELECT * FROM posts WHERE user_id = ? AND year = ? ORDER BY created_at ASC"
  )
    .bind(userId, year)
    .all<PostRow>();
  const rows: PostRow[] = posts.results;
  const persona = await loadPersona(env, userId, year);
  const stats = computeYearStats(rows, year);
  const cards = buildDeckFromStats(stats, persona);
  const deck: Deck = {
    year,
    stats,
    cards,
    ...(persona ? { persona } : {}),
    ...(rows.length === 0 ? { empty: true as const } : {}),
  };
  return { deck, persona };
}

const deck = new Hono<HonoEnv>();

deck.get("/", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) {
    return jsonError(c, 401, "no_session", "sign in with buffer to open your deck");
  }
  const year = new Date().getUTCFullYear();
  const { deck: built } = await buildDeck(c.env, userId, year);
  c.header("Cache-Control", "private, max-age=60");
  return c.json(built);
});

export default deck;
