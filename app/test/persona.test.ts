/**
 * Persona tests (spec 05, tasks T14/T15): the pure naming core (prompt, strict
 * parse/guardrails, deterministic fallback), generatePersona's repair path
 * against a scripted fake AI binding, and the /api/persona routes over fake
 * D1/KV bindings with a mocked Buffer client.
 *
 * The banned brand word never appears literally in source (AGENTS.md §1) — it
 * is assembled at runtime, exactly like test/migration.test.ts. Trademark
 * product names get the same treatment.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { setSessionCookie } from "../src/worker/lib/session";
import type { Env, HonoEnv } from "../src/worker/env";
import type { Persona, YearStats } from "../src/shared/types";
import type { PostRow } from "../src/shared/schema";
import { computeYearStats } from "../src/worker/lib/yearize";
import { sealTokenColumns } from "../src/worker/lib/refresh";
import {
  PERSONA_MODEL,
  PERSONA_SYSTEM_PROMPT,
  buildPrompt,
  fallbackPersona,
  generatePersona,
  parsePersona,
  sampleExposts,
} from "../src/worker/lib/persona";
import personaRoute from "../src/worker/routes/persona";
import { FakeD1, FakeKV, createTestRig, type TestRig } from "./helpers";

const BANNED = ["wr", "app", "ed"].join(""); // runtime-assembled (AGENTS.md §1)
const CURRENT_YEAR = new Date().getUTCFullYear();

// ── fixtures ────────────────────────────────────────────────────────────────

function makeStats(year = CURRENT_YEAR): YearStats {
  return {
    year,
    totals: { posts: 214, words: 18220, channels: 3, activeDays: 121 },
    firstPost: { at: Date.UTC(year, 0, 6, 23) / 1000, excerpt: "first post of the year", channel: "twitter" },
    rhythm: {
      bestDow: 2,
      favoriteHour: 23, // 11pm
      postsPerWeek: 4.1,
      dowHistogram: [30, 40, 44, 25, 25, 30, 20],
      hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 23 ? 40 : 7)),
    },
    streaks: {
      longest: 18,
      longestStart: Date.UTC(year, 3, 1) / 1000,
      busiestWeek: Date.UTC(year, 9, 6) / 1000,
      busiestWeekPosts: 11,
    },
    mix: {
      channels: [
        { service: "twitter", count: 120, pct: 56.1 },
        { service: "instagram", count: 60, pct: 28 },
        { service: "linkedin", count: 34, pct: 15.9 },
      ],
      topTopics: ["shipping", "demos", "tea", "wasm", "quiet"],
    },
    peaks: {
      bestMonth: 9,
      bestMonthPosts: 31,
      bestWeekPosts: 9,
      monthly: [10, 12, 14, 16, 18, 20, 22, 24, 26, 31, 10, 11],
    },
    daily: [],
  };
}

const VALID_PERSONA: Persona = {
  name: "the midnight archivist",
  origin: "posted 214 nights after 11pm — consistency masquerading as insomnia",
  traits: ["night-shift poet", "streak keeper", "quiet volume"],
};

/**
 * Pull the JSON payload back out of a user prompt: the payload is the first
 * {...} block, but the trailing schema instruction also contains braces, so
 * shrink from the right until the slice parses.
 */
function payloadOf(user: string): Record<string, unknown> {
  const start = user.indexOf("{");
  for (let end = user.lastIndexOf("}"); end > start; end = user.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(user.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      // shrink and retry
    }
  }
  throw new Error("no JSON payload found in prompt");
}

// ── fake AI binding ─────────────────────────────────────────────────────────

interface FakeAiCall {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

interface FakeAi {
  ai: Ai;
  calls: FakeAiCall[];
}

/** Scripted AI: entry i answers call i (last entry repeats); Error entries throw. */
function makeFakeAi(script: (string | Error)[]): FakeAi {
  const calls: FakeAiCall[] = [];
  const ai = {
    run: async (model: string, inputs: unknown) => {
      const inp = inputs as { messages?: FakeAiCall["messages"]; temperature?: number; max_tokens?: number };
      calls.push({
        model,
        messages: inp.messages ?? [],
        temperature: inp.temperature,
        max_tokens: inp.max_tokens,
      });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (step instanceof Error) throw step;
      return { response: step };
    },
  };
  return { ai: ai as unknown as Ai, calls };
}

function envWithAi(base: Env, ai: Ai): Env {
  return { ...base, AI: ai };
}

// ── buildPrompt ─────────────────────────────────────────────────────────────

describe("buildPrompt", () => {
  const stats = makeStats();

  it("system prompt matches spec 05 §3 verbatim", () => {
    const { system } = buildPrompt(stats, []);
    expect(system).toBe(PERSONA_SYSTEM_PROMPT);
    expect(system).toBe(
      "You name a social posting alter ego from real, honest posting statistics. Be playful-precise, never hype. Lowercase names. Two to four words. No emoji in the name."
    );
  });

  it("carries the honest stats payload and a JSON-only instruction", () => {
    const { user } = buildPrompt(stats, ["a".repeat(100), "short one"]);
    const payload = payloadOf(user) as {
      totals: { posts: number; activeDays: number };
      rhythm: { favoriteHour: number; postsPerWeek: number; bestDow: number };
      streaks: { longest: number; busiestWeekPosts: number };
      mix: { channels: unknown[]; topTopics: string[] };
      peaks: { bestMonthPosts: number };
      excerpts: string[];
    };
    expect(payload.totals.posts).toBe(214);
    expect(payload.totals.activeDays).toBe(121);
    expect(payload.rhythm).toEqual({ bestDow: 2, favoriteHour: 23, postsPerWeek: 4.1 });
    expect(payload.streaks).toEqual({ longest: 18, busiestWeekPosts: 11 });
    expect(payload.mix.channels).toHaveLength(3); // top-3 channels
    expect(payload.peaks.bestMonthPosts).toBe(31);
    expect(payload.excerpts).toEqual(["a".repeat(80), "short one"]);
    expect(user).toMatch(/ONLY valid JSON/);
    expect(user).toContain('"traits"');
  });

  it("caps excerpts at 40 and every excerpt at 80 chars, even for long inputs", () => {
    const many = Array.from({ length: 55 }, (_, i) => `excerpt ${i} ${"x".repeat(120)}`);
    const { user } = buildPrompt(stats, many);
    const payload = payloadOf(user) as { excerpts: string[] };
    expect(payload.excerpts).toHaveLength(40);
    for (const e of payload.excerpts) expect(e.length).toBeLessThanOrEqual(80);
  });
});

// ── parsePersona ────────────────────────────────────────────────────────────

describe("parsePersona", () => {
  const stats = makeStats();

  it("accepts a valid persona", () => {
    expect(parsePersona(JSON.stringify(VALID_PERSONA), stats)).toEqual(VALID_PERSONA);
  });

  it("accepts a fenced json block", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_PERSONA) + "\n```";
    expect(parsePersona(fenced, stats)).toEqual(VALID_PERSONA);
  });

  it("accepts a plain ``` fence", () => {
    const fenced = "```\n" + JSON.stringify(VALID_PERSONA) + "\n```";
    expect(parsePersona(fenced, stats)).toEqual(VALID_PERSONA);
  });

  it("rejects uppercase names", () => {
    const bad = { ...VALID_PERSONA, name: "The Midnight Archivist" };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects 29-char names", () => {
    const bad = { ...VALID_PERSONA, name: "a".repeat(29) };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects 1-char names (minimum two)", () => {
    const bad = { ...VALID_PERSONA, name: "x" };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects the banned brand-conflict word in the name", () => {
    const bad = { ...VALID_PERSONA, name: `the ${BANNED} collector` };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects trademarked product names in the name", () => {
    const bad = { ...VALID_PERSONA, name: `the ${["spo", "tify"].join("")} chronicler` };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects 91-char origins", () => {
    const origin = "posted 214 times this year — " + "a".repeat(62);
    expect(origin.length).toBe(91);
    const bad = { ...VALID_PERSONA, origin };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("accepts a 90-char origin at the boundary", () => {
    const origin = "posted 214 times this year — " + "a".repeat(61);
    expect(origin.length).toBe(90);
    const ok = { ...VALID_PERSONA, origin };
    expect(parsePersona(JSON.stringify(ok), stats)).not.toBeNull();
  });

  it("rejects origins citing no real stat number", () => {
    const origin = "a quiet year of thinking out loud and posting gently into the evening";
    const bad = { ...VALID_PERSONA, origin };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects origins citing numbers that are not in YearStats", () => {
    const bad = { ...VALID_PERSONA, origin: "posted about 7 cats across 4 timelines" };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects 2 or 4 traits", () => {
    expect(
      parsePersona(JSON.stringify({ ...VALID_PERSONA, traits: ["a", "b"] }), stats)
    ).toBeNull();
    expect(
      parsePersona(JSON.stringify({ ...VALID_PERSONA, traits: ["a", "b", "c", "d"] }), stats)
    ).toBeNull();
  });

  it("rejects traits longer than 18 chars", () => {
    const bad = { ...VALID_PERSONA, traits: ["ok", "fine", "a".repeat(19)] };
    expect(parsePersona(JSON.stringify(bad), stats)).toBeNull();
  });

  it("rejects garbage strings", () => {
    expect(parsePersona("not json at all", stats)).toBeNull();
    expect(parsePersona("42", stats)).toBeNull();
    expect(parsePersona("", stats)).toBeNull();
  });
});

// ── fallbackPersona ─────────────────────────────────────────────────────────

describe("fallbackPersona", () => {
  const stats = makeStats();

  it("is deterministic — two calls deep-equal", () => {
    expect(fallbackPersona(stats)).toEqual(fallbackPersona(stats));
  });

  it("names the favorite hour and cites real stats in the origin", () => {
    const p = fallbackPersona(stats);
    expect(p.name).toBe("the 11pmo'clock regular");
    expect(p.name).not.toMatch(/[A-Z]/);
    expect(p.name.length).toBeLessThanOrEqual(28);
    expect(p.origin.length).toBeLessThanOrEqual(90);
    expect(p.origin).toContain("214"); // totals.posts
    expect(p.origin).toContain("4.1"); // postsPerWeek
    expect(p.traits).toHaveLength(3);
    for (const t of p.traits) expect(t.length).toBeLessThanOrEqual(18);
    expect(JSON.stringify(p)).not.toContain(BANNED); // full-page honesty
  });

  it("tolerates zeroed stats without failing", () => {
    const zero = makeStats();
    zero.totals = { posts: 0, words: 0, channels: 0, activeDays: 0 };
    zero.rhythm.favoriteHour = 0;
    zero.rhythm.postsPerWeek = 0;
    const p = fallbackPersona(zero);
    expect(p.name).toBe("the 12amo'clock regular");
    expect(p.origin).toContain("0");
    expect(JSON.stringify(p)).not.toContain(BANNED);
  });
});

// ── sampleExposts ───────────────────────────────────────────────────────────

describe("sampleExposts", () => {
  it("takes the first 40 of a newest-first list and truncates to 80 chars", () => {
    const posts = Array.from({ length: 60 }, (_, i) => ({ text: `post ${i} ${"y".repeat(120)}` }));
    const out = sampleExposts(posts);
    expect(out).toHaveLength(40);
    expect(out[0]).toBe(`post 0 ${"y".repeat(73)}`); // 7-char prefix + 73 = 80
    for (const t of out) expect(t.length).toBeLessThanOrEqual(80);
  });

  it("is deterministic and skips empty texts", () => {
    const posts = [{ text: "" }, { text: "hello world" }, { text: "   " }];
    expect(sampleExposts(posts)).toEqual(["hello world"]);
    expect(sampleExposts(posts)).toEqual(sampleExposts(posts));
  });
});

// ── generatePersona ─────────────────────────────────────────────────────────

describe("generatePersona", () => {
  const stats = makeStats();
  const excerpts = ["morning pages about coffee", "shipping notes", "a long thought ".repeat(10)];

  it("parses a valid first response with a single AI call at spec params", async () => {
    const rig = createTestRig();
    const fake = makeFakeAi([JSON.stringify(VALID_PERSONA)]);
    const p = await generatePersona(envWithAi(rig.env, fake.ai), stats, excerpts);
    expect(p).toEqual(VALID_PERSONA);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.model).toBe(PERSONA_MODEL);
    expect(fake.calls[0]?.temperature).toBe(0.7);
    expect(fake.calls[0]?.max_tokens).toBe(200);
  });

  it("repairs once when the first response is malformed (AI called exactly 2x)", async () => {
    const rig = createTestRig();
    const fake = makeFakeAi(["not json", JSON.stringify(VALID_PERSONA)]);
    const p = await generatePersona(envWithAi(rig.env, fake.ai), stats, excerpts);
    expect(p).toEqual(VALID_PERSONA);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.messages[1]?.content).toContain("Return ONLY valid JSON matching the schema.");
  });

  it("falls back deterministically when both responses are malformed", async () => {
    const rig = createTestRig();
    const fake = makeFakeAi(["garbage", "still garbage"]);
    const p = await generatePersona(envWithAi(rig.env, fake.ai), stats, excerpts);
    expect(p).toEqual(fallbackPersona(stats));
    expect(fake.calls).toHaveLength(2);
  });

  it("falls back without throwing when the AI binding itself fails", async () => {
    const rig = createTestRig();
    const fake = makeFakeAi([new Error("ai down"), new Error("ai still down")]);
    const p = await generatePersona(envWithAi(rig.env, fake.ai), stats, excerpts);
    expect(p).toEqual(fallbackPersona(stats));
  });

  it("SENTINEL: no excerpt longer than 80 chars ever reaches the model", async () => {
    const rig = createTestRig();
    const fake = makeFakeAi([JSON.stringify(VALID_PERSONA)]);
    const long = Array.from({ length: 50 }, (_, i) => `post ${i} ${"lorem ipsum dolor sit amet ".repeat(8)}`);
    await generatePersona(envWithAi(rig.env, fake.ai), stats, long);
    expect(fake.calls).toHaveLength(1);
    const user = fake.calls[0]?.messages[1]?.content ?? "";
    const payload = payloadOf(user) as { excerpts: string[] };
    expect(payload.excerpts.length).toBeLessThanOrEqual(40);
    for (const e of payload.excerpts) {
      expect(e.length).toBeGreaterThan(0);
      expect(e.length).toBeLessThanOrEqual(80);
    }
  });

  it("never lets the banned brand word through even if the model emits it", async () => {
    const rig = createTestRig();
    const poisoned = JSON.stringify({ ...VALID_PERSONA, name: `the ${BANNED} king` });
    const fake = makeFakeAi([poisoned, poisoned]);
    const p = await generatePersona(envWithAi(rig.env, fake.ai), stats, excerpts);
    expect(JSON.stringify(p)).not.toContain(BANNED);
    expect(p).toEqual(fallbackPersona(stats));
  });
});

// ── route rig ───────────────────────────────────────────────────────────────

const ROUTE_USER = "user-persona-1";
// Dummy 32-byte test key built at runtime — not a committed secret (agent-check §4 pattern).
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");

interface DbFixture {
  posts: PostRow[];
  personaRow: string | null;
  writes: string[];
}

function routeRows(userId = ROUTE_USER): PostRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const at = Date.UTC(CURRENT_YEAR, i % 12, (i % 25) + 1, i < 6 ? 23 : (i * 3) % 20) / 1000;
    const d = new Date(at * 1000);
    return {
      id: `rp${i}`,
      user_id: userId,
      channel_id: `ch${i % 2}`,
      channel_service: i % 2 === 0 ? "twitter" : "instagram",
      text: `buffer post number ${i} about coffee and shipping`,
      created_at: at,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      dow: d.getUTCDay(),
      hour: d.getUTCHours(),
    };
  });
}

/** Persona JSON whose origin cites numbers from the real route-post aggregates. */
function routePersonaJson(): string {
  const stats = computeYearStats(routeRows(), CURRENT_YEAR);
  return JSON.stringify({
    name: "the midnight archivist",
    origin: `posted ${stats.totals.posts} times this year — ${stats.rhythm.postsPerWeek} posts a week`,
    traits: ["night-shift poet", "streak keeper", "quiet volume"],
  });
}

function stubStmt(handlers: { first?: () => Promise<unknown>; all?: () => Promise<unknown> }) {
  return {
    bind: () => ({
      first: handlers.first ?? (async () => null),
      all: handlers.all ?? (async () => ({ results: [] })),
      run: async () => ({ success: true as const }),
    }),
  };
}

/** FakeD1 for users/tokens + posts/ai_cache statements the persona route issues. */
function wrapDb(base: FakeD1, fx: DbFixture): Env["DB"] {
  return {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.includes("FROM posts")) {
        return stubStmt({ all: async () => ({ results: fx.posts }) });
      }
      if (q.startsWith("SELECT payload_json FROM ai_cache")) {
        return stubStmt({
          first: async () => (fx.personaRow === null ? null : { payload_json: fx.personaRow }),
        });
      }
      if (q.startsWith("INSERT INTO ai_cache")) {
        return {
          bind: (...params: unknown[]) => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              const payload = params[2];
              fx.personaRow = String(payload);
              fx.writes.push(String(payload));
              return { success: true as const };
            },
          }),
        };
      }
      return base.prepare(sql); // buffer_tokens etc. via the real fake
    },
  } as unknown as Env["DB"];
}

/** FakeKV storage + the "json" read mode real KV has (debounce needs it). */
function jsonKv(base: FakeKV): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = await base.get(key);
      if (v === null || type !== "json") return v;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return null;
      }
    },
    put: async (key: string, value: string) => {
      await base.put(key, value);
    },
    delete: async (key: string) => {
      await base.delete(key);
    },
  } as unknown as KVNamespace;
}

// Mocked Buffer client — the persona route only samples via listChannels/listPosts.
const bufferBehavior = vi.hoisted(() => ({ fail: false }));
const BUFFER_POSTS = vi.hoisted(() =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `bp${i}`,
    channelId: "ch-1",
    service: "twitter",
    text: `buffer sample post ${i} about late night shipping`,
    createdAt: 1_700_000_100 - i * 60,
  }))
);

vi.mock("../src/worker/lib/buffer", () => ({
  BufferApiError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
      this.name = "BufferApiError";
    }
  },
  createBufferClient: () => ({
    getProfile: async () => ({ id: "u1", name: "tester" }),
    listChannels: async () => {
      if (bufferBehavior.fail) {
        throw Object.assign(new Error("buffer profiles down"), { status: 502 });
      }
      return [{ id: "ch-1", service: "twitter", serviceId: "s-1", name: "tester" }];
    },
    listPosts: async () => ({ posts: BUFFER_POSTS, hasMore: false }),
    createPost: async () => ({ id: "created-1" }),
    refreshAccessToken: async () => {
      throw new Error("token refresh unused in persona tests");
    },
  }),
}));

function makeRouteEnv(
  fx: DbFixture,
  fake: FakeAi
): { env: Env; rig: TestRig } {
  const rig = createTestRig();
  const env: Env = {
    ...rig.env,
    SESSION_SECRET, // same dummy key the login cookie is signed with
    DB: wrapDb(rig.db, fx),
    CACHE: jsonKv(rig.kv),
    AI: fake.ai,
  };
  return { env, rig };
}

async function seedToken(rig: TestRig, userId: string): Promise<void> {
  const cols = await sealTokenColumns(rig.env.TOKEN_AES_KEY, userId, "at-persona-test", "rt-persona-test");
  rig.db.tokens.set(userId, {
    user_id: userId,
    access_enc: cols.accessEnc,
    refresh_enc: cols.refreshEnc,
    iv: cols.iv,
    salt: cols.salt,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scopes: "read",
    rotated_at: 0,
  });
}

async function loginCookie(userId: string): Promise<string> {
  const app = new Hono<HonoEnv>();
  app.get("/login", async (c) => {
    await setSessionCookie(c, userId);
    return c.text("ok");
  });
  const res = await app.request("/login", {}, { SESSION_SECRET } as unknown as HonoEnv["Bindings"]);
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("session cookie missing from login response");
  return setCookie.slice(0, setCookie.indexOf(";"));
}

function makeApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/api/persona", personaRoute);
  return app;
}

// ── POST /api/persona ───────────────────────────────────────────────────────

describe("POST /api/persona", () => {
  let app: Hono<HonoEnv>;
  let cookie: string;

  beforeAll(async () => {
    app = makeApp();
    cookie = await loginCookie(ROUTE_USER);
  });

  it("401 no_session without a session cookie", async () => {
    const { env } = makeRouteEnv({ posts: routeRows(), personaRow: null, writes: [] }, makeFakeAi([]));
    const res = await app.request("/api/persona", { method: "POST" }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_session");
  });

  it("cache hit returns the cached persona with zero AI calls", async () => {
    const fake = makeFakeAi([JSON.stringify(VALID_PERSONA)]);
    const { env } = makeRouteEnv(
      { posts: [], personaRow: JSON.stringify(VALID_PERSONA), writes: [] },
      fake
    );
    const res = await app.request("/api/persona", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persona: Persona };
    expect(body.persona).toEqual(VALID_PERSONA);
    expect(fake.calls).toHaveLength(0); // spy run count 0 — no AI on the hit path
    expect(JSON.stringify(body.persona)).not.toContain(BANNED);
  });

  it("cache miss calls the AI once, samples buffer excerpts, and writes ai_cache", async () => {
    const fake = makeFakeAi([routePersonaJson()]);
    const fx: DbFixture = { posts: routeRows(), personaRow: null, writes: [] };
    const { env, rig } = makeRouteEnv(fx, fake);
    await seedToken(rig, ROUTE_USER);

    const res = await app.request("/api/persona", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persona: Persona };
    expect(body.persona.name).toBe("the midnight archivist");
    expect(fake.calls).toHaveLength(1);

    // excerpt sentinel at the route layer too
    const user = fake.calls[0]?.messages[1]?.content ?? "";
    const payload = payloadOf(user) as { excerpts: string[] };
    expect(payload.excerpts.length).toBeGreaterThan(0);
    for (const e of payload.excerpts) expect(e.length).toBeLessThanOrEqual(80);

    expect(fx.writes).toHaveLength(1);
    expect(JSON.parse(fx.writes[0] ?? "{}")).toEqual(body.persona);

    // rapid second POST → debounced before anything else
    const res2 = await app.request("/api/persona", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(res2.status).toBe(429);
    const err2 = (await res2.json()) as { error: { code: string } };
    expect(err2.error.code).toBe("rate_limited");
  });

  it("cache miss without a buffer token → 401 session_expired, no AI call", async () => {
    const fake = makeFakeAi([routePersonaJson()]);
    const { env } = makeRouteEnv({ posts: routeRows(), personaRow: null, writes: [] }, fake);
    const res = await app.request("/api/persona", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("session_expired");
    expect(fake.calls).toHaveLength(0);
  });

  it("buffer outage degrades honestly: persona from stats alone", async () => {
    bufferBehavior.fail = true;
    try {
      const fake = makeFakeAi([routePersonaJson()]);
      const fx: DbFixture = { posts: routeRows(), personaRow: null, writes: [] };
      const { env, rig } = makeRouteEnv(fx, fake);
      await seedToken(rig, ROUTE_USER);
      const res = await app.request("/api/persona", { method: "POST", headers: { Cookie: cookie } }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { persona: Persona };
      expect(body.persona.name).toBe("the midnight archivist");
      const user = fake.calls[0]?.messages[1]?.content ?? "";
      const payload = payloadOf(user) as { excerpts: string[] };
      expect(payload.excerpts).toEqual([]); // stats-only prompt
    } finally {
      bufferBehavior.fail = false;
    }
  });
});

// ── POST /api/persona/regenerate ────────────────────────────────────────────

describe("POST /api/persona/regenerate", () => {
  let app: Hono<HonoEnv>;
  let cookie: string;

  beforeAll(async () => {
    app = makeApp();
    cookie = await loginCookie(ROUTE_USER);
  });

  it("401 no_session without a session cookie", async () => {
    const { env } = makeRouteEnv({ posts: routeRows(), personaRow: null, writes: [] }, makeFakeAi([]));
    const res = await app.request("/api/persona/regenerate", { method: "POST" }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_session");
  });

  it("debounces rapid regenerations (60s window)", async () => {
    const fake = makeFakeAi([routePersonaJson()]);
    const fx: DbFixture = { posts: routeRows(), personaRow: null, writes: [] };
    const { env, rig } = makeRouteEnv(fx, fake);
    await seedToken(rig, ROUTE_USER);

    const first = await app.request("/api/persona/regenerate", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(first.status).toBe(200);
    const second = await app.request("/api/persona/regenerate", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("allows 3 regenerations per year then 429s with regen_limit", async () => {
    const fake = makeFakeAi([routePersonaJson()]);
    const fx: DbFixture = { posts: routeRows(), personaRow: null, writes: [] };
    const { env, rig } = makeRouteEnv(fx, fake);
    await seedToken(rig, ROUTE_USER);

    for (let i = 0; i < 3; i++) {
      if (i > 0) await rig.kv.delete(`deb:persona-regen:${ROUTE_USER}`); // simulate 60s passing
      const res = await app.request("/api/persona/regenerate", { method: "POST", headers: { Cookie: cookie } }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { persona: Persona };
      expect(body.persona.name).toBe("the midnight archivist");
    }
    expect(fx.writes).toHaveLength(3); // each regen overwrites the cache row

    await rig.kv.delete(`deb:persona-regen:${ROUTE_USER}`);
    const fourth = await app.request("/api/persona/regenerate", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("regen_limit");
    expect(body.error.message).toBe("3 regenerations per year — the numbers don't change that fast");
    expect(fx.writes).toHaveLength(3); // rejected call wrote nothing
  });
});

// ── GET /api/persona ────────────────────────────────────────────────────────

describe("GET /api/persona", () => {
  let app: Hono<HonoEnv>;
  let cookie: string;

  beforeAll(async () => {
    app = makeApp();
    cookie = await loginCookie(ROUTE_USER);
  });

  it("401 no_session without a session cookie", async () => {
    const { env } = makeRouteEnv({ posts: [], personaRow: null, writes: [] }, makeFakeAi([]));
    const res = await app.request("/api/persona", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_session");
  });

  it("404 no_persona when nothing is cached", async () => {
    const { env } = makeRouteEnv({ posts: [], personaRow: null, writes: [] }, makeFakeAi([]));
    const res = await app.request("/api/persona", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_persona");
  });

  it("returns the cached persona", async () => {
    const { env } = makeRouteEnv(
      { posts: [], personaRow: JSON.stringify(VALID_PERSONA), writes: [] },
      makeFakeAi([])
    );
    const res = await app.request("/api/persona", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persona: Persona };
    expect(body.persona).toEqual(VALID_PERSONA);
  });
});
