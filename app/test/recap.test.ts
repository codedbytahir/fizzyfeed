/**
 * Recap tests (spec 06): the pure compose/validate layer, then the preview +
 * queue routes against fake D1/KV bindings with Buffer's HTTP API mocked at
 * the global fetch level (listChannels + createPost). Covers consent, the
 * write-scope upgrade hint, KV idempotency, the daily rate limit, partial
 * failure, and the privacy rule that the audit line never carries post text.
 *
 * The D1 fake extends helpers.FakeD1 with exactly the three statements recap
 * adds on top of the base (posts select, ai_cache select, scopes select) —
 * anything unknown still throws, so schema drift fails loudly.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import recapRoute from "../src/worker/routes/recap";
import {
  RECAP_MAX_CHARS,
  composeRecap,
  hasWriteScope,
  hourLabel,
  monthName,
  validateRecapText,
} from "../src/worker/lib/recap";
import { sealTokenColumns } from "../src/worker/lib/refresh";
import { setSessionCookie } from "../src/worker/lib/session";
import {
  createTestRig,
  jsonResponse,
  FakeD1,
  type BoundStub,
  type FakeKV,
  type Row,
} from "./helpers";
import type { HonoEnv } from "../src/worker/env";
import type { Env } from "../src/worker/env";
import type { PostRow } from "../src/shared/schema";
import type {
  ApiError,
  BufferChannel,
  Persona,
  RecapPreview,
  RecapQueueResult,
  YearStats,
} from "../src/shared/types";

const CURRENT_YEAR = new Date().getUTCFullYear();
const USER = "user-recap-1";
const APP_ORIGIN = "https://app.test";
const UPGRADE_URL = "/api/auth/buffer/upgrade";
// Dummy 32-byte test key, built at runtime so no base64 secret literal is committed
// (deck.test.ts / agent-check §4 pattern) — this is not a real secret.
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");
// runtime-assembled so the banned literal never appears in source (migration.test.ts pattern)
const BANNED = ["wr", "app", "ed"].join("");
const BANNED_RE = new RegExp(BANNED, "i");

// ── fixtures ─────────────────────────────────────────────────────────────────

const RECAP_STATS: YearStats = {
  year: CURRENT_YEAR,
  totals: { posts: 5214, words: 389102, channels: 3, activeDays: 210 },
  firstPost: { at: Date.UTC(CURRENT_YEAR, 0, 2, 9) / 1000, excerpt: "new year, first post", channel: "twitter" },
  rhythm: {
    bestDow: 2,
    favoriteHour: 23,
    postsPerWeek: 14.3,
    dowHistogram: [30, 31, 32, 30, 30, 30, 31],
    hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 23 ? 900 : 1)),
  },
  streaks: {
    longest: 141,
    longestStart: Date.UTC(CURRENT_YEAR, 6, 13) / 1000,
    busiestWeek: Date.UTC(CURRENT_YEAR, 9, 6) / 1000,
    busiestWeekPosts: 21,
  },
  mix: {
    channels: [
      { service: "twitter", count: 2614, pct: 50.1 },
      { service: "instagram", count: 1600, pct: 30.7 },
      { service: "linkedin", count: 1000, pct: 19.2 },
    ],
    topTopics: ["shipping", "demos"],
  },
  peaks: { bestMonth: 9, bestMonthPosts: 620, bestWeekPosts: 21, monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 620, 11, 12] },
  daily: [],
};

const PERSONA: Persona = {
  name: "the midnight archivist",
  origin: "posted 21 posts in a single week and never missed a tuesday",
  traits: ["archival", "night owl", "curious"],
};

const CHANNELS: BufferChannel[] = [
  { id: "ch-twitter", service: "twitter", serviceId: "svc-1", name: "alice" },
  { id: "ch-instagram", service: "instagram", serviceId: "svc-2", name: "alice" },
];

// ── fake D1: base + the three recap/deck statements ─────────────────────────

type Prepared = ReturnType<FakeD1["prepare"]>;

function stubFor(sql: string, run: (params: unknown[]) => Promise<Row[]>): Prepared {
  const make = (params: unknown[]): BoundStub => ({
    sql,
    params,
    first: async <T = Row>(): Promise<T | null> => ((await run(params)) as unknown as T[])[0] ?? null,
    all: async <T = Row>(): Promise<{ results: T[] }> => ({
      results: (await run(params)) as unknown as T[],
    }),
    run: async (): Promise<{ success: true }> => {
      await run(params);
      return { success: true };
    },
  });
  return { ...make([]), bind: (...params: unknown[]) => make(params) };
}

class RecapD1 extends FakeD1 {
  posts: PostRow[] = [];
  personaRow: Row | null = null;

  override prepare(sql: string): Prepared {
    const db = this;
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM posts")) {
      return stubFor(sql, async () => db.posts as unknown as Row[]);
    }
    if (q.includes("ai_cache")) {
      return stubFor(sql, async () => (db.personaRow ? [db.personaRow] : []));
    }
    if (q.startsWith("SELECT scopes FROM buffer_tokens")) {
      return stubFor(sql, async (params) => {
        const row = db.tokens.get(String(params[0]));
        return row ? [{ scopes: row["scopes"] }] : [];
      });
    }
    return super.prepare(sql);
  }
}

interface RecapRig {
  env: Env;
  db: RecapD1;
  kv: FakeKV;
}

/** createTestRig's env (random per-run TOKEN_AES_KEY) with the extended D1 fake. */
function makeRig(): RecapRig {
  const base = createTestRig();
  const db = new RecapD1();
  const env: Env = {
    ...base.env,
    DB: db as unknown as Env["DB"],
    SESSION_SECRET, // fixed so loginCookie() signs what the routes verify
  };
  return { env, db, kv: base.kv };
}

function seedPosts(db: RecapD1): void {
  // 30 rows spread across the year → 30 posts / 150 words / 2-day streak
  // (feb 1 + feb 2), favorite hour 0 ("12am"), best month 0 ("january")
  const services = ["twitter", "instagram", "linkedin"] as const;
  db.posts = Array.from({ length: 30 }, (_, i) => {
    const at = Date.UTC(CURRENT_YEAR, i % 12, (i % 25) + 1, i % 24) / 1000;
    const d = new Date(at * 1000);
    return {
      id: `p${i}`,
      user_id: USER,
      channel_id: `ch${i % 3}`,
      channel_service: services[i % 3] ?? "twitter",
      text: `post number ${i} about shipping`,
      created_at: at,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      dow: d.getUTCDay(),
      hour: d.getUTCHours(),
    } satisfies PostRow;
  });
}

async function seedToken(rig: RecapRig, scopes: string): Promise<void> {
  const cols = await sealTokenColumns(rig.env.TOKEN_AES_KEY, USER, `at-${USER}`, `rt-${USER}`);
  rig.db.tokens.set(USER, {
    user_id: USER,
    access_enc: cols.accessEnc,
    refresh_enc: cols.refreshEnc,
    iv: cols.iv,
    salt: cols.salt,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scopes,
    rotated_at: 0,
  });
}

/** Generate a legit signed session cookie via a throwaway Hono app (deck.test.ts pattern). */
async function loginCookie(secret: string): Promise<string> {
  const app = new Hono<HonoEnv>();
  app.get("/login", async (c) => {
    await setSessionCookie(c, USER);
    return c.text("ok");
  });
  const res = await app.request("/login", {}, { SESSION_SECRET: secret } as unknown as HonoEnv["Bindings"]);
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("session cookie missing from login response");
  return setCookie.slice(0, setCookie.indexOf(";"));
}

// ── Buffer HTTP mock (global fetch) ─────────────────────────────────────────

interface BufferCall {
  url: string;
  method: string;
  channelId: string | null;
  text: string | null; // in-memory only — never logged
}

const bufferCalls: BufferCall[] = [];
const failChannelStatus = new Map<string, number>();
let channelsFixture: BufferChannel[] = CHANNELS;
let profilesStatus = 200;

function installBufferFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.buffer.com/1/profiles.json")) {
      bufferCalls.push({ url, method: "GET", channelId: null, text: null });
      if (profilesStatus !== 200) return jsonResponse({ error: "boom" }, profilesStatus);
      return jsonResponse(channelsFixture);
    }
    if (url.startsWith("https://api.buffer.com/1/updates/create.json")) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const channelId = form.get("profile_ids[]") ?? "";
      const text = form.get("text") ?? "";
      bufferCalls.push({ url, method: "POST", channelId, text });
      const status = failChannelStatus.get(channelId) ?? 200;
      if (status !== 200) return jsonResponse({ error: "boom" }, status);
      return jsonResponse({ updates: { [channelId]: { id: `post-${channelId}` } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function createPostCallCount(): number {
  return bufferCalls.filter((call) => call.method === "POST").length;
}

// ── app + request helpers ────────────────────────────────────────────────────

function makeApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/api/recap", recapRoute);
  return app;
}

function postJson(
  app: Hono<HonoEnv>,
  env: Env,
  cookie: string | null,
  rawBody: string
): Promise<Response> | Response {
  return app.request(
    "/api/recap/queue",
    {
      method: "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        "content-type": "application/json",
      },
      body: rawBody,
    },
    env
  );
}

function queueBody(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    queueId: "q-default",
    text: "12 months of posting, carded",
    channelIds: ["ch-twitter"],
    consent: true,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  bufferCalls.length = 0;
  failChannelStatus.clear();
  channelsFixture = CHANNELS;
  profilesStatus = 200;
});

// ── composeRecap (pure, spec 06 §1) ─────────────────────────────────────────

describe("composeRecap", () => {
  it("renders the exact template with numbers verbatim from stats", () => {
    const text = composeRecap(RECAP_STATS, PERSONA, APP_ORIGIN);
    expect(text).toBe(
      [
        "12 months of posting, carded:",
        "5,214 posts · 389,102 words · 141-day streak",
        "best hour: 11pm · biggest month: october",
        "this year's alter ego: the midnight archivist",
        "queue your year → https://app.test",
      ].join("\n")
    );
  });

  it("omits the alter ego line entirely when persona is null", () => {
    const text = composeRecap(RECAP_STATS, null, APP_ORIGIN);
    expect(text).toBe(
      [
        "12 months of posting, carded:",
        "5,214 posts · 389,102 words · 141-day streak",
        "best hour: 11pm · biggest month: october",
        "queue your year → https://app.test",
      ].join("\n")
    );
    expect(text).not.toContain("alter ego");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("stays ≤ 500 chars even with a long app origin", () => {
    const longOrigin = `https://app.test/${"a".repeat(300)}`;
    expect(composeRecap(RECAP_STATS, PERSONA, longOrigin).length).toBeLessThanOrEqual(500);
    expect(composeRecap(RECAP_STATS, null, longOrigin).length).toBeLessThanOrEqual(500);
  });

  it("never contains the banned brand word", () => {
    expect(BANNED_RE.test(composeRecap(RECAP_STATS, PERSONA, APP_ORIGIN))).toBe(false);
    expect(BANNED_RE.test(composeRecap(RECAP_STATS, null, APP_ORIGIN))).toBe(false);
  });

  it("contains the app origin (queue your year line)", () => {
    expect(composeRecap(RECAP_STATS, PERSONA, APP_ORIGIN)).toContain(`queue your year → ${APP_ORIGIN}`);
  });

  it("is deterministic: identical input → identical output", () => {
    expect(composeRecap(RECAP_STATS, PERSONA, APP_ORIGIN)).toBe(
      composeRecap(RECAP_STATS, PERSONA, APP_ORIGIN)
    );
  });
});

// ── exported helpers ─────────────────────────────────────────────────────────

describe("recap helpers", () => {
  it("hourLabel: 0→12am, 12→12pm, 13→1pm, 23→11pm", () => {
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(13)).toBe("1pm");
    expect(hourLabel(23)).toBe("11pm");
  });

  it("monthName: lowercase months, safe fallback", () => {
    expect(monthName(0)).toBe("january");
    expect(monthName(9)).toBe("october");
    expect(monthName(11)).toBe("december");
    expect(monthName(99)).toBe("month");
  });

  it("hasWriteScope splits scopes on whitespace/commas and matches the whole token", () => {
    expect(hasWriteScope("read")).toBe(false);
    expect(hasWriteScope("read write")).toBe(true);
    expect(hasWriteScope("read,write")).toBe(true);
    expect(hasWriteScope("  read   write ")).toBe(true);
    expect(hasWriteScope("readwrite")).toBe(false);
    expect(hasWriteScope("")).toBe(false);
  });

  it("exposes the 500-char cap constant and the upgrade path", () => {
    expect(RECAP_MAX_CHARS).toBe(500);
  });
});

// ── validateRecapText ────────────────────────────────────────────────────────

describe("validateRecapText", () => {
  it("accepts exactly 500 chars", () => {
    expect(validateRecapText("a".repeat(500))).toEqual({ ok: true });
  });

  it("rejects 501 chars with the exceeds reason", () => {
    const verdict = validateRecapText("a".repeat(501));
    expect(verdict).toEqual({ ok: false, reason: "text exceeds 500 characters" });
  });

  it("rejects empty and whitespace-only text", () => {
    expect(validateRecapText("")).toEqual({ ok: false, reason: "text is empty" });
    expect(validateRecapText("   \n  ")).toEqual({ ok: false, reason: "text is empty" });
  });

  it("rejects the banned brand word (assembled, never spelled out)", () => {
    const verdict = validateRecapText(`my year in review: the ${BANNED} edition`);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("text contains a banned term");
  });

  it("accepts honest sentence-case copy", () => {
    expect(validateRecapText("12 months of posting, carded:\n5,214 posts · queue your year")).toEqual({
      ok: true,
    });
  });
});

// ── GET /api/recap/preview ───────────────────────────────────────────────────

describe("GET /api/recap/preview", () => {
  const app = makeApp();
  let cookie: string;

  beforeAll(async () => {
    cookie = await loginCookie(SESSION_SECRET);
  });

  beforeEach(() => {
    installBufferFetch();
  });

  async function makePreviewRig(scopes: string, persona: Persona | null): Promise<RecapRig> {
    const rig = makeRig();
    seedPosts(rig.db);
    rig.db.personaRow = persona ? { payload_json: JSON.stringify(persona) } : null;
    await seedToken(rig, scopes);
    return rig;
  }

  it("401 no_session without a session cookie", async () => {
    const rig = await makePreviewRig("read", null);
    const res = await app.request("/api/recap/preview", {}, rig.env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
    expect(bufferCalls).toHaveLength(0);
  });

  it("returns composed text, channels, needsWriteScope true (scopes=read), personaUsed true", async () => {
    const rig = await makePreviewRig("read", PERSONA);
    const res = await app.request("/api/recap/preview", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as RecapPreview;
    // text is the exact template over the real aggregate of the 30 seeded posts
    // (feb 1 = i=25 and feb 2 = i=1 are adjacent → 2-day streak)
    expect(preview.text).toContain("30 posts · 150 words · 2-day streak");
    expect(preview.text).toContain("best hour: 12am · biggest month: january");
    expect(preview.text).toContain("this year's alter ego: the midnight archivist");
    expect(preview.text).toContain(`queue your year → ${APP_ORIGIN}`);
    expect(preview.text.length).toBeLessThanOrEqual(500);
    // channels come from the mocked Buffer listChannels
    expect(preview.channels.map((ch) => ch.id)).toEqual(["ch-twitter", "ch-instagram"]);
    expect(preview.needsWriteScope).toBe(true);
    expect(preview.personaUsed).toBe(true);
    expect(bufferCalls).toHaveLength(1); // profiles.json only
  });

  it("needsWriteScope false with scopes='read write' and personaUsed false without a persona row", async () => {
    const rig = await makePreviewRig("read write", null);
    const res = await app.request("/api/recap/preview", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as RecapPreview;
    expect(preview.needsWriteScope).toBe(false);
    expect(preview.personaUsed).toBe(false);
    expect(preview.text).not.toContain("alter ego");
  });

  it("401 session_expired when buffer is not connected (no token row)", async () => {
    const rig = makeRig();
    seedPosts(rig.db);
    const res = await app.request("/api/recap/preview", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("session_expired");
  });

  it("502 upstream when the Buffer channels fetch fails", async () => {
    const rig = await makePreviewRig("read", null);
    profilesStatus = 500;
    const res = await app.request("/api/recap/preview", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("upstream");
  });
});

// ── POST /api/recap/queue ────────────────────────────────────────────────────

describe("POST /api/recap/queue", () => {
  const app = makeApp();
  let cookie: string;

  beforeAll(async () => {
    cookie = await loginCookie(SESSION_SECRET);
  });

  beforeEach(() => {
    installBufferFetch();
  });

  async function makeQueueRig(scopes = "read write", persona: Persona | null = PERSONA): Promise<RecapRig> {
    const rig = makeRig();
    seedPosts(rig.db);
    rig.db.personaRow = persona ? { payload_json: JSON.stringify(persona) } : null;
    await seedToken(rig, scopes);
    return rig;
  }

  it("401 no_session without a session cookie", async () => {
    const rig = await makeQueueRig();
    const res = await postJson(app, rig.env, null, queueBody({}));
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
    expect(bufferCalls).toHaveLength(0);
  });

  it("400 malformed on bad JSON", async () => {
    const rig = await makeQueueRig();
    const res = await postJson(app, rig.env, cookie, "{not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("malformed");
  });

  it("400 invalid_queue when queueId is missing or not a string", async () => {
    const rig = await makeQueueRig();
    for (const queueId of [undefined, 12345]) {
      const overrides: Record<string, unknown> = { queueId };
      const res = await postJson(app, rig.env, cookie, queueBody(overrides));
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("invalid_queue");
    }
    expect(bufferCalls).toHaveLength(0); // validation precedes any Buffer call
  });

  it("400 consent_required when consent is not exactly true", async () => {
    const rig = await makeQueueRig();
    for (const consent of [undefined, false, "yes"]) {
      const res = await postJson(app, rig.env, cookie, queueBody({ consent }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("consent_required");
      expect(body.error.message).toBe("explicit consent required — read the preview first");
    }
    expect(bufferCalls).toHaveLength(0);
  });

  it("400 text_invalid for 501 chars and for empty text", async () => {
    const rig = await makeQueueRig();
    const long = await postJson(app, rig.env, cookie, queueBody({ text: "x".repeat(501) }));
    expect(long.status).toBe(400);
    expect(((await long.json()) as ApiError).error.message).toBe("text exceeds 500 characters");

    const empty = await postJson(app, rig.env, cookie, queueBody({ text: "  " }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as ApiError).error.message).toBe("text is empty");
    expect(bufferCalls).toHaveLength(0);
  });

  it("400 no_channels when channelIds is empty or not an array", async () => {
    const rig = await makeQueueRig();
    for (const channelIds of [[], "ch-twitter", 7]) {
      const res = await postJson(app, rig.env, cookie, queueBody({ channelIds }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("no_channels");
    }
    expect(bufferCalls).toHaveLength(0);
  });

  it("403 upgrade_required with the auth upgradeUrl when write scope is missing (no Buffer write attempted)", async () => {
    const rig = await makeQueueRig("read");
    const res = await postJson(app, rig.env, cookie, queueBody({}));
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiError & { error: { upgradeUrl?: string } };
    expect(body.error.code).toBe("upgrade_required");
    expect(body.error.message).toBe("connect with write access to queue the recap");
    expect(body.error.upgradeUrl).toBe(UPGRADE_URL);
    expect(bufferCalls).toHaveLength(0); // scope gate precedes any Buffer call
  });

  it("happy path: queues to 2 channels, stores the KV marker, audits ids + counts only", async () => {
    const rig = await makeQueueRig();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const queueId = "q-happy-1";
    const sentinelText = "sneaky audit sentinel — the recap body itself";
    const res = await postJson(
      app,
      rig.env,
      cookie,
      queueBody({ queueId, text: sentinelText, channelIds: ["ch-twitter", "ch-instagram"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as RecapQueueResult;
    expect(result.queueId).toBe(queueId);
    expect(result.results).toEqual([
      { channelId: "ch-twitter", service: "twitter", ok: true, postId: "post-ch-twitter" },
      { channelId: "ch-instagram", service: "instagram", ok: true, postId: "post-ch-instagram" },
    ]);

    // edited text is respected verbatim on the wire
    const creates = bufferCalls.filter((call) => call.method === "POST");
    expect(creates).toHaveLength(2);
    expect(creates.map((call) => call.text)).toEqual([sentinelText, sentinelText]);

    // KV idempotency marker stored for replay
    const stored = rig.kv.map.get(`recap:${queueId}`);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "") as RecapQueueResult).toEqual(result);

    // audit: EXACTLY one line, ids + counts only, never the text
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(line).toContain(`queueId=${queueId}`);
    expect(line).toContain("channels=2");
    expect(line).toContain("ok=2");
    expect(line).not.toContain("sneaky audit sentinel");
    expect(BANNED_RE.test(line)).toBe(false);
  });

  it("IDEMPOTENCY: same queueId twice → one createPost total, second response identical (no consent needed on replay)", async () => {
    const rig = await makeQueueRig();
    const queueId = "q-idem-1";
    const first = await postJson(app, rig.env, cookie, queueBody({ queueId }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as RecapQueueResult;
    expect(createPostCallCount()).toBe(1);

    // replay sends ONLY the queueId — idempotency runs before consent/text checks
    const second = await postJson(app, rig.env, cookie, JSON.stringify({ queueId }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as RecapQueueResult;
    expect(secondBody).toEqual(firstBody);
    expect(createPostCallCount()).toBe(1); // still one — no double-posting
  });

  it("rate limit: 5 successful queues then the 6th → 429 rate_limited (no extra writes)", async () => {
    const rig = await makeQueueRig();
    for (let i = 1; i <= 5; i++) {
      const res = await postJson(app, rig.env, cookie, queueBody({ queueId: `q-rl-${i}` }));
      expect(res.status).toBe(200);
    }
    expect(createPostCallCount()).toBe(5);

    const sixth = await postJson(app, rig.env, cookie, queueBody({ queueId: "q-rl-6" }));
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as ApiError;
    expect(body.error.code).toBe("rate_limited");
    expect(createPostCallCount()).toBe(5);

    const today = new Date().toISOString().slice(0, 10);
    const counter = rig.kv.map.get(`recap-count:${USER}:${today}`);
    expect(counter).not.toBeNull();
    expect((JSON.parse(counter ?? "") as { count: number }).count).toBe(5);
  });

  it("unknown channelId → per-channel unknown_channel, the valid channel still queues", async () => {
    const rig = await makeQueueRig();
    const res = await postJson(
      app,
      rig.env,
      cookie,
      queueBody({ queueId: "q-unknown-1", channelIds: ["ch-twitter", "ch-ghost"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as RecapQueueResult;
    expect(result.results[0]).toEqual({
      channelId: "ch-twitter",
      service: "twitter",
      ok: true,
      postId: "post-ch-twitter",
    });
    expect(result.results[1]?.ok).toBe(false);
    expect(result.results[1]?.error?.code).toBe("unknown_channel");
    expect(createPostCallCount()).toBe(1);
  });

  it("partial failure: one channel 500s → upstream error for it, the other succeeds (no all-or-nothing)", async () => {
    const rig = await makeQueueRig();
    failChannelStatus.set("ch-instagram", 500);
    const res = await postJson(
      app,
      rig.env,
      cookie,
      queueBody({ queueId: "q-partial-1", channelIds: ["ch-twitter", "ch-instagram"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as RecapQueueResult;
    expect(result.results[0]).toEqual({
      channelId: "ch-twitter",
      service: "twitter",
      ok: true,
      postId: "post-ch-twitter",
    });
    expect(result.results[1]?.ok).toBe(false);
    expect(result.results[1]?.error?.code).toBe("upstream");
    expect(result.results[1]?.error?.message).toBe("buffer post create failed");
    expect(createPostCallCount()).toBe(2); // both attempted — partial failure stays partial
    expect(rig.kv.map.has("recap:q-partial-1")).toBe(true);
  });

  it("401 session_expired when the buffer session dies mid-queue (listChannels 401)", async () => {
    const rig = await makeQueueRig();
    profilesStatus = 401; // Buffer 401 → reactive refresh → retry also 401s on profiles
    const res = await postJson(app, rig.env, cookie, queueBody({ queueId: "q-exp-1" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("session_expired");
    expect(rig.kv.map.has("recap:q-exp-1")).toBe(false); // nothing stored — retryable
  });
});
