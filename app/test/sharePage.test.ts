/**
 * Share-page route tests (feature 6) against local fake D1/KV doubles.
 *
 * routes/cards (getCardPng), lib/render (renderOgPng) and lib/fonts (loadFonts)
 * are mocked with counters to prove cache hit/miss paths; lib/yearize is
 * mocked with a rich prebuilt YearStats (deck.test.ts pattern) so these tests
 * exercise share routing, rev-keyed public caches and the page HTML — not the
 * aggregate math. helpers.ts is left untouched (parallel agents may extend it);
 * the share_links fake lives here.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Hono } from "hono";
import type { Env, HonoEnv } from "../src/worker/env";
import { setSessionCookie } from "../src/worker/lib/session";
import { hash8 } from "../src/worker/lib/fonts";
import { BRAND_NAME } from "../src/shared/brand";
import shareLinkRoute, { sharePublic } from "../src/worker/routes/sharePage";
import type { ShareLinkRow, PostRow } from "../src/shared/schema";
import type { ApiError, ShareStatus, YearStats } from "../src/shared/types";
import { createTestRig } from "./helpers";

const CURRENT_YEAR = new Date().getUTCFullYear();
const USER = "user-share-1";
// Dummy 32-byte test key, built at runtime so no base64 secret literal is
// committed (deck.test.ts pattern) — this is not a real secret.
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");

// ── prebuilt rich YearStats (same fixture shape as deck.test.ts) ─────────────

const MOCK_STATS: YearStats = {
  year: CURRENT_YEAR,
  totals: { posts: 30, words: 4812, channels: 3, activeDays: 96 },
  firstPost: { at: Date.UTC(CURRENT_YEAR, 2, 14, 9, 30) / 1000, excerpt: "hello from the first post of the year", channel: "twitter" },
  rhythm: {
    bestDow: 2, // tuesday
    favoriteHour: 23,
    postsPerWeek: 3.5,
    dowHistogram: [2, 5, 9, 4, 3, 6, 1],
    hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 23 ? 9 : 1)),
  },
  streaks: { longest: 12, longestStart: 0, busiestWeek: 0, busiestWeekPosts: 9 },
  mix: {
    channels: [
      { service: "twitter", count: 15, pct: 50 },
      { service: "instagram", count: 9, pct: 30 },
      { service: "linkedin", count: 6, pct: 20 },
    ],
    topTopics: ["shipping", "demos", "tea", "wasm", "posts"],
  },
  peaks: { bestMonth: 9, bestMonthPosts: 6, bestWeekPosts: 5, monthly: [2, 1, 3, 2, 3, 2, 1, 4, 3, 5, 2, 2] },
  daily: [],
};

/** Distinct strings that must never leak onto the public page. */
const EXCERPT_TEXT = "hello from the first post of the year";
const TOPIC_TEXT = "tea";
const STAT_LINE = "30 posts · 4812 words · 3 channels";

function zeroStats(year: number): YearStats {
  return {
    year,
    totals: { posts: 0, words: 0, channels: 0, activeDays: 0 },
    firstPost: null,
    rhythm: {
      bestDow: 0,
      favoriteHour: 0,
      postsPerWeek: 0,
      dowHistogram: [0, 0, 0, 0, 0, 0, 0],
      hourHistogram: Array.from({ length: 24 }, () => 0),
    },
    streaks: { longest: 0, longestStart: 0, busiestWeek: 0, busiestWeekPosts: 0 },
    mix: { channels: [], topTopics: [] },
    peaks: { bestMonth: 0, bestMonthPosts: 0, bestWeekPosts: 0, monthly: Array.from({ length: 12 }, () => 0) },
    daily: [],
  };
}

vi.mock("../src/worker/lib/yearize", () => ({
  computeYearStats: (posts: PostRow[], year: number) =>
    posts.length === 0 ? zeroStats(year) : MOCK_STATS,
  statsHash8: () => "deadbeef",
}));

// PNG renderers + card renderer mocked with call counters; hash8 stays real.
const counters = vi.hoisted(() => ({
  ogRenders: 0,
  cardPngCalls: 0,
  nullCards: new Set<number>(),
}));

const fakePng = vi.hoisted(
  () => (): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
);

vi.mock("../src/worker/routes/cards", () => ({
  // getCardPng export owned by the cards agent (11-b) — stubbed here
  getCardPng: async (_env: unknown, _userId: string, n: number): Promise<Uint8Array | null> => {
    counters.cardPngCalls += 1;
    return counters.nullCards.has(n) ? null : fakePng();
  },
}));

vi.mock("../src/worker/lib/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/worker/lib/render")>();
  return {
    ...actual,
    renderOgPng: async (): Promise<Uint8Array> => {
      counters.ogRenders += 1;
      return fakePng();
    },
  };
});

vi.mock("../src/worker/lib/fonts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/worker/lib/fonts")>();
  return {
    ...actual,
    loadFonts: async () => [
      { name: "stub", data: new ArrayBuffer(4), weight: 400, style: "normal" },
    ],
  };
});

// ── fake bindings ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** D1 returns plain snapshot objects — clone so route writes can't alias the map. */
function cloneRow(row: ShareLinkRow): Row {
  return { ...row };
}

/** Implements exactly the statements routes/sharePage.ts + routes/deck.ts issue. */
class ShareDb {
  readonly log: { sql: string; params: unknown[] }[] = [];
  readonly shareLinks = new Map<string, ShareLinkRow>(); // by user_id
  posts: PostRow[] = [];
  personaRow: { payload_json: string } | null = null;

  prepare(sql: string): {
    bind: (...params: unknown[]) => {
      sql: string;
      params: unknown[];
      first<T = Row>(): Promise<T | null>;
      all<T = Row>(): Promise<{ results: T[] }>;
      run(): Promise<{ success: true }>;
    };
  } {
    const db = this;
    const make = (params: unknown[]) => ({
      sql,
      params,
      first: async <T = Row>(): Promise<T | null> =>
        ((await db.exec(sql, params)) as unknown as T[])[0] ?? null,
      all: async <T = Row>(): Promise<{ results: T[] }> => ({
        results: (await db.exec(sql, params)) as unknown as T[],
      }),
      run: async (): Promise<{ success: true }> => {
        await db.exec(sql, params);
        return { success: true };
      },
    });
    return { bind: (...params: unknown[]) => make(params) };
  }

  private async exec(sql: string, params: unknown[]): Promise<Row[]> {
    this.log.push({ sql, params });
    const q = sql.replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT user_id, share_id, enabled, rev, created_at FROM share_links WHERE user_id")) {
      const row = this.shareLinks.get(String(params[0]));
      return row ? [cloneRow(row)] : [];
    }
    if (q.startsWith("SELECT user_id, share_id, enabled, rev, created_at FROM share_links WHERE share_id")) {
      for (const row of this.shareLinks.values()) {
        if (row.share_id === params[0]) return [cloneRow(row)];
      }
      return [];
    }
    if (q.startsWith("UPDATE share_links SET enabled = 1")) {
      const row = this.shareLinks.get(String(params[0]));
      if (row) {
        row.enabled = 1;
        row.rev += 1;
      }
      return [];
    }
    if (q.startsWith("UPDATE share_links SET enabled = 0")) {
      const row = this.shareLinks.get(String(params[0]));
      if (row) {
        row.enabled = 0;
        row.rev += 1;
      }
      return [];
    }
    if (q.startsWith("UPDATE share_links SET share_id")) {
      const row = this.shareLinks.get(String(params[1] as string));
      if (row) {
        row.share_id = String(params[0]);
        row.rev += 1;
      }
      return [];
    }
    const insert = /^INSERT INTO share_links .*VALUES \(\?, \?, (\d), (\d), \?\)$/.exec(q);
    if (insert) {
      const [userId, shareId, createdAt] = params as [string, string, number];
      this.shareLinks.set(userId, {
        user_id: userId,
        share_id: shareId,
        enabled: Number(insert[1] ?? 0),
        rev: Number(insert[2] ?? 0),
        created_at: createdAt,
      });
      return [];
    }

    if (q.startsWith("SELECT * FROM posts")) {
      return this.posts
        .filter((p) => p.user_id === params[0] && p.year === params[1])
        .map((p) => p as unknown as Row);
    }
    if (q.startsWith("SELECT payload_json FROM ai_cache")) {
      return this.personaRow ? [this.personaRow as unknown as Row] : [];
    }

    throw new Error(`ShareDb: unhandled sql: ${sql}`);
  }
}

interface KvSpy {
  cache: KVNamespace;
  store: Map<string, ArrayBuffer>;
  getKeys: string[];
  puts: { key: string; ttl?: number }[];
}

function makeKv(): KvSpy {
  const store = new Map<string, ArrayBuffer>();
  const getKeys: string[] = [];
  const puts: { key: string; ttl?: number }[] = [];
  const cache = {
    get: async (key: string, type?: unknown) => {
      getKeys.push(key);
      if (type !== "arrayBuffer") return null;
      return store.get(key) ?? null;
    },
    put: async (
      key: string,
      value: ArrayBuffer | ArrayBufferView | string,
      opts?: { expirationTtl?: number }
    ) => {
      puts.push({ key, ttl: opts?.expirationTtl });
      const ab =
        typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : value instanceof ArrayBuffer
            ? value
            : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      store.set(key, ab as ArrayBuffer);
    },
  };
  return { cache: cache as unknown as KVNamespace, store, getKeys, puts };
}

/** ~30 rows spread across the current year (rich-account fixture). */
function richRows(): PostRow[] {
  const services = ["twitter", "instagram", "linkedin"] as const;
  return Array.from({ length: 30 }, (_, i) => {
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
    };
  });
}

function makeEnv(db: ShareDb, cache: KVNamespace): Env {
  // createTestRig keeps the honest env shape; the session secret is pinned to
  // the file's dummy (same secret signs the login cookie and verifies it) and
  // the bindings are swapped for the local fakes above.
  const rig = createTestRig();
  return { ...rig.env, SESSION_SECRET, DB: db as unknown as Env["DB"], CACHE: cache };
}

/** Generate a legit signed session cookie via a throwaway Hono app. */
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
  app.route("/api/share-link", shareLinkRoute);
  app.route("/u", sharePublic);
  return app;
}

function seedRow(overrides?: Partial<ShareLinkRow>): ShareLinkRow {
  return {
    user_id: USER,
    share_id: overrides?.share_id ?? "seed-share-id",
    enabled: overrides?.enabled ?? 1,
    rev: overrides?.rev ?? 1,
    created_at: Math.floor(Date.now() / 1000),
  };
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

let cookie = "";

beforeAll(async () => {
  cookie = await loginCookie(USER);
});

// ── private management router ────────────────────────────────────────────────

describe("share-link private router (/api/share-link)", () => {
  const app = makeApp();

  it("401 no_session for status, toggle and rotate without a session", async () => {
    const db = new ShareDb();
    const env = makeEnv(db, makeKv().cache);
    for (const [method, path, body] of [
      ["GET", "/api/share-link/status", undefined],
      ["POST", "/api/share-link/toggle", JSON.stringify({ enabled: true })],
      ["POST", "/api/share-link/rotate", undefined],
    ] as const) {
      const res = await app.request(path, { method, body }, env);
      expect(res.status).toBe(401);
      const err = (await res.json()) as ApiError;
      expect(err.error.code).toBe("no_session");
    }
    expect(db.log).toHaveLength(0);
  });

  it("status with no row → { enabled: false, shareId: null, url: null }", async () => {
    const env = makeEnv(new ShareDb(), makeKv().cache);
    const res = await app.request("/api/share-link/status", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const status = (await res.json()) as ShareStatus;
    expect(status).toEqual({ enabled: false, shareId: null, url: null });
  });

  it("toggle on with no row inserts a share row (random share_id, rev 1) and returns the url", async () => {
    const db = new ShareDb();
    const env = makeEnv(db, makeKv().cache);
    const res = await app.request(
      "/api/share-link/toggle",
      { method: "POST", body: JSON.stringify({ enabled: true }), headers: { Cookie: cookie } },
      env
    );
    expect(res.status).toBe(200);
    const status = (await res.json()) as ShareStatus;
    expect(status.enabled).toBe(true);
    expect(status.shareId).toMatch(/^[A-Za-z0-9_-]{43}$/); // randomToken(32)
    expect(status.url).toBe(`https://app.test/u/${status.shareId}`);
    expect(db.log.some((e) => e.sql.startsWith("INSERT INTO share_links"))).toBe(true);
    const row = db.shareLinks.get(USER);
    expect(row?.enabled).toBe(1);
    expect(row?.rev).toBe(1);
    expect(row?.share_id).toBe(status.shareId);
  });

  it("400 bad_request for malformed toggle bodies", async () => {
    const env = makeEnv(new ShareDb(), makeKv().cache);
    for (const body of [undefined, "not json", JSON.stringify({}), JSON.stringify({ enabled: "yes" })]) {
      const res = await app.request(
        "/api/share-link/toggle",
        { method: "POST", body, headers: { Cookie: cookie } },
        env
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as ApiError;
      expect(err.error.code).toBe("bad_request");
    }
  });

  it("toggle off keeps share_id (toggle-back restores the same url) and bumps rev", async () => {
    const db = new ShareDb();
    db.shareLinks.set(USER, seedRow({ share_id: "keep-me", rev: 1 }));
    const env = makeEnv(db, makeKv().cache);

    const off = await app.request(
      "/api/share-link/toggle",
      { method: "POST", body: JSON.stringify({ enabled: false }), headers: { Cookie: cookie } },
      env
    );
    expect(off.status).toBe(200);
    const offStatus = (await off.json()) as ShareStatus;
    expect(offStatus.enabled).toBe(false);
    expect(offStatus.shareId).toBe("keep-me");
    expect(offStatus.url).toBeNull();
    expect(db.shareLinks.get(USER)?.share_id).toBe("keep-me");
    expect(db.shareLinks.get(USER)?.rev).toBe(2);

    const on = await app.request(
      "/api/share-link/toggle",
      { method: "POST", body: JSON.stringify({ enabled: true }), headers: { Cookie: cookie } },
      env
    );
    const onStatus = (await on.json()) as ShareStatus;
    expect(onStatus.enabled).toBe(true);
    expect(onStatus.shareId).toBe("keep-me");
    expect(onStatus.url).toBe("https://app.test/u/keep-me");
    expect(db.shareLinks.get(USER)?.rev).toBe(3);
    // no new INSERT — the existing row was updated in place
    expect(db.log.some((e) => e.sql.startsWith("INSERT INTO share_links"))).toBe(false);
  });

  it("rotate mints a new share_id, bumps rev, keeps enabled, and audits ids only", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const db = new ShareDb();
      db.shareLinks.set(USER, seedRow({ share_id: "old-id", enabled: 1, rev: 4 }));
      const env = makeEnv(db, makeKv().cache);
      const res = await app.request(
        "/api/share-link/rotate",
        { method: "POST", headers: { Cookie: cookie } },
        env
      );
      expect(res.status).toBe(200);
      const status = (await res.json()) as ShareStatus;
      expect(status.enabled).toBe(true);
      expect(status.shareId).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(status.shareId).not.toBe("old-id");
      expect(status.url).toBe(`https://app.test/u/${status.shareId}`);
      const row = db.shareLinks.get(USER);
      expect(row?.share_id).toBe(status.shareId);
      expect(row?.rev).toBe(5);
      expect(row?.enabled).toBe(1);
      // audit line names the event + user only — share ids are capability URLs
      // and never reach logs (critic r1)
      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = String(logSpy.mock.calls[0]?.[0] ?? "");
      expect(line).toContain("user=user-share-1");
      expect(line).not.toContain("old-id");
      expect(line).not.toContain(status.shareId ?? "");
      expect(line).not.toContain(EXCERPT_TEXT);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rotate with no row reserves a disabled id instead of erroring", async () => {
    const db = new ShareDb();
    const env = makeEnv(db, makeKv().cache);
    const res = await app.request(
      "/api/share-link/rotate",
      { method: "POST", headers: { Cookie: cookie } },
      env
    );
    expect(res.status).toBe(200);
    const status = (await res.json()) as ShareStatus;
    expect(status.enabled).toBe(false);
    expect(status.shareId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(status.url).toBeNull();
    expect(db.shareLinks.get(USER)?.enabled).toBe(0);
  });
});

// ── public page ──────────────────────────────────────────────────────────────

describe("public page GET /u/:shareId", () => {
  const app = makeApp();

  it("200 html: header, honest stat grid, card images, CTA, og metas, cache-control", async () => {
    const db = new ShareDb();
    const row = seedRow();
    db.shareLinks.set(USER, row);
    db.posts = richRows();
    const res = await app.request(`/u/${row.share_id}`, {}, makeEnv(db, makeKv().cache));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const html = await res.text();
    // header + headline
    expect(html).toContain(BRAND_NAME);
    expect(html).toContain("your year in posts.");
    // honest numbers from deck.stats (totals + rhythm + streaks)
    expect(html).toContain('<div class="v">30</div>');
    expect(html).toContain('<div class="v">4,812</div>');
    expect(html).toContain('<div class="v">3.5</div>');
    expect(html).toContain('<div class="v">tuesday</div>');
    expect(html).toContain('<div class="v">12</div>');
    expect(html).toContain("days in a row");
    expect(html).toContain("posts per week");
    // og meta set on this page
    expect(html).toContain('<meta property="og:title" content="your year in posts">');
    expect(html).toContain(`<meta property="og:description" content="${STAT_LINE}">`);
    expect(html).toContain(
      `<meta property="og:image" content="https://app.test/u/${row.share_id}/og.png">`
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    // the deck's cards as lazy images (no persona → no card 6)
    for (const n of [1, 2, 3, 4, 5, 7]) {
      expect(html).toContain(`<img loading="lazy" src="/u/${row.share_id}/card/${n}.png"`);
    }
    expect(html).toContain('alt="kickoff card"');
    expect(html).not.toContain("card/6.png");
    // closing CTA to the app origin
    expect(html).toContain('<a class="cta" href="https://app.test">build yours</a>');
    // dark-first tokens in the inline CSS
    expect(html).toContain("--ink-950: #05070E");
  });

  it("excerpt-free: no post text, no first-post excerpt, no topics leak", async () => {
    const db = new ShareDb();
    const row = seedRow();
    db.shareLinks.set(USER, row);
    db.posts = richRows();
    const res = await app.request(`/u/${row.share_id}`, {}, makeEnv(db, makeKv().cache));
    const html = await res.text();
    expect(html).not.toContain("about shipping");
    expect(html).not.toContain(EXCERPT_TEXT);
    expect(html).not.toContain(TOPIC_TEXT);
  });

  it("unknown share id → 404 branded html, no-store", async () => {
    const env = makeEnv(new ShareDb(), makeKv().cache);
    const res = await app.request("/u/nope", {}, env);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("nothing here");
    expect(html).toContain("build yours");
    expect(html).toContain(BRAND_NAME);
  });

  it("disabled link → 404 even though the row exists", async () => {
    const db = new ShareDb();
    db.shareLinks.set(USER, seedRow({ enabled: 0 }));
    db.posts = richRows();
    const res = await app.request("/u/seed-share-id", {}, makeEnv(db, makeKv().cache));
    expect(res.status).toBe(404);
  });

  it("empty deck → 404 'nothing to share yet'", async () => {
    const db = new ShareDb(); // no posts
    db.shareLinks.set(USER, seedRow());
    const res = await app.request("/u/seed-share-id", {}, makeEnv(db, makeKv().cache));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("this link has nothing to share yet");
  });
});

// ── public og.png ────────────────────────────────────────────────────────────

describe("public og.png GET /u/:shareId/og.png", () => {
  const app = makeApp();

  it("renders once, caches under pub:{shareId}:og:{rev}:{hash8(statLine)} for 7d, then hits KV", async () => {
    const db = new ShareDb();
    const row = seedRow({ share_id: "og-id", rev: 2 });
    db.shareLinks.set(USER, row);
    db.posts = richRows();
    const kv = makeKv();
    const env = makeEnv(db, kv.cache);

    const rendersBefore = counters.ogRenders;
    const first = await app.request("/u/og-id/og.png", {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(isPng(new Uint8Array(await first.arrayBuffer()))).toBe(true);
    const expectedKey = `pub:og-id:og:2:${hash8(STAT_LINE)}`;
    expect(kv.puts[0]?.key).toBe(expectedKey);
    expect(kv.puts[0]?.ttl).toBe(7 * 86400);
    expect(counters.ogRenders).toBe(rendersBefore + 1);

    const second = await app.request("/u/og-id/og.png", {}, env);
    expect(second.status).toBe(200);
    expect(counters.ogRenders).toBe(rendersBefore + 1); // KV hit — no re-render
    expect(kv.getKeys.filter((k) => k === expectedKey)).toHaveLength(2);
  });

  it("404 when the link is disabled or the deck is empty", async () => {
    const rendersBefore = counters.ogRenders;
    const disabledDb = new ShareDb();
    disabledDb.shareLinks.set(USER, seedRow({ enabled: 0 }));
    disabledDb.posts = richRows();
    const disabled = await app.request(
      "/u/seed-share-id/og.png",
      {},
      makeEnv(disabledDb, makeKv().cache)
    );
    expect(disabled.status).toBe(404);

    const emptyDb = new ShareDb();
    emptyDb.shareLinks.set(USER, seedRow());
    const empty = await app.request("/u/seed-share-id/og.png", {}, makeEnv(emptyDb, makeKv().cache));
    expect(empty.status).toBe(404);
    expect(counters.ogRenders).toBe(rendersBefore);
  });
});

// ── public card PNGs ─────────────────────────────────────────────────────────

describe("public card PNGs GET /u/:shareId/card/:n.png", () => {
  const app = makeApp();

  it("200 png via getCardPng, cached under pub:{shareId}:card{n}:{rev} for 7d", async () => {
    const db = new ShareDb();
    const row = seedRow({ share_id: "card-id", rev: 3 });
    db.shareLinks.set(USER, row);
    db.posts = richRows();
    const kv = makeKv();
    const env = makeEnv(db, kv.cache);

    const callsBefore = counters.cardPngCalls;
    const first = await app.request("/u/card-id/card/2.png", {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(isPng(new Uint8Array(await first.arrayBuffer()))).toBe(true);
    expect(counters.cardPngCalls).toBe(callsBefore + 1);
    expect(kv.puts[0]?.key).toBe("pub:card-id:card2:3");
    expect(kv.puts[0]?.ttl).toBe(7 * 86400);

    const second = await app.request("/u/card-id/card/2.png", {}, env);
    expect(second.status).toBe(200);
    expect(counters.cardPngCalls).toBe(callsBefore + 1); // KV hit — renderer untouched
  });

  it("404 when disabled, slug malformed, n out of range, or getCardPng returns null", async () => {
    const disabledDb = new ShareDb();
    disabledDb.shareLinks.set(USER, seedRow({ enabled: 0 }));
    disabledDb.posts = richRows();
    const disabled = await app.request(
      "/u/seed-share-id/card/1.png",
      {},
      makeEnv(disabledDb, makeKv().cache)
    );
    expect(disabled.status).toBe(404);

    const db = new ShareDb();
    db.shareLinks.set(USER, seedRow());
    db.posts = richRows();
    const env = makeEnv(db, makeKv().cache);
    for (const slug of ["8.png", "0.png", "banana.png", "2"]) {
      const res = await app.request(`/u/seed-share-id/card/${slug}`, {}, env);
      expect(res.status).toBe(404);
    }
    counters.nullCards.add(6);
    try {
      const res = await app.request("/u/seed-share-id/card/6.png", {}, env);
      expect(res.status).toBe(404);
    } finally {
      counters.nullCards.delete(6);
    }
  });

  it("rev in the cache key: toggling bumps rev so a fresh key (re)renders", async () => {
    const db = new ShareDb();
    const row = seedRow({ share_id: "rev-id", rev: 1 });
    db.shareLinks.set(USER, row);
    db.posts = richRows();
    const kv = makeKv();
    const env = makeEnv(db, kv.cache);

    const callsBefore = counters.cardPngCalls;
    const before = await app.request("/u/rev-id/card/1.png", {}, env);
    expect(before.status).toBe(200);
    expect(kv.puts.at(-1)?.key).toBe("pub:rev-id:card1:1");
    expect(counters.cardPngCalls).toBe(callsBefore + 1);

    // toggle off → on bumps rev 1 → 3 under the same share_id
    const off = await app.request(
      "/api/share-link/toggle",
      { method: "POST", body: JSON.stringify({ enabled: false }), headers: { Cookie: cookie } },
      env
    );
    expect(off.status).toBe(200);
    const on = await app.request(
      "/api/share-link/toggle",
      { method: "POST", body: JSON.stringify({ enabled: true }), headers: { Cookie: cookie } },
      env
    );
    expect(on.status).toBe(200);
    expect(db.shareLinks.get(USER)?.rev).toBe(3);
    expect(db.shareLinks.get(USER)?.share_id).toBe("rev-id");

    const after = await app.request("/u/rev-id/card/1.png", {}, env);
    expect(after.status).toBe(200);
    expect(kv.puts.at(-1)?.key).toBe("pub:rev-id:card1:3"); // fresh key, old entry orphaned
    expect(counters.cardPngCalls).toBe(callsBefore + 2); // re-rendered under the new rev
  });
});

describe("public surface error boundary (critic r2 sentinel)", () => {
  it("an unhandled handler error under /u renders the branded 500, no-store, message-free", async () => {
    const db = new ShareDb();
    db.shareLinks.set("boom-id", seedRow({ share_id: "boom-id" }));
    const broken = {
      prepare: () => {
        throw new Error("boom-sentinel");
      },
    } as unknown as ShareDb;
    const app = makeApp();
    const res = await app.request("/u/boom-id", {}, makeEnv(broken, makeKv().cache));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("something broke");
    expect(html).not.toContain("boom-sentinel"); // internals never leak
    expect(html).not.toContain(EXCERPT_TEXT);
  });
});
