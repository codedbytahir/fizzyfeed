/**
 * Card share tests (task #5): the pure compose/validate layer, then the
 * preview + queue routes against fake D1/KV bindings with Buffer's HTTP API
 * mocked at the global fetch level. The queue mirrors routes/recap.ts
 * discipline — consent gate, 24h KV idempotency (`share:` namespace),
 * write-scope gate BEFORE the daily counter burns, 5/day cap, per-channel
 * partial results — and attaches the really-rendered card PNG as base64
 * media (node wasm fallback + disk-served woffs, render.test.ts pattern).
 *
 * The D1 fake extends helpers.FakeD1 with exactly the three statements the
 * share routes add on top of the base (posts select, ai_cache select, scopes
 * select) — anything unknown still throws, so schema drift fails loudly.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import shareRoute from "../src/worker/routes/share";
import { composeShareText, SHARE_MAX_CHARS, validateShareText } from "../src/worker/lib/share";
import { sealTokenColumns } from "../src/worker/lib/refresh";
import { setSessionCookie } from "../src/worker/lib/session";
import { BRAND_NAME } from "../src/shared/brand";
import {
  createTestRig,
  jsonResponse,
  FakeD1,
  type BoundStub,
  type FakeKV,
  type Row,
} from "./helpers";
import type { Env, HonoEnv } from "../src/worker/env";
import type { PostRow } from "../src/shared/schema";
import type {
  ApiError,
  BufferChannel,
  CardData,
  Persona,
  SharePreview,
  ShareQueueResult,
  YearStats,
} from "../src/shared/types";

const CURRENT_YEAR = new Date().getUTCFullYear();
const USER = "user-share-1";
const APP_ORIGIN = "https://app.test";
const UPGRADE_URL = "/api/auth/buffer/upgrade";
// Dummy 32-byte test key, built at runtime so no base64 secret literal is committed
// (recap.test.ts / agent-check §4 pattern) — this is not a real secret.
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");
// runtime-assembled so the banned literal never appears in source (migration.test.ts pattern)
const BANNED = ["wr", "app", "ed"].join("");
const BANNED_RE = new RegExp(BANNED, "i");

// ── compose/validate fixtures ────────────────────────────────────────────────

const STATS: YearStats = {
  year: CURRENT_YEAR,
  totals: { posts: 5214, words: 389102, channels: 3, activeDays: 210 },
  firstPost: {
    at: Date.UTC(CURRENT_YEAR, 2, 14, 9) / 1000,
    excerpt: "first post of the year — hello from the deck renderer",
    channel: "twitter",
  },
  rhythm: {
    bestDow: 2,
    favoriteHour: 23,
    postsPerWeek: 3.5,
    dowHistogram: [1, 2, 3, 4, 5, 6, 7],
    hourHistogram: Array.from({ length: 24 }, () => 0),
  },
  streaks: {
    longest: 12,
    longestStart: Date.UTC(CURRENT_YEAR, 0, 1) / 1000,
    busiestWeek: Date.UTC(CURRENT_YEAR, 0, 2) / 1000,
    busiestWeekPosts: 9,
  },
  mix: {
    channels: [
      { service: "twitter", count: 5, pct: 50.1 },
      { service: "instagram", count: 3, pct: 30.7 },
      { service: "linkedin", count: 2, pct: 19.2 },
    ],
    topTopics: ["shipping", "demos", "tea", "zen", "run"],
  },
  peaks: { bestMonth: 9, bestMonthPosts: 6, bestWeekPosts: 9, monthly: [1, 1, 1, 1, 1, 1, 1, 1, 1, 6, 1, 1] },
  daily: [],
};

const CARDS: CardData[] = [
  { n: 1, kind: "kickoff", date: "march 14", excerpt: "first post of the year — hello from the deck renderer", gradient: "bolt" },
  { n: 2, kind: "rhythm", bestDow: "tuesday", favoriteHour: "11pm", postsPerWeek: 3.5, spark: [2, 5, 9, 4, 3, 6, 1], gradient: "aurora" },
  { n: 3, kind: "streaks", longest: 12, busiestWeekPosts: 9, gradient: "fizz" },
  { n: 4, kind: "mix", channels: [{ service: "twitter", pct: 50.1 }, { service: "instagram", pct: 30.7 }, { service: "linkedin", pct: 19.2 }], topTopics: ["shipping", "demos", "tea"], gradient: "grape" },
  { n: 5, kind: "peaks", bestMonth: "october", bestMonthPosts: 6, gradient: "sunset" },
  { n: 6, kind: "persona", name: "The Midnight Archivist", origin: "posted 9 posts in a single week and never missed a tuesday", gradient: "nebula" },
  { n: 7, kind: "recap", totals: { posts: 5214, words: 389102, channels: 3, activeDays: 210 }, gradient: "coral" },
];

const SIGN_OFF = `made with ${BRAND_NAME} → ${APP_ORIGIN}`;

// ── fake D1: base + the three share/deck statements ──────────────────────────

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

class ShareD1 extends FakeD1 {
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

interface ShareRig {
  env: Env;
  db: ShareD1;
  kv: FakeKV;
}

/** Fake ASSETS binding that serves the staged woffs from disk (render.test.ts pattern). */
const FONT_BASE = new URL("../public/fonts/", (import.meta as unknown as { url: string }).url);
const fakeAssets = {
  fetch: async (req: Request): Promise<Response> => {
    try {
      // variable specifier: keeps node:fs out of the worker bundle path & tsconfig types
      const fsSpec = "node:fs";
      const { readFileSync } = (await import(/* @vite-ignore */ fsSpec)) as {
        readFileSync: (path: URL) => Uint8Array;
      };
      const file = new URL(new URL(req.url).pathname.replace(/^\/fonts\//, ""), FONT_BASE);
      const bytes = readFileSync(file);
      const body = new Uint8Array(bytes.byteLength); // plain ArrayBuffer-backed copy
      body.set(bytes);
      return new Response(body, { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  },
} as unknown as Fetcher;

/** createTestRig's env (random per-run TOKEN_AES_KEY) with the extended fakes. */
function makeRig(): ShareRig {
  const base = createTestRig();
  const db = new ShareD1();
  const env: Env = {
    ...base.env,
    DB: db as unknown as Env["DB"],
    ASSETS: fakeAssets,
    SESSION_SECRET, // fixed so loginCookie() signs what the routes verify
  };
  return { env, db, kv: base.kv };
}

function seedPosts(db: ShareD1): void {
  // same fixture family as recap.test.ts: 30 rows spread across the year →
  // 30 posts / 150 words / 2-day streak (feb 1 + feb 2) / 28 active days /
  // favorite hour 0 ("12am") / best month 0 ("january", 3 posts)
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

async function seedToken(rig: ShareRig, scopes: string): Promise<void> {
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

/** Generate a legit signed session cookie via a throwaway Hono app (recap.test.ts pattern). */
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
  media: string | null; // media[photo] form field, in-memory only
}

const bufferCalls: BufferCall[] = [];
const failChannelStatus = new Map<string, number>();
let channelsFixture: BufferChannel[] = [
  { id: "ch-twitter", service: "twitter", serviceId: "svc-1", name: "alice" },
  { id: "ch-instagram", service: "instagram", serviceId: "svc-2", name: "alice" },
];
let profilesStatus = 200;

function installBufferFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.buffer.com/1/profiles.json")) {
      bufferCalls.push({ url, method: "GET", channelId: null, text: null, media: null });
      if (profilesStatus !== 200) return jsonResponse({ error: "boom" }, profilesStatus);
      return jsonResponse(channelsFixture);
    }
    if (url.startsWith("https://api.buffer.com/1/updates/create.json")) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const channelId = form.get("profile_ids[]") ?? "";
      bufferCalls.push({
        url,
        method: "POST",
        channelId,
        text: form.get("text"),
        media: form.get("media[photo]"),
      });
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
  app.route("/api/share", shareRoute);
  return app;
}

function postJson(
  app: Hono<HonoEnv>,
  env: Env,
  cookie: string | null,
  rawBody: string
): Promise<Response> | Response {
  return app.request(
    "/api/share/queue",
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
    card: 3,
    text: `chapter 03 — streaks\nlongest streak: 2 days\n${SIGN_OFF}`,
    channelIds: ["ch-twitter"],
    consent: true,
    queueId: "q-default",
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  bufferCalls.length = 0;
  failChannelStatus.clear();
  channelsFixture = [
    { id: "ch-twitter", service: "twitter", serviceId: "svc-1", name: "alice" },
    { id: "ch-instagram", service: "instagram", serviceId: "svc-2", name: "alice" },
  ];
  profilesStatus = 200;
});

// ── composeShareText (pure, deterministic per kind) ─────────────────────────

describe("composeShareText", () => {
  it("renders the exact per-kind templates with numbers verbatim", () => {
    const [kickoff, rhythm, streaks, mix, peaks, persona, recap] = CARDS;
    expect(composeShareText(kickoff ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      [
        "chapter 01 — kickoff",
        `it started on march 14, ${CURRENT_YEAR} — first post: first post of the year — hello from the deck renderer`,
        SIGN_OFF,
      ].join("\n")
    );
    expect(composeShareText(rhythm ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      ["chapter 02 — rhythm", "tuesdays at 11pm — 3.5 posts a week", SIGN_OFF].join("\n")
    );
    expect(composeShareText(streaks ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      ["chapter 03 — streaks", "longest streak: 12 days · 9 posts in the busiest week", SIGN_OFF].join("\n")
    );
    expect(composeShareText(mix ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      [
        "chapter 04 — the mix",
        "the mix: twitter 50.1%, instagram 30.7%, linkedin 19.2% · talking about: shipping, demos, tea",
        SIGN_OFF,
      ].join("\n")
    );
    expect(composeShareText(peaks ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      ["chapter 05 — peaks", "october was the biggest month — 6 posts", SIGN_OFF].join("\n")
    );
    expect(composeShareText(persona ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      [
        "chapter 06 — alter ego",
        "alter ego: the midnight archivist — posted 9 posts in a single week and never missed a tuesday",
        SIGN_OFF,
      ].join("\n")
    );
    expect(composeShareText(recap ?? ({} as CardData), STATS, APP_ORIGIN)).toBe(
      ["chapter 07 — the recap", "5,214 posts · 389,102 words · 210 active days · 3 channels", SIGN_OFF].join("\n")
    );
  });

  it("is lowercase copy law even when card fields arrive capitalized", () => {
    const text = composeShareText(CARDS[5] ?? ({} as CardData), STATS, APP_ORIGIN);
    expect(text).toContain("alter ego: the midnight archivist");
    expect(text).toBe(text.toLowerCase());
  });

  it("ends with the app-origin link and signs off with BRAND_NAME", () => {
    for (const card of CARDS) {
      const text = composeShareText(card, STATS, APP_ORIGIN);
      expect(text.endsWith(APP_ORIGIN)).toBe(true);
      expect(text).toContain(`made with ${BRAND_NAME} →`);
    }
  });

  it("stays ≤ 500 chars for every card kind (generous origin headroom)", () => {
    // APP_ORIGIN is env config; templates leave large headroom for sane origins
    const longOrigin = `https://app.test/${"a".repeat(150)}`;
    for (const card of CARDS) {
      expect(composeShareText(card, STATS, longOrigin).length).toBeLessThanOrEqual(500);
    }
  });

  it("never contains the banned brand word", () => {
    for (const card of CARDS) {
      expect(BANNED_RE.test(composeShareText(card, STATS, APP_ORIGIN))).toBe(false);
    }
  });

  it("is deterministic: identical input → identical output", () => {
    for (const card of CARDS) {
      expect(composeShareText(card, STATS, APP_ORIGIN)).toBe(composeShareText(card, STATS, APP_ORIGIN));
    }
  });

  it("handles the unreachable-in-routes fallbacks honestly (empty kickoff, channel-less mix)", () => {
    const emptyKickoff: CardData = {
      n: 1,
      kind: "kickoff",
      date: "",
      excerpt: "not enough year yet — connect your buffer and post a little more",
      gradient: "bolt",
    };
    expect(composeShareText(emptyKickoff, STATS, APP_ORIGIN)).toContain(`your ${CURRENT_YEAR} in posts`);
    const bareMix: CardData = { n: 4, kind: "mix", channels: [], topTopics: [], gradient: "grape" };
    expect(composeShareText(bareMix, STATS, APP_ORIGIN)).toContain("the mix: no channel breakdown yet");
  });
});

// ── validateShareText ────────────────────────────────────────────────────────

describe("validateShareText", () => {
  it("accepts exactly 500 chars", () => {
    expect(SHARE_MAX_CHARS).toBe(500);
    expect(validateShareText("a".repeat(500))).toEqual({ ok: true });
  });

  it("rejects 501 chars with the exceeds reason", () => {
    const verdict = validateShareText("a".repeat(501));
    expect(verdict).toEqual({ ok: false, reason: "text exceeds 500 characters" });
  });

  it("rejects empty and whitespace-only text", () => {
    expect(validateShareText("")).toEqual({ ok: false, reason: "text is empty" });
    expect(validateShareText("   \n  ")).toEqual({ ok: false, reason: "text is empty" });
  });

  it("rejects control characters (except \\n and \\t) and DEL", () => {
    for (const bad of ["bad\u0001char", "a\u0000b", "x\u001by", "esc\u001b[31m", "cr\r lf", "del\u007fete"]) {
      const verdict = validateShareText(bad);
      expect(verdict).toEqual({ ok: false, reason: "text contains control characters" });
    }
  });

  it("accepts multi-line, tabbed, honest copy", () => {
    expect(validateShareText("chapter 03 — streaks\nlongest streak: 2 days\t· made with tea")).toEqual({
      ok: true,
    });
  });
});

// ── GET /api/share/preview ───────────────────────────────────────────────────

describe("GET /api/share/preview", () => {
  const app = makeApp();
  let cookie: string;

  beforeAll(async () => {
    cookie = await loginCookie(SESSION_SECRET);
  });

  beforeEach(() => {
    installBufferFetch();
  });

  async function makePreviewRig(scopes: string, persona: Persona | null, posts = true): Promise<ShareRig> {
    const rig = makeRig();
    if (posts) seedPosts(rig.db);
    rig.db.personaRow = persona ? { payload_json: JSON.stringify(persona) } : null;
    await seedToken(rig, scopes);
    return rig;
  }

  const PERSONA: Persona = {
    name: "the midnight archivist",
    origin: "posted 21 posts in a single week and never missed a tuesday",
    traits: ["archival", "night owl", "curious"],
  };

  it("401 no_session without a session cookie", async () => {
    const rig = await makePreviewRig("read", null);
    const res = await app.request("/api/share/preview?card=3", {}, rig.env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
    expect(bufferCalls).toHaveLength(0);
  });

  it("404 not_found for unknown card numbers and junk params", async () => {
    const rig = await makePreviewRig("read", null);
    for (const card of ["0", "8", "abc", "3.5", ""]) {
      const res = await app.request(`/api/share/preview?card=${card}`, { headers: { Cookie: cookie } }, rig.env);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe("unknown card");
    }
    const missing = await app.request("/api/share/preview", { headers: { Cookie: cookie } }, rig.env);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiError).error.code).toBe("not_found");
    expect(bufferCalls).toHaveLength(0); // validation precedes any Buffer call
  });

  it("404 card_unavailable when the card is not in the deck (no persona → no card 6)", async () => {
    const rig = await makePreviewRig("read", null);
    const res = await app.request("/api/share/preview?card=6", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("card_unavailable");
    expect(bufferCalls).toHaveLength(0);
  });

  it("409 empty_deck when the account has no posts yet (before any Buffer call)", async () => {
    const rig = makeRig(); // no posts, no token row — Buffer must never be reached
    const res = await app.request("/api/share/preview?card=1", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("empty_deck");
    expect(body.error.message).toBe("your deck isn't ready to share yet");
    expect(bufferCalls).toHaveLength(0);
  });

  it("returns honest card text, channels, and needsWriteScope (scopes=read)", async () => {
    const rig = await makePreviewRig("read", null);
    const res = await app.request("/api/share/preview?card=3", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as SharePreview;
    expect(preview.cardN).toBe(3);
    // honest numbers from the seeded 30-post fixture (recap.test.ts cross-check)
    expect(preview.text).toContain("longest streak: 2 days");
    expect(preview.text.endsWith(APP_ORIGIN)).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(500);
    expect(BANNED_RE.test(preview.text)).toBe(false);
    // channels come from the mocked Buffer listChannels
    expect(preview.channels.map((ch) => ch.id)).toEqual(["ch-twitter", "ch-instagram"]);
    expect(preview.needsWriteScope).toBe(true);
    expect(bufferCalls).toHaveLength(1); // profiles.json only
  });

  it("honest numbers appear for kickoff/rhythm/peaks/recap previews", async () => {
    const rig = await makePreviewRig("read write", null);
    const expectations: [number, string[]][] = [
      [1, ["it started on january 1", "first post: post number 0 about shipping"]],
      [2, ["12am", "0.6 posts a week"]], // 30 posts / 52 weeks → 0.6
      [5, ["january was the biggest month — 3 posts"]],
      [7, ["30 posts · 150 words"]],
    ];
    for (const [card, fragments] of expectations) {
      const res = await app.request(`/api/share/preview?card=${card}`, { headers: { Cookie: cookie } }, rig.env);
      expect(res.status).toBe(200);
      const preview = (await res.json()) as SharePreview;
      for (const fragment of fragments) {
        expect(preview.text).toContain(fragment);
      }
    }
  });

  it("needsWriteScope false with scopes='read write'; persona card shares the alter ego", async () => {
    const rig = await makePreviewRig("read write", PERSONA);
    const res3 = await app.request("/api/share/preview?card=3", { headers: { Cookie: cookie } }, rig.env);
    expect(((await res3.json()) as SharePreview).needsWriteScope).toBe(false);
    const res6 = await app.request("/api/share/preview?card=6", { headers: { Cookie: cookie } }, rig.env);
    expect(res6.status).toBe(200);
    const preview = (await res6.json()) as SharePreview;
    expect(preview.cardN).toBe(6);
    expect(preview.text).toContain("alter ego: the midnight archivist");
  });

  it("401 session_expired when buffer is not connected (no token row)", async () => {
    const rig = makeRig();
    seedPosts(rig.db);
    const res = await app.request("/api/share/preview?card=3", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("session_expired");
  });

  it("502 upstream when the Buffer channels fetch fails", async () => {
    const rig = await makePreviewRig("read", null);
    profilesStatus = 500;
    const res = await app.request("/api/share/preview?card=3", { headers: { Cookie: cookie } }, rig.env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("upstream");
  });
});

// ── POST /api/share/queue ────────────────────────────────────────────────────

describe("POST /api/share/queue", () => {
  const app = makeApp();
  let cookie: string;

  beforeAll(async () => {
    cookie = await loginCookie(SESSION_SECRET);
  });

  beforeEach(() => {
    installBufferFetch();
  });

  async function makeQueueRig(scopes = "read write", persona: Persona | null = null): Promise<ShareRig> {
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

  it("400 malformed on bad JSON and non-object bodies", async () => {
    const rig = await makeQueueRig();
    for (const raw of ["{not json", "[1,2]", "null", "42", '"nope"']) {
      const res = await postJson(app, rig.env, cookie, raw);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("malformed");
    }
    expect(bufferCalls).toHaveLength(0);
  });

  it("400 invalid_queue when queueId is missing or not a string", async () => {
    const rig = await makeQueueRig();
    for (const queueId of [undefined, 12345]) {
      const res = await postJson(app, rig.env, cookie, queueBody({ queueId }));
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

  it("400 text_invalid for 501 chars, empty text, and control characters", async () => {
    const rig = await makeQueueRig();
    const long = await postJson(app, rig.env, cookie, queueBody({ text: "x".repeat(501) }));
    expect(long.status).toBe(400);
    expect(((await long.json()) as ApiError).error.message).toBe("text exceeds 500 characters");

    const empty = await postJson(app, rig.env, cookie, queueBody({ text: "  " }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as ApiError).error.message).toBe("text is empty");

    const control = await postJson(app, rig.env, cookie, queueBody({ text: "bad\u0002text" }));
    expect(control.status).toBe(400);
    expect(((await control.json()) as ApiError).error.message).toBe("text contains control characters");
    expect(bufferCalls).toHaveLength(0);
  });

  it("400 no_channels when channelIds is empty, non-array, or has no strings", async () => {
    const rig = await makeQueueRig();
    for (const channelIds of [[], "ch-twitter", 7, [42, null]]) {
      const res = await postJson(app, rig.env, cookie, queueBody({ channelIds }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("no_channels");
      expect(body.error.message).toBe("pick at least one channel");
    }
    expect(bufferCalls).toHaveLength(0);
  });

  it("403 upgrade_required with the auth upgradeUrl when write scope is missing — and the daily counter is NOT burned", async () => {
    const rig = await makeQueueRig("read");
    const res = await postJson(app, rig.env, cookie, queueBody({}));
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiError & { error: { upgradeUrl?: string } };
    expect(body.error.code).toBe("upgrade_required");
    expect(body.error.message).toBe("connect with write access to share the card");
    expect(body.error.upgradeUrl).toBe(UPGRADE_URL);
    expect(bufferCalls).toHaveLength(0); // scope gate precedes any Buffer call
    const burned = [...rig.kv.map.keys()].filter((k) => k.startsWith(`share-count:${USER}:`));
    expect(burned).toEqual([]); // quota untouched by upgrade-required attempts
  });

  it("happy path: queues 2 channels with the card PNG attached, stores the marker, audits ids + counts only", async () => {
    const rig = await makeQueueRig();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const queueId = "q-share-happy-1";
    const sentinelText = "sneaky audit sentinel — the shared card body itself";
    const res = await postJson(
      app,
      rig.env,
      cookie,
      queueBody({ queueId, text: sentinelText, channelIds: ["ch-twitter", "ch-instagram"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as ShareQueueResult;
    expect(result.queueId).toBe(queueId);
    expect(result.results).toEqual([
      { channelId: "ch-twitter", service: "twitter", ok: true, postId: "post-ch-twitter" },
      { channelId: "ch-instagram", service: "instagram", ok: true, postId: "post-ch-instagram" },
    ]);

    // edited text + media travel verbatim on the wire
    const creates = bufferCalls.filter((call) => call.method === "POST");
    expect(creates).toHaveLength(2);
    for (const call of creates) {
      expect(call.text).toBe(sentinelText);
      expect(call.media).not.toBeNull();
      expect(call.media?.length ?? 0).toBeGreaterThan(1000); // a real PNG, not a stub
      expect((call.media ?? "").startsWith("iVBORw0KGgo")).toBe(true); // PNG magic bytes in base64
    }

    // KV idempotency marker stored for replay
    const stored = rig.kv.map.get(`share:${queueId}`);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "") as ShareQueueResult).toEqual(result);

    // audit: EXACTLY one line, ids + counts only — never the text, never image bytes
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(line).toContain(`queueId=${queueId}`);
    expect(line).toContain("card=3");
    expect(line).toContain("channels=2");
    expect(line).toContain("ok=2");
    expect(line).not.toContain("sneaky audit sentinel");
    expect(line).not.toContain("iVBOR");
    expect(BANNED_RE.test(line)).toBe(false);
  });

  it("IDEMPOTENCY: same queueId twice → one createPost total, replay needs no consent and returns the first result", async () => {
    const rig = await makeQueueRig();
    const queueId = "q-share-idem-1";
    const first = await postJson(app, rig.env, cookie, queueBody({ queueId }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ShareQueueResult;
    expect(createPostCallCount()).toBe(1);

    // replay sends ONLY the queueId — idempotency runs before consent/text checks
    const second = await postJson(app, rig.env, cookie, JSON.stringify({ queueId }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ShareQueueResult;
    expect(secondBody).toEqual(firstBody);
    expect(createPostCallCount()).toBe(1); // still one — no double-posting
  });

  it("rate limit: 5 successful queues then the 6th → 429 rate_limited (no extra writes)", async () => {
    const rig = await makeQueueRig();
    for (let i = 1; i <= 5; i++) {
      const res = await postJson(app, rig.env, cookie, queueBody({ queueId: `q-share-rl-${i}` }));
      expect(res.status).toBe(200);
    }
    expect(createPostCallCount()).toBe(5);

    const sixth = await postJson(app, rig.env, cookie, queueBody({ queueId: "q-share-rl-6" }));
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as ApiError;
    expect(body.error.code).toBe("rate_limited");
    expect(createPostCallCount()).toBe(5);

    const today = new Date().toISOString().slice(0, 10);
    const counter = rig.kv.map.get(`share-count:${USER}:${today}`);
    expect(counter).not.toBeNull();
    expect((JSON.parse(counter ?? "") as { count: number }).count).toBe(5);
  });

  it("unknown channelId → per-channel unknown_channel, the valid channel still queues", async () => {
    const rig = await makeQueueRig();
    const res = await postJson(
      app,
      rig.env,
      cookie,
      queueBody({ queueId: "q-share-unknown-1", channelIds: ["ch-twitter", "ch-ghost"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as ShareQueueResult;
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
      queueBody({ queueId: "q-share-partial-1", channelIds: ["ch-twitter", "ch-instagram"] })
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as ShareQueueResult;
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
    expect(rig.kv.map.has("share:q-share-partial-1")).toBe(true);
  });

  it("404 card_unavailable when the card is not in the deck (no persona → no card 6)", async () => {
    const rig = await makeQueueRig();
    const res = await postJson(app, rig.env, cookie, queueBody({ card: 6, queueId: "q-share-nocard-1" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("card_unavailable");
    expect(bufferCalls).toHaveLength(0); // never reaches Buffer without a card
  });

  it("404 not_found for out-of-range or wrongly-typed card values", async () => {
    const rig = await makeQueueRig();
    for (const card of [99, 0, "3"]) {
      const res = await postJson(app, rig.env, cookie, queueBody({ card, queueId: "q-share-badcard" }));
      expect(res.status).toBe(404);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe("unknown card");
    }
  });

  it("401 session_expired when the buffer session dies mid-queue (listChannels 401)", async () => {
    const rig = await makeQueueRig();
    profilesStatus = 401; // Buffer 401 → reactive refresh → retry also 401s on profiles
    const res = await postJson(app, rig.env, cookie, queueBody({ queueId: "q-share-exp-1" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("session_expired");
    expect(rig.kv.map.has("share:q-share-exp-1")).toBe(false); // nothing stored — retryable
  });
});
