/**
 * Persona API (spec 05 §4, tasks T14/T15). Mounted at /api/persona.
 *
 *   POST /            → cached-or-generated alter ego (1 AI call per user-year)
 *   POST /regenerate  → fresh generation, cache overwrite (max 3/user-year, debounced 60s)
 *   GET /             → cached persona read (the deck serves the same row)
 *
 * Cache hits return before any stats/AI work (spec 05 §5 <50ms path). Buffer
 * sampling failures degrade honestly: the persona proceeds from stats alone.
 * Logging is ids/counts only — excerpt text and persona output never reach
 * the console (spec 01 §5, spec 05 §5).
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { debounce60s, jsonError } from "../lib/http";
import { readSessionUserId } from "../lib/session";
import { RefreshError, withAccessToken } from "../lib/refresh";
import { createBufferClient } from "../lib/buffer";
import { generatePersona, sampleExposts } from "../lib/persona";
import { buildDeck } from "./deck";
import type { BufferPost, Persona, YearStats } from "../../shared/types";

const REGEN_LIMIT = 3;
const REGEN_LIMIT_MESSAGE = "3 regenerations per year — the numbers don't change that fast";
const PERSONA_CACHE_CAP = 200; // posts gathered before sampling — ample for a 40-excerpt spread

const persona = new Hono<HonoEnv>();

// ── ai_cache helpers (same row the deck route reads) ────────────────────────

/** Lenient read of a cached row — the row was validated when it was written. */
function safeParsePersona(json: string): Persona | null {
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Partial<Persona>;
    if (typeof p.name !== "string" || typeof p.origin !== "string" || !Array.isArray(p.traits)) {
      return null;
    }
    const traits = p.traits.filter((t): t is string => typeof t === "string");
    return { name: p.name, origin: p.origin, traits };
  } catch {
    return null; // corrupt row → treated as a miss (POST) / no_persona (GET)
  }
}

async function readCachedPersona(env: Env, userId: string, year: number): Promise<Persona | null> {
  const row = await env.DB.prepare(
    "SELECT payload_json FROM ai_cache WHERE user_id = ? AND kind = 'persona' AND year = ?"
  )
    .bind(userId, year)
    .first<{ payload_json: string }>();
  return row ? safeParsePersona(row.payload_json) : null;
}

async function writeCachedPersona(env: Env, userId: string, year: number, value: Persona): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO ai_cache (user_id, kind, year, payload_json, created_at) VALUES (?, 'persona', ?, ?, ?) " +
      "ON CONFLICT (user_id, kind, year) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at"
  )
    .bind(userId, year, JSON.stringify(value), Math.floor(Date.now() / 1000))
    .run();
}

// ── inputs: YearStats (via the shared deck loader) + buffer excerpts ────────

async function gatherPersonaInputs(
  env: Env,
  userId: string,
  year: number
): Promise<{ stats: YearStats; excerpts: string[] }> {
  const { deck } = await buildDeck(env, userId, year);
  const stats = deck.stats;
  let excerptSources: BufferPost[] = [];
  try {
    excerptSources = await withAccessToken<BufferPost[]>(env, userId, async (accessToken) => {
      const client = createBufferClient({
        clientId: env.BUFFER_CLIENT_ID,
        clientSecret: env.BUFFER_CLIENT_SECRET,
        redirectUri: env.BUFFER_REDIRECT_URI,
      });
      const channels = await client.listChannels(accessToken);
      const posts: BufferPost[] = [];
      for (const channel of channels) {
        if (posts.length >= PERSONA_CACHE_CAP) break;
        const page = await client.listPosts(accessToken, { channelId: channel.id, count: 50 });
        posts.push(...page.posts);
      }
      posts.sort((a, b) => b.createdAt - a.createdAt); // deterministic newest-first spread
      return posts;
    });
  } catch (err) {
    if (err instanceof RefreshError) throw err; // caller maps to 401 session_expired
    excerptSources = []; // buffer outage → persona from stats only (honest)
  }
  return { stats, excerpts: sampleExposts(excerptSources) };
}

// ── regenerate counter (per user-year, KV) ──────────────────────────────────

/** Tolerant {count} read: works with real KV and plain-string test doubles. */
async function readRegenCount(kv: KVNamespace, key: string): Promise<number> {
  let raw: string | null = null;
  try {
    raw = await kv.get(key);
  } catch {
    return 0;
  }
  if (raw === null) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const count = (parsed as { count?: unknown }).count;
      if (typeof count === "number" && Number.isFinite(count)) return Math.max(0, Math.floor(count));
    }
  } catch {
    return 0;
  }
  return 0;
}

// ── routes ──────────────────────────────────────────────────────────────────

persona.post("/", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to meet your alter ego");
  const year = new Date().getUTCFullYear();

  const deb = await debounce60s(c.env.CACHE, `deb:persona:${userId}:${year}`);
  if (!deb.allowed) {
    return jsonError(c, 429, "rate_limited", `try again in ${deb.retryAfterSec}s`);
  }

  // cache hit: no AI, no stats load (spec 05 §5 <50ms path)
  const cached = await readCachedPersona(c.env, userId, year);
  if (cached) return c.json({ persona: cached });

  let inputs: { stats: YearStats; excerpts: string[] };
  try {
    inputs = await gatherPersonaInputs(c.env, userId, year);
  } catch (err) {
    if (err instanceof RefreshError) {
      return jsonError(c, 401, "session_expired", "buffer session expired — reconnect to finish your persona");
    }
    throw err;
  }

  const fresh = await generatePersona(c.env, inputs.stats, inputs.excerpts);
  await writeCachedPersona(c.env, userId, year, fresh);
  console.log(`persona generated user=${userId} year=${year} excerpts=${inputs.excerpts.length}`); // ids/counts only
  return c.json({ persona: fresh });
});

persona.post("/regenerate", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to meet your alter ego");
  const year = new Date().getUTCFullYear();

  const deb = await debounce60s(c.env.CACHE, `deb:persona-regen:${userId}`);
  if (!deb.allowed) {
    return jsonError(c, 429, "rate_limited", `try again in ${deb.retryAfterSec}s`);
  }

  // per-year counter (spec 05 §4: max 3 regenerations per user-year)
  const counterKey = `persona-regen:${userId}:${year}`;
  const used = await readRegenCount(c.env.CACHE, counterKey);
  if (used >= REGEN_LIMIT) {
    return jsonError(c, 429, "regen_limit", REGEN_LIMIT_MESSAGE);
  }
  await c.env.CACHE.put(counterKey, JSON.stringify({ count: used + 1 }));

  let inputs: { stats: YearStats; excerpts: string[] };
  try {
    inputs = await gatherPersonaInputs(c.env, userId, year); // no cache read here
  } catch (err) {
    if (err instanceof RefreshError) {
      return jsonError(c, 401, "session_expired", "buffer session expired — reconnect to finish your persona");
    }
    throw err;
  }

  const fresh = await generatePersona(c.env, inputs.stats, inputs.excerpts);
  await writeCachedPersona(c.env, userId, year, fresh); // overwrite the existing row
  console.log(`persona regenerated user=${userId} year=${year} count=${used + 1}`); // ids/counts only
  return c.json({ persona: fresh });
});

persona.get("/", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to meet your alter ego");
  const year = new Date().getUTCFullYear();
  const cached = await readCachedPersona(c.env, userId, year);
  if (!cached) return jsonError(c, 404, "no_persona", "no alter ego yet — open your deck to meet them");
  c.header("Cache-Control", "private, max-age=60");
  return c.json({ persona: cached });
});

export default persona;
