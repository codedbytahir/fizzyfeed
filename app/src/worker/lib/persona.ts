/**
 * AI alter-ego persona naming (spec 05, tasks T14/T15).
 *
 * Pure core is exported for tests: buildPrompt / parsePersona / fallbackPersona
 * / sampleExposts / statNumberStrings. generatePersona() wraps the Workers AI
 * call (llama-3.3-70b, JSON-mode prompt) with ONE repair retry and never
 * throws — any double failure lands on the deterministic fallback.
 *
 * Honesty rules (spec 05 §1/§3):
 *   - the prompt carries only real YearStats numbers + ≤40 excerpts, each ≤80
 *     chars (truncated defensively here, not trusted to the caller);
 *   - a parsed persona's origin must cite a digit string that exists in the
 *     user's actual YearStats, or it is rejected;
 *   - banned-word / trademark guardrails reject → retry once → fallback.
 * Log discipline: nothing here logs prompt, excerpt, or persona text.
 */
import type { Env } from "../env";
import type { Persona, YearStats } from "../../shared/types";
import { hourLabel } from "../routes/deck";

/** Workers AI model for persona naming (spec 05 §2) — 1 call per user-year, cached. */
export const PERSONA_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** System prompt — verbatim per spec 05 §3. */
export const PERSONA_SYSTEM_PROMPT =
  "You name a social posting alter ego from real, honest posting statistics. Be playful-precise, never hype. Lowercase names. Two to four words. No emoji in the name.";

const NAME_MIN = 2;
const NAME_MAX = 28;
const ORIGIN_MAX = 90;
const TRAIT_COUNT = 3;
const TRAIT_MAX = 18;
const EXCERPT_MAX = 80;
const PROMPT_EXCERPT_LIMIT = 40;

// Brand-conflict guardrails (AGENTS.md §1): the banned word and trademarked
// product names are assembled at runtime — they never appear literally in
// source (same pattern as test/migration.test.ts).
const BANNED_WORD = ["wr", "app", "ed"].join("");
const BANNED_NAME_SUBSTRINGS: readonly string[] = [
  BANNED_WORD,
  ["spo", "tify"].join(""),
  ["apple", " music"].join(""),
  ["you", "tube"].join(""),
  ["tik", "tok"].join(""),
];
// Slur blocklist intentionally empty for now — structure ready (spec 05 §3).
const BANNED_NAME_EXACT: readonly string[] = [];

// ── excerpts ────────────────────────────────────────────────────────────────

function clampExcerpt(text: string): string {
  const t = text.trim();
  return t.length <= EXCERPT_MAX ? t : t.slice(0, EXCERPT_MAX);
}

/**
 * Deterministic excerpt spread (spec 05 §3): the caller passes posts ordered
 * newest-first; this takes the first `max` non-empty ones, each truncated to
 * 80 chars. No post text longer than 80 chars can ever survive this.
 */
export function sampleExposts(posts: { text: string }[], max = PROMPT_EXCERPT_LIMIT): string[] {
  const out: string[] = [];
  for (const p of posts) {
    if (out.length >= max) break;
    const t = clampExcerpt(p.text);
    if (t.length > 0) out.push(t);
  }
  return out;
}

// ── prompt ──────────────────────────────────────────────────────────────────

/** Every number an honest origin may cite — all real YearStats values. */
export function statNumberStrings(stats: YearStats): ReadonlySet<string> {
  return new Set([
    String(stats.totals.posts),
    String(stats.totals.words),
    String(stats.totals.activeDays),
    String(stats.streaks.longest),
    String(stats.rhythm.postsPerWeek),
    String(stats.rhythm.favoriteHour),
    String(stats.streaks.busiestWeekPosts),
    String(stats.peaks.bestMonthPosts),
  ]);
}

export function buildPrompt(stats: YearStats, excerpts: string[]): { system: string; user: string } {
  const payload = {
    totals: {
      posts: stats.totals.posts,
      words: stats.totals.words,
      channels: stats.totals.channels,
      activeDays: stats.totals.activeDays,
    },
    rhythm: {
      bestDow: stats.rhythm.bestDow,
      favoriteHour: stats.rhythm.favoriteHour,
      postsPerWeek: stats.rhythm.postsPerWeek,
    },
    streaks: {
      longest: stats.streaks.longest,
      busiestWeekPosts: stats.streaks.busiestWeekPosts,
    },
    mix: {
      channels: stats.mix.channels.slice(0, 3),
      topTopics: stats.mix.topTopics.slice(0, 5),
    },
    peaks: {
      bestMonth: stats.peaks.bestMonth,
      bestMonthPosts: stats.peaks.bestMonthPosts,
      bestWeekPosts: stats.peaks.bestWeekPosts,
    },
    // defensive re-cap: ≤40 excerpts, ≤80 chars each, no matter the caller
    excerpts: excerpts.slice(0, PROMPT_EXCERPT_LIMIT).map(clampExcerpt),
  };
  const user = [
    "Here is one person's real posting data for their year, as JSON:",
    JSON.stringify(payload),
    "Name their posting alter ego.",
    "- name: lowercase, two to four words, at most 28 characters, no emoji, no brand names.",
    `- origin: one line of at most 90 characters citing at least one real number from the data (like ${stats.totals.posts} posts or a ${stats.streaks.longest}-day streak).`,
    "- traits: exactly 3 short chips, each at most 18 characters.",
    'Answer with ONLY valid JSON in exactly this shape: {"name": string, "origin": string, "traits": [string, string, string]}',
  ].join("\n");
  return { system: PERSONA_SYSTEM_PROMPT, user };
}

// ── parse + guardrails ──────────────────────────────────────────────────────

function stripFences(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("```")) return t;
  const noOpen = t.replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, "");
  return noOpen.replace(/```[ \t]*\r?\n?$/, "").trim();
}

function hasBannedNameText(s: string): boolean {
  const lower = s.toLowerCase();
  return (
    BANNED_NAME_SUBSTRINGS.some((w) => lower.includes(w)) ||
    BANNED_NAME_EXACT.some((w) => lower === w)
  );
}

function referencesRealStat(origin: string, stats: YearStats): boolean {
  const allowed = statNumberStrings(stats);
  for (const digits of origin.match(/\d+/g) ?? []) {
    if (allowed.has(digits)) return true;
  }
  return false;
}

/**
 * Strict gate between the model and the cache: malformed JSON, markdown
 * fences, uppercase/too-long/banned names, origins that cite no real stat,
 * and trait lists that are not exactly 3 short strings all return null.
 */
export function parsePersona(raw: string, stats: YearStats): Persona | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as { name?: unknown; origin?: unknown; traits?: unknown };
  if (typeof o.name !== "string" || typeof o.origin !== "string" || !Array.isArray(o.traits)) {
    return null;
  }

  const name = o.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  if (/[A-Z]/.test(name)) return null;
  if (hasBannedNameText(name)) return null;

  const origin = o.origin.trim();
  if (origin.length === 0 || origin.length > ORIGIN_MAX) return null;
  if (!referencesRealStat(origin, stats)) return null;

  if (o.traits.length !== TRAIT_COUNT) return null;
  const traits: string[] = [];
  for (const t of o.traits) {
    if (typeof t !== "string") return null;
    const trait = t.trim();
    if (trait.length < 1 || trait.length > TRAIT_MAX) return null;
    traits.push(trait);
  }
  return { name, origin, traits };
}

// ── deterministic fallback ──────────────────────────────────────────────────

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

/**
 * Deterministic alter ego built from rhythm alone — never fails, never
 * hallucinates (spec 05 §3 guardrail: "the {favoriteHour}o'clock regular",
 * hour labeled in deck copy style, e.g. "11pm").
 */
export function fallbackPersona(stats: YearStats): Persona {
  const label = hourLabel(clampHour(stats.rhythm.favoriteHour));
  const posts = Math.max(0, Math.floor(stats.totals.posts) || 0);
  const perWeek = Number.isFinite(stats.rhythm.postsPerWeek) ? stats.rhythm.postsPerWeek : 0;
  const origin = `posted ${posts} times this year — ${perWeek} posts a week, most often around ${label}`;
  return {
    name: `the ${label}o'clock regular`.slice(0, NAME_MAX),
    origin: origin.slice(0, ORIGIN_MAX),
    traits: ["streak keeper", "quiet volume", "steady hand"].map((t) => t.slice(0, TRAIT_MAX)),
  };
}

// ── AI wrapper ──────────────────────────────────────────────────────────────

/** Tolerant response shaping: string | {response: string} | async stubs. */
function responseText(out: unknown): string | null {
  if (typeof out === "string") return out;
  if (typeof out === "object" && out !== null && "response" in out) {
    const r = (out as { response?: unknown }).response;
    if (typeof r === "string") return r;
  }
  return null;
}

async function callPersonaModel(env: Env, system: string, user: string): Promise<string | null> {
  try {
    const out: unknown = await env.AI.run(PERSONA_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });
    return responseText(out);
  } catch {
    // AI failure flows to the repair/fallback path — generatePersona never throws
    return null;
  }
}

/**
 * One AI call (two on repair), strict parse each time, deterministic fallback
 * on double failure. Never throws (spec 05 §5).
 */
export async function generatePersona(env: Env, stats: YearStats, excerpts: string[]): Promise<Persona> {
  const prompt = buildPrompt(stats, excerpts);
  const first = await callPersonaModel(env, prompt.system, prompt.user);
  const direct = first === null ? null : parsePersona(first, stats);
  if (direct !== null) return direct;
  const repaired = await callPersonaModel(
    env,
    prompt.system,
    `${prompt.user}\n\nReturn ONLY valid JSON matching the schema.`
  );
  const second = repaired === null ? null : parsePersona(repaired, stats);
  return second ?? fallbackPersona(stats);
}
