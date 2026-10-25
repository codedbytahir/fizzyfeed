/**
 * Deck + cards route tests (spec 04 §1/§3) against fake D1/KV bindings.
 *
 * lib/yearize is a stub owned by another agent — vi.mock replaces
 * computeYearStats with a rich prebuilt YearStats, so these tests exercise the
 * deck assembly + route + KV behavior, not the aggregate math. PNG renderers
 * are likewise mocked with counters to prove KV hit/miss paths.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Hono } from "hono";
import { setSessionCookie } from "../src/worker/lib/session";
import type { HonoEnv } from "../src/worker/env";
import type { Env } from "../src/worker/env";
import { buildDeckFromStats, buildDeck } from "../src/worker/routes/deck";
import deckRoute from "../src/worker/routes/deck";
import cardsRoute from "../src/worker/routes/cards";
import { hash8 } from "../src/worker/lib/fonts";
import type { CardData, Deck, YearStats } from "../src/shared/types";
import type { ApiError } from "../src/shared/types";
import type { PostRow } from "../src/shared/schema";

const CURRENT_YEAR = new Date().getUTCFullYear();
const USER = "user-deck-1";
// Dummy 32-byte test key, built at runtime so no base64 secret literal is committed
// (agent-check §4 pattern) — this is not a real secret.
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");

// ── prebuilt rich YearStats (deck fixture — do NOT rely on yearize stub) ─────

const MOCK_STATS: YearStats = {
  year: CURRENT_YEAR,
  totals: { posts: 30, words: 4812, channels: 3, activeDays: 96 },
  firstPost: { at: Date.UTC(CURRENT_YEAR, 2, 14, 9, 30) / 1000, excerpt: "hello from the first post of the year", channel: "twitter" },
  rhythm: {
    bestDow: 2, // tuesday
    favoriteHour: 23, // 11pm
    postsPerWeek: 3.5,
    dowHistogram: [2, 5, 9, 4, 3, 6, 1],
    hourHistogram: Array.from({ length: 24 }, (_, h) => (h === 23 ? 9 : 1)),
  },
  streaks: { longest: 12, longestStart: Date.UTC(CURRENT_YEAR, 4, 1) / 1000, busiestWeek: Date.UTC(CURRENT_YEAR, 9, 6) / 1000, busiestWeekPosts: 9 },
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

const PERSONA_PAYLOAD = {
  name: "the midnight archivist",
  origin: "posted 9 posts in a single week and never missed a tuesday",
  traits: ["archival", "night owl", "curious"],
};

/** Zeroed YearStats for the empty-account branch of the mocked aggregate. */
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

// PNG renderers mocked with call counters; hash8 stays real (importActual).
const counters = vi.hoisted(() => ({ cardRenders: 0, ogRenders: 0 }));
vi.mock("../src/worker/lib/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/worker/lib/render")>();
  const fakePng = (): Uint8Array =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  return {
    ...actual,
    renderCardPng: async (): Promise<Uint8Array> => {
      counters.cardRenders += 1;
      return fakePng();
    },
    renderOgPng: async (): Promise<Uint8Array> => {
      counters.ogRenders += 1;
      return fakePng();
    },
  };
});

// Fonts are irrelevant here (renderers mocked) — stub the loader, keep real hash8.
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

interface DbFixture {
  posts: PostRow[];
  personaRow: { payload_json: string } | null;
}

function makeDb(fixture: DbFixture): unknown {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        all: async () => ({ results: sql.includes("FROM posts") ? fixture.posts : [] }),
        first: async () => (sql.includes("ai_cache") ? fixture.personaRow : null),
      };
      return stmt;
    },
  };
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
    put: async (key: string, value: ArrayBuffer | ArrayBufferView | string, opts?: { expirationTtl?: number }) => {
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

function makeEnv(fixture: DbFixture, cache: KVNamespace): Env {
  return {
    DB: makeDb(fixture),
    CACHE: cache,
    ASSETS: {} as Fetcher,
    SESSION_SECRET,
  } as unknown as Env;
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
  app.route("/api/deck", deckRoute);
  app.route("/api/cards", cardsRoute);
  return app;
}

// ── buildDeckFromStats (pure) ────────────────────────────────────────────────

describe("buildDeckFromStats", () => {
  it("builds 6 cards (persona absent) with spec gradients and n order", () => {
    const cards = buildDeckFromStats(MOCK_STATS, null);
    expect(cards.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 7]);
    const gradients = cards.map((c) => c.gradient);
    expect(gradients).toEqual(["bolt", "aurora", "fizz", "grape", "sunset", "coral"]);
  });

  it("maps YearStats fields into the card union verbatim", () => {
    const cards = buildDeckFromStats(MOCK_STATS, null);
    const byKind = Object.fromEntries(cards.map((c) => [c.kind, c])) as Record<string, CardData>;
    const kickoff = byKind["kickoff"] as Extract<CardData, { kind: "kickoff" }>;
    expect(kickoff.date).toBe("march 14");
    expect(kickoff.excerpt).toBe("hello from the first post of the year");
    const rhythm = byKind["rhythm"] as Extract<CardData, { kind: "rhythm" }>;
    expect(rhythm.bestDow).toBe("tuesday");
    expect(rhythm.favoriteHour).toBe("11pm");
    expect(rhythm.spark).toEqual([2, 5, 9, 4, 3, 6, 1]);
    const peaks = byKind["peaks"] as Extract<CardData, { kind: "peaks" }>;
    expect(peaks.bestMonth).toBe("october");
    expect(peaks.bestMonthPosts).toBe(6);
    const recap = byKind["recap"] as Extract<CardData, { kind: "recap" }>;
    expect(recap.totals.posts).toBe(30);
  });

  it("inserts the persona card at index 5 (n=6, nebula) when present", () => {
    const cards = buildDeckFromStats(MOCK_STATS, PERSONA_PAYLOAD);
    expect(cards).toHaveLength(7);
    expect(cards.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const persona = cards[5] as Extract<CardData, { kind: "persona" }>;
    expect(persona.kind).toBe("persona");
    expect(persona.gradient).toBe("nebula");
    expect(persona.name).toBe("the midnight archivist");
  });

  it("returns the single empty-state card for zero-post stats", () => {
    const cards = buildDeckFromStats({ ...MOCK_STATS, totals: { ...MOCK_STATS.totals, posts: 0 }, firstPost: null }, null);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({
      n: 1,
      kind: "kickoff",
      date: "",
      excerpt: "not enough year yet — connect your buffer and post a little more",
      gradient: "bolt",
    });
  });
});

// ── GET /api/deck ────────────────────────────────────────────────────────────

describe("GET /api/deck", () => {
  let app: Hono<HonoEnv>;
  let cookie: string;

  beforeAll(async () => {
    app = makeApp();
    cookie = await loginCookie(USER);
  });

  it("401 no_session without a session cookie", async () => {
    const env = makeEnv({ posts: richRows(), personaRow: null }, makeKv().cache);
    const res = await app.request("/api/deck", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
  });

  it("returns 6 cards + Cache-Control without a persona cache row", async () => {
    const kv = makeKv();
    const env = makeEnv({ posts: richRows(), personaRow: null }, kv.cache);
    const res = await app.request("/api/deck", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    const deck = (await res.json()) as Deck;
    expect(deck.year).toBe(CURRENT_YEAR);
    expect(deck.stats.totals.posts).toBe(30);
    expect(deck.cards).toHaveLength(6);
    expect(deck.persona).toBeUndefined();
    expect(deck.empty).toBeUndefined();
    expect(kv.getKeys).toHaveLength(0); // deck stays pure JSON — no PNG cache
  });

  it("returns 7 cards and sets Deck.persona when ai_cache has a persona", async () => {
    const env = makeEnv(
      { posts: richRows(), personaRow: { payload_json: JSON.stringify(PERSONA_PAYLOAD) } },
      makeKv().cache
    );
    const res = await app.request("/api/deck", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const deck = (await res.json()) as Deck;
    expect(deck.cards).toHaveLength(7);
    expect(deck.persona?.name).toBe("the midnight archivist");
    const personaCard = deck.cards[5] as Extract<CardData, { kind: "persona" }>;
    expect(personaCard.kind).toBe("persona");
    expect(personaCard.gradient).toBe("nebula");
  });

  it("marks an empty account with empty:true and one state card", async () => {
    const env = makeEnv({ posts: [], personaRow: null }, makeKv().cache);
    const res = await app.request("/api/deck", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const deck = (await res.json()) as Deck;
    expect(deck.empty).toBe(true);
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]?.kind).toBe("kickoff");
    expect(deck.cards[0]?.gradient).toBe("bolt");
  });

  it("surfaces a persona without posts via buildDeck (shared with cards)", async () => {
    const env = makeEnv({ posts: [], personaRow: null }, makeKv().cache);
    const bundle = await buildDeck(env, USER, CURRENT_YEAR);
    const first = bundle.deck.cards[0];
    expect(first?.kind).toBe("kickoff");
    const kickoff = first as Extract<CardData, { kind: "kickoff" }>;
    expect(kickoff.excerpt).toContain("not enough year yet");
  });
});

// ── /api/cards PNG endpoints ─────────────────────────────────────────────────

describe("/api/cards", () => {
  let app: Hono<HonoEnv>;
  let cookie: string;

  beforeAll(async () => {
    app = makeApp();
    cookie = await loginCookie(USER);
  });

  it("serves og.png once, then from KV (renderer not called again)", async () => {
    const kv = makeKv();
    const env = makeEnv({ posts: richRows(), personaRow: null }, kv.cache);
    const first = await app.request("/api/cards/og.png", {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600");
    const png = new Uint8Array(await first.arrayBuffer());
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(counters.ogRenders).toBe(1);
    expect(kv.puts[0]?.key).toBe("card:og:v1");
    expect(kv.puts[0]?.ttl).toBe(30 * 86400);

    const second = await app.request("/api/cards/og.png", {}, env);
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(counters.ogRenders).toBe(1); // KV hit — no re-render
    expect(kv.getKeys.filter((k) => k === "card:og:v1")).toHaveLength(2);
  });

  it("404 card_unavailable for card 6 without a persona", async () => {
    const env = makeEnv({ posts: richRows(), personaRow: null }, makeKv().cache);
    const res = await app.request("/api/cards/6.png", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("card_unavailable");
    expect(body.error.message).toBe("card not in your deck yet");
    expect(counters.cardRenders).toBe(0);
  });

  it("renders card 1 on miss, caches under a statsHash8-keyed slug, hits KV after", async () => {
    const kv = makeKv();
    const env = makeEnv(
      { posts: richRows(), personaRow: { payload_json: JSON.stringify(PERSONA_PAYLOAD) } },
      kv.cache
    );
    const expectedKey = `card:${USER}:${CURRENT_YEAR}:card1-${hash8(JSON.stringify(MOCK_STATS))}`;
    const first = await app.request("/api/cards/1.png", { headers: { Cookie: cookie } }, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await first.arrayBuffer());
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(counters.cardRenders).toBe(1);
    expect(kv.puts[0]?.key).toBe(expectedKey);
    expect(kv.puts[0]?.key).toMatch(/card1-[0-9a-f]{8}$/);
    expect(kv.puts[0]?.ttl).toBe(30 * 86400);

    const second = await app.request("/api/cards/1.png", { headers: { Cookie: cookie } }, env);
    expect(second.status).toBe(200);
    expect(counters.cardRenders).toBe(1); // KV hit — renderer untouched
  });

  it("keys card 3 under the same hash8(stats) slug pattern", async () => {
    const kv = makeKv();
    const env = makeEnv({ posts: richRows(), personaRow: null }, kv.cache);
    const expectedKey = `card:${USER}:${CURRENT_YEAR}:card3-${hash8(JSON.stringify(MOCK_STATS))}`;
    const res = await app.request("/api/cards/3.png", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(kv.puts[0]?.key).toBe(expectedKey);
    expect(kv.puts[0]?.key).toMatch(/card3-[0-9a-f]{8}$/);
    // same stats → same slug across cards; different card number only changes the prefix
    expect(kv.puts[0]?.key).toContain(hash8(JSON.stringify(MOCK_STATS)));
  });

  it("renders the persona card 6 when the persona exists", async () => {
    const env = makeEnv(
      { posts: richRows(), personaRow: { payload_json: JSON.stringify(PERSONA_PAYLOAD) } },
      makeKv().cache
    );
    const res = await app.request("/api/cards/6.png", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("404s unknown or malformed slugs", async () => {
    const env = makeEnv({ posts: richRows(), personaRow: null }, makeKv().cache);
    for (const slug of ["99.png", "banana.png", "0.png", "8.png"]) {
      const res = await app.request(`/api/cards/${slug}`, { headers: { Cookie: cookie } }, env);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("not_found");
    }
  });

  it("401 no_session for card slugs without a session", async () => {
    const env = makeEnv({ posts: richRows(), personaRow: null }, makeKv().cache);
    const res = await app.request("/api/cards/1.png", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
  });
});
