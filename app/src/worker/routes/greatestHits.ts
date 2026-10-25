/**
 * Greatest Hits (spec 07): the opt-in real-engagement chapter. Power users
 * paste a Buffer personal access token (PAT); we validate it with ONE cheap
 * read, seal it AES-GCM (AAD = user_id — the same discipline as buffer_tokens)
 * into metrics_tokens, and use it for a single debounced metrics read per
 * refresh (10 min KV debounce, spec 07 §4).
 *
 * Honest limits (spec 07 §1): metrics are never faked and never renamed — each
 * hit carries the EXACT field name the metrics API returns ("impressions"
 * stays "impressions"; the UI may not relabel it "views"). Buffer's standard
 * API does not expose these numbers cleanly, so the metrics endpoint is
 * documented best-effort and its payload is parsed tolerantly (array or
 * { updates: [...] }; metrics as a name → number bag).
 *
 * PAT discipline (spec 07 §3): encrypted at rest in D1 only — never in KV,
 * never logged, never returned to the client (not even masked; /status shows
 * only "enabled" + "since"). Response bodies carry hits, nothing else.
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { seal, unseal } from "../lib/crypto";
import { BUFFER_ENDPOINTS } from "../lib/buffer";
import { debounceCheck, jsonError } from "../lib/http";
import { readSessionUserId } from "../lib/session";
import type { GreatestHit } from "../../shared/types";
import type { MetricsTokenRow } from "../../shared/schema";

const greatestHits = new Hono<HonoEnv>();

/** Documented best-effort metrics endpoint (spec 07 §1) — mocked in tests. */
export const METRICS_URL = "https://api.buffer.com/1/updates/metrics.json";
/** Buffer's PAT management page — linked verbatim in the invalid_token message. */
const TOKEN_PAGE = "https://buffer.com/app/settings/developers";

const REFRESH_DEBOUNCE_SEC = 600; // 10 min (spec 07 §4)
const CACHE_TTL_SEC = 600; // cached top hits live exactly one debounce window
const TOP_N = 9;
const EXCERPT_MAX = 80;
const MIN_TOKEN_LEN = 16;

/**
 * Which metric field wins when a post exposes several. Documented preference:
 * impressions first, then likes/favorites, then clicks, then replies. The
 * chosen field's NAME is passed through exactly as the API spells it.
 */
const METRIC_PREFERENCE = ["impressions", "likes", "favorites", "clicks", "replies"] as const;

const GONE_MESSAGE = "greatest hits is off — enable it again to refresh";
const UPSTREAM_MESSAGE = "metrics service is unreachable right now";

function cacheKey(userId: string): string {
  return `gh:${userId}`;
}

// ── tolerant JSON helpers (Buffer payloads drift; map defensively) ──────────

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** D1 hands BLOB columns back as ArrayBuffer; tests may pass Uint8Array. */
function asBytes(v: ArrayBuffer | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

// ── metrics mapping (honest labels, spec 07 §4) ─────────────────────────────

function extractUpdates(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const updates = asRecord(body)["updates"];
  return Array.isArray(updates) ? updates : [];
}

/**
 * Pick ONE metric per post, by documented preference, then by the first
 * numeric field present. The label is always the API's own field name.
 */
function pickMetric(bag: Record<string, unknown>): { name: string; value: number } | null {
  for (const name of METRIC_PREFERENCE) {
    const value = asNum(bag[name]);
    if (value !== undefined) return { name, value };
  }
  for (const [name, value] of Object.entries(bag)) {
    const n = asNum(value);
    if (n !== undefined) return { name, value: n };
  }
  return null;
}

function mapHit(raw: unknown): GreatestHit | null {
  const o = asRecord(raw);
  const postId = asStr(o["id"]);
  if (!postId) return null;
  const metric = pickMetric(asRecord(o["metrics"]));
  if (!metric) return null; // no numeric metric → cannot rank honestly → skip
  const text = asStr(o["text"]) ?? "";
  return {
    postId,
    excerpt: text.slice(0, EXCERPT_MAX),
    channel: asStr(o["service"]) ?? asStr(o["channel"]) ?? "",
    metric,
  };
}

function topHits(body: unknown): GreatestHit[] {
  const hits: GreatestHit[] = [];
  for (const raw of extractUpdates(body)) {
    const hit = mapHit(raw);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.metric.value - a.metric.value);
  return hits.slice(0, TOP_N);
}

// ── cache (KV is cache-only — ciphertext never goes here, spec 07 §3) ───────

interface GhCacheEntry {
  top: GreatestHit[];
  metricNames: string[];
  cachedAt: number; // unix seconds
}

/**
 * Serve the cached top list while it is fresh. Real KV expires the entry via
 * TTL; the cachedAt check is a defensive second gate (and self-heals entries
 * that outlive their window on KV clones that ignore TTLs).
 */
async function readFreshCache(env: Env, userId: string): Promise<GreatestHit[] | null> {
  const key = cacheKey(userId);
  const raw = await env.CACHE.get(key);
  if (raw === null) return null;
  let entry: GhCacheEntry | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(asRecord(parsed)["top"])) entry = parsed as GhCacheEntry;
  } catch {
    entry = null;
  }
  if (!entry) {
    await env.CACHE.delete(key); // corrupt → self-heal
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof entry.cachedAt !== "number" || now - entry.cachedAt >= CACHE_TTL_SEC) {
    await env.CACHE.delete(key); // stale → refetch
    return null;
  }
  return entry.top;
}

async function purgeCache(env: Env, userId: string): Promise<void> {
  await env.CACHE.delete(cacheKey(userId));
}

// ── routes ──────────────────────────────────────────────────────────────────

// POST /api/greatest-hits/enable { token } → 204 (validated with one cheap read)
greatestHits.post("/enable", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer first");

  const invalid = () =>
    jsonError(
      c,
      400,
      "invalid_token",
      `paste a buffer personal access token — create one at ${TOKEN_PAGE}`
    );

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const token = asStr(asRecord(raw)["token"]);
  if (!token || token.length < MIN_TOKEN_LEN) return invalid();

  // Validate FIRST with one cheap read — user.json works for PATs. Never
  // createBufferClient here: the factory needs OAuth client opts a PAT flow
  // does not have. The PAT travels in the query string only, to Buffer.
  const probe = new URL(`${BUFFER_ENDPOINTS.apiBase}/user.json`);
  probe.searchParams.set("access_token", token);
  let probeOk = false;
  try {
    probeOk = (await fetch(probe.toString(), { method: "GET" })).ok;
  } catch {
    probeOk = false;
  }
  if (!probeOk) return invalid();

  const box = await seal(c.env.TOKEN_AES_KEY, token, userId); // AAD = user_id
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO metrics_tokens (user_id, pat_enc, iv, salt, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       pat_enc = excluded.pat_enc, iv = excluded.iv, salt = excluded.salt,
       created_at = excluded.created_at, revoked_at = NULL`
  )
    .bind(userId, box.ct, box.iv, box.salt, now)
    .run();

  await purgeCache(c.env, userId); // stale results must not outlive a re-enable
  return c.body(null, 204);
});

// POST /api/greatest-hits/refresh → { top: GreatestHit[] } (top 9, debounced)
greatestHits.post("/refresh", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer first");

  const gate = await debounceCheck(c.env.CACHE, `deb:gh:${userId}`, REFRESH_DEBOUNCE_SEC, 1);
  if (!gate.allowed) {
    return jsonError(
      c,
      429,
      "rate_limited",
      `greatest hits was just refreshed — try again in ${gate.retryAfterSec}s`
    );
  }

  const row = await c.env.DB.prepare("SELECT * FROM metrics_tokens WHERE user_id = ?")
    .bind(userId)
    .first<MetricsTokenRow>();
  if (!row || row.revoked_at !== null) return jsonError(c, 410, "gone", GONE_MESSAGE);

  let pat: string;
  try {
    pat = await unseal(
      c.env.TOKEN_AES_KEY,
      { iv: asBytes(row.iv), salt: asBytes(row.salt), ct: asBytes(row.pat_enc) },
      userId
    );
  } catch {
    // unreadable/tampered row → treat exactly like an expired PAT
    await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
    await purgeCache(c.env, userId);
    return jsonError(c, 410, "gone", GONE_MESSAGE);
  }

  // fresh cache? serve it — one metrics read per debounce window, no more
  const cachedTop = await readFreshCache(c.env, userId);
  if (cachedTop) return c.json({ top: cachedTop });

  const url = new URL(METRICS_URL);
  url.searchParams.set("access_token", pat);
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET" });
  } catch {
    return jsonError(c, 502, "upstream", UPSTREAM_MESSAGE);
  }

  if (res.status === 401 || res.status === 403) {
    // PAT expired/revoked upstream → forget it entirely: row + cached results
    await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
    await purgeCache(c.env, userId);
    return jsonError(
      c,
      410,
      "gone",
      "your buffer token stopped working — enable greatest hits again with a fresh one"
    );
  }
  if (!res.ok) return jsonError(c, 502, "upstream", UPSTREAM_MESSAGE);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return jsonError(c, 502, "upstream", UPSTREAM_MESSAGE);
  }

  const top = topHits(body);
  const entry: GhCacheEntry = {
    top,
    metricNames: [...new Set(top.map((hit) => hit.metric.name))],
    cachedAt: Math.floor(Date.now() / 1000),
  };
  await c.env.CACHE.put(cacheKey(userId), JSON.stringify(entry), { expirationTtl: CACHE_TTL_SEC });
  return c.json({ top }); // hits only — the PAT never leaves this module
});

// POST /api/greatest-hits/revoke → 204 (row deleted; cached results purged)
greatestHits.post("/revoke", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer first");
  await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
  await purgeCache(c.env, userId);
  return c.body(null, 204);
});

// GET /api/greatest-hits/status → { enabled, since? } — never token material
greatestHits.get("/status", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer first");
  const row = await c.env.DB.prepare("SELECT * FROM metrics_tokens WHERE user_id = ?")
    .bind(userId)
    .first<MetricsTokenRow>();
  if (!row || row.revoked_at !== null) return c.json({ enabled: false });
  return c.json({ enabled: true, since: row.created_at });
});

export default greatestHits;
