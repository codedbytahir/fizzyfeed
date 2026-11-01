/**
 * Greatest Hits (spec 07): the opt-in real-engagement chapter. Power users
 * paste a Buffer API key (Settings → API); we validate it with ONE cheap
 GraphQL read, seal it AES-GCM (AAD = user_id — the same discipline as
 * buffer_tokens) into metrics_tokens, and use it for a single debounced
 * metrics read per refresh (10 min KV debounce, spec 07 §4).
 *
 * Honest limits (spec 07 §1): metrics are never faked and never renamed — each
 * hit carries the EXACT metric type the API returns ("impressions" stays
 * "impressions"; the UI may not relabel it "views"). Metrics come from the
 * GraphQL Post.metrics entries (name/type/value); only posts Buffer itself
 * marks `sent` within the trailing year are ranked, and the payload is parsed
 * tolerantly (edges may be missing entries; numeric value required).
 *
 * Key discipline (spec 07 §3): encrypted at rest in D1 only — never in KV,
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

/** Single GraphQL endpoint — both the probe and the metrics read land here. */
export const GRAPHQL_URL = BUFFER_ENDPOINTS.apiBase;
const PROBE_QUERY = `query Probe { account { id } }`;
const ORG_QUERY = `query OrgId { account { organizations { id } } }`;
const HITS_QUERY = `query Hits($first: Int, $input: PostsInput!) {
  posts(first: $first, input: $input) {
    edges { node { id text channelService metrics { name type value } } }
  }
}`;
/** Buffer's API-key management page — linked verbatim in the invalid_token message. */
const TOKEN_PAGE = "https://developers.buffer.com";

const REFRESH_DEBOUNCE_SEC = 600; // 10 min (spec 07 §4)
const CACHE_TTL_SEC = 600; // cached top hits live exactly one debounce window
const TOP_N = 9;
const EXCERPT_MAX = 80;
const MIN_TOKEN_LEN = 16;
const HITS_PAGE_SIZE = 100;
const HITS_WINDOW_DAYS = 365;

/**
 * Which metric type wins when a post exposes several. Documented preference
 * (cross-network PostMetricType vocabulary): impressions first, then reach,
 * then reactions, comments, clicks. The chosen type's NAME is passed through
 * exactly as the API spells it.
 */
const METRIC_PREFERENCE = ["impressions", "reach", "reactions", "comments", "clicks"] as const;

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

// ── GraphQL plumbing (key travels in the Authorization header only) ─────────

type GqlResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number };

async function gqlRequest(
  key: string,
  query: string,
  variables: Record<string, unknown>
): Promise<GqlResult> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  // 401/403 → the key stopped working (expired/revoked upstream)
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
  if (!res.ok) return { ok: false, status: res.status };
  const body = asRecord(await res.json().catch(() => ({})));
  if (Array.isArray(body["errors"]) && body["errors"].length > 0) {
    return { ok: false, status: res.status };
  }
  const data = body["data"];
  if (typeof data !== "object" || data === null) return { ok: false, status: res.status };
  return { ok: true, data: data as Record<string, unknown> };
}

/** One cheap read to validate a pasted key before anything is stored. */
async function probeKey(key: string): Promise<boolean> {
  const res = await gqlRequest(key, PROBE_QUERY, {});
  return res.ok && asStr(asRecord(res.data["account"])["id"]) !== undefined;
}

/** The metrics queries are org-scoped — resolve the account's first org. */
async function firstOrganizationId(
  key: string
): Promise<{ ok: true; orgId: string } | { ok: false; status: number }> {
  const res = await gqlRequest(key, ORG_QUERY, {});
  if (!res.ok) return { ok: false, status: res.status };
  const account = asRecord(res.data["account"]);
  const orgs = Array.isArray(account["organizations"]) ? account["organizations"] : [];
  const orgId = asStr(asRecord(orgs[0])["id"]);
  // an org-less answer is still an upstream failure — the hits query is
  // org-scoped and cannot run
  return orgId ? { ok: true, orgId } : { ok: false, status: 200 };
}

// ── metrics mapping (honest labels, spec 07 §4) ─────────────────────────────

/** Post.metrics is a name/type/value list — flatten to a type → number bag. */
function metricsBag(list: unknown): Record<string, unknown> {
  if (!Array.isArray(list)) return {};
  const bag: Record<string, unknown> = {};
  for (const entry of list) {
    const o = asRecord(entry);
    const type = asStr(o["type"]);
    const value = asNum(o["value"]);
    if (type && value !== undefined) bag[type] = value;
  }
  return bag;
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
  const metric = pickMetric(metricsBag(o["metrics"]));
  if (!metric) return null; // no numeric metric → cannot rank honestly → skip
  const text = asStr(o["text"]) ?? "";
  return {
    postId,
    excerpt: text.slice(0, EXCERPT_MAX),
    channel: asStr(o["channelService"]) ?? asStr(o["channel"]) ?? "",
    metric,
  };
}

function topHits(data: Record<string, unknown>): GreatestHit[] {
  const hits: GreatestHit[] = [];
  const conn = asRecord(data["posts"]);
  const edges = Array.isArray(conn["edges"]) ? conn["edges"] : [];
  for (const edge of edges) {
    const hit = mapHit(asRecord(edge)["node"]);
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
      `paste a buffer api key — create one at ${TOKEN_PAGE} (Settings → API)`
    );

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const token = asStr(asRecord(raw)["token"]);
  if (!token || token.length < MIN_TOKEN_LEN) return invalid();

  // Validate FIRST with one cheap read — a bare account query works for API
  // keys. Never createBufferClient here: the factory needs OAuth client opts
  // an API-key flow does not have. The key travels in the header only.
  const probeOk = await probeKey(token);
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

  let key: string;
  try {
    key = await unseal(
      c.env.TOKEN_AES_KEY,
      { iv: asBytes(row.iv), salt: asBytes(row.salt), ct: asBytes(row.pat_enc) },
      userId
    );
  } catch {
    // unreadable/tampered row → treat exactly like an expired key
    await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
    await purgeCache(c.env, userId);
    return jsonError(c, 410, "gone", GONE_MESSAGE);
  }

  // fresh cache? serve it — one metrics read per debounce window, no more
  const cachedTop = await readFreshCache(c.env, userId);
  if (cachedTop) return c.json({ top: cachedTop });

  const org = await firstOrganizationId(key);
  if (!org.ok) {
    if (org.status === 401 || org.status === 403) {
      // key expired/revoked upstream → forget it entirely: row + cached results
      await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
      await purgeCache(c.env, userId);
      return jsonError(
        c,
        410,
        "gone",
        "your buffer key stopped working — enable greatest hits again with a fresh one"
      );
    }
    return jsonError(c, 502, "upstream", UPSTREAM_MESSAGE);
  }
  const orgId = org.orgId;

  const since = Math.floor(Date.now() / 1000) - HITS_WINDOW_DAYS * 86_400;
  const result = await gqlRequest(key, HITS_QUERY, {
    first: HITS_PAGE_SIZE,
    input: {
      organizationId: orgId,
      filter: { status: ["sent"], startDate: new Date(since * 1000).toISOString() },
      sort: [{ field: "createdAt", direction: "desc" }],
    },
  });

  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      // key expired/revoked upstream → forget it entirely: row + cached results
      await c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId).run();
      await purgeCache(c.env, userId);
      return jsonError(
        c,
        410,
        "gone",
        "your buffer key stopped working — enable greatest hits again with a fresh one"
      );
    }
    return jsonError(c, 502, "upstream", UPSTREAM_MESSAGE);
  }

  const top = topHits(result.data);
  const entry: GhCacheEntry = {
    top,
    metricNames: [...new Set(top.map((hit) => hit.metric.name))],
    cachedAt: Math.floor(Date.now() / 1000),
  };
  await c.env.CACHE.put(cacheKey(userId), JSON.stringify(entry), { expirationTtl: CACHE_TTL_SEC });
  return c.json({ top }); // hits only — the key never leaves this module
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
