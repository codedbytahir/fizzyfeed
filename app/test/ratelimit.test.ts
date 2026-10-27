/**
 * Per-IP edge rate limiting tests (feature #4): the fixed-window KV middleware
 * in lib/ratelimit.ts, driven end-to-end through a real Hono app wired like
 * worker/index.ts (originCheck + the class middlewares, with stub handlers
 * standing in for the feature routes — those own their own behavior).
 *
 * Covered: the /api/health exemption (no counter writes at all), exact class
 * limits (auth 20/300s, write 30/300s, read 120/60s, public 60/60s), the
 * Retry-After header, window rollover reset, per-IP isolation, the missing
 * CF-Connecting-IP "unknown" bucket, and the exact typed 429 error shape.
 *
 * Time is frozen with fake Date timers so window buckets + Retry-After are
 * deterministic; the rollover test advances the clock past the window. The
 * KV fake wraps helpers.FakeKV with the "json" read mode real KV has
 * (greatestHits.test.ts pattern — debounceCheck needs it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { originCheck } from "../src/worker/lib/http";
import { rateLimit } from "../src/worker/lib/ratelimit";
import { createTestRig, type FakeKV } from "./helpers";
import type { ApiError } from "../src/shared/types";
import type { Env, HonoEnv } from "../src/worker/env";

const IP_A = "203.0.113.7"; // TEST-NET-3 documentation range
const IP_B = "203.0.113.9";
const RATE_LIMITED: ApiError = {
  error: { code: "rate_limited", message: "too many requests — slow down and try again shortly" },
};

/** FakeKV storage + the "json" read mode real KV has (debounceCheck needs it). */
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

interface Rig {
  env: Env;
  kv: FakeKV;
  app: Hono<HonoEnv>;
}

/** Mirrors worker/index.ts wiring with stub handlers for the feature routes. */
function makeRig(): Rig {
  const base = createTestRig();
  const env: Env = { ...base.env, CACHE: jsonKv(base.kv) };

  const api = new Hono<HonoEnv>();
  api.use("*", originCheck());
  api.use("/auth/*", rateLimit("auth"));
  api.use("/recap/queue", rateLimit("write"));
  api.use("/share/queue", rateLimit("write"));
  api.use("/share-link/*", rateLimit("write"));
  api.use("/yearize/*", rateLimit("write"));
  api.use("*", rateLimit("read")); // catch-all read/unknown, health exempt inside

  api.get("/health", (c) => c.json({ ok: true }));
  // stub surfaces — the real routes layer auth/validation on top of these paths
  api.post("/auth/buffer/start", (c) => c.json({ ok: true }));
  api.post("/share/queue", (c) => c.json({ ok: true }));
  api.post("/yearize/run", (c) => c.json({ ok: true }));
  api.get("/deck", (c) => c.json({ ok: true }));

  const app = new Hono<HonoEnv>();
  app.route("/api", api);
  app.use("/u/*", rateLimit("public"));
  app.get("/u/:slug", (c) => c.json({ ok: true }));

  return { env, kv: base.kv, app };
}

async function hit(rig: Rig, path: string, ip: string | null, method = "GET"): Promise<Response> {
  return rig.app.request(
    path,
    { method, headers: ip ? { "CF-Connecting-IP": ip } : {} },
    rig.env
  );
}

/** The rl:* counter keys currently in the fake KV (bucket keys the mw wrote). */
function rlKeys(rig: Rig): string[] {
  return [...rig.kv.map.keys()].filter((k) => k.startsWith("rl:"));
}

describe("rate limit middleware", () => {
  beforeEach(() => {
    // freeze time: same window bucket for a whole test, exact Retry-After
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exempts /api/health entirely (200 far past the read limit, zero counters written)", async () => {
    const rig = makeRig();
    for (let i = 0; i < 130; i++) {
      const res = await hit(rig, "/api/health", IP_A);
      expect(res.status).toBe(200);
    }
    expect(rlKeys(rig)).toEqual([]);
  });

  it("auth class: 20 requests pass, the 21st is 429 with Retry-After and the typed error shape", async () => {
    const rig = makeRig();
    for (let i = 0; i < 20; i++) {
      const res = await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
      expect(res.status).toBe(200);
    }
    const denied = await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("300"); // full window: no time elapsed
    expect(denied.headers.get("content-type")).toContain("application/json");
    await expect(denied.json()).resolves.toEqual(RATE_LIMITED);
  });

  it("auth class: the budget resets once the 300s window rolls over", async () => {
    const rig = makeRig();
    for (let i = 0; i < 20; i++) await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
    expect((await hit(rig, "/api/auth/buffer/start", IP_A, "POST")).status).toBe(429);
    vi.setSystemTime(Date.now() + 301_000); // past the window → new bucket key
    const res = await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
    expect(res.status).toBe(200);
  });

  it("keys are per class + per IP + per window bucket (auth requests also spend the read budget)", async () => {
    const rig = makeRig();
    await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
    const sec = Math.floor(Date.now() / 1000);
    // the catch-all read middleware matches auth requests too — both counters exist
    expect(rlKeys(rig)).toEqual([
      `rl:auth:${IP_A}:${Math.floor(sec / 300)}`,
      `rl:read:${IP_A}:${Math.floor(sec / 60)}`,
    ]);
  });

  it("per-IP isolation: exhausting one IP leaves another IP untouched", async () => {
    const rig = makeRig();
    for (let i = 0; i < 20; i++) await hit(rig, "/api/auth/buffer/start", IP_A, "POST");
    expect((await hit(rig, "/api/auth/buffer/start", IP_A, "POST")).status).toBe(429);
    const other = await hit(rig, "/api/auth/buffer/start", IP_B, "POST");
    expect(other.status).toBe(200);
  });

  it("a missing CF-Connecting-IP falls back to the shared 'unknown' bucket", async () => {
    const rig = makeRig();
    for (let i = 0; i < 20; i++) {
      const res = await hit(rig, "/api/auth/buffer/start", null, "POST");
      expect(res.status).toBe(200);
    }
    expect((await hit(rig, "/api/auth/buffer/start", null, "POST")).status).toBe(429);
    const authKeys = rlKeys(rig).filter((k) => k.startsWith("rl:auth:"));
    expect(authKeys.length).toBeGreaterThan(0);
    expect(authKeys.every((k) => k.startsWith("rl:auth:unknown:"))).toBe(true);
    expect(rlKeys(rig).some((k) => k.startsWith("rl:read:unknown:"))).toBe(true); // catch-all ran too
  });

  it("write class: 30 posts pass on /api/share/queue, the 31st is 429", async () => {
    const rig = makeRig();
    for (let i = 0; i < 30; i++) {
      const res = await hit(rig, "/api/share/queue", IP_A, "POST");
      expect(res.status).toBe(200);
    }
    const denied = await hit(rig, "/api/share/queue", IP_A, "POST");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("300");
    await expect(denied.json()).resolves.toEqual(RATE_LIMITED);
  });

  it("read catch-all: 120 reads pass on /api/deck, the 121st is 429", async () => {
    const rig = makeRig();
    for (let i = 0; i < 120; i++) {
      const res = await hit(rig, "/api/deck", IP_A);
      expect(res.status).toBe(200);
    }
    const denied = await hit(rig, "/api/deck", IP_A);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    await expect(denied.json()).resolves.toEqual(RATE_LIMITED);
  });

  it("public class: 60 requests pass on /u/x, the 61st is 429", async () => {
    const rig = makeRig();
    for (let i = 0; i < 60; i++) {
      const res = await hit(rig, "/u/x", IP_A);
      expect(res.status).toBe(200);
    }
    const denied = await hit(rig, "/u/x", IP_A);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    await expect(denied.json()).resolves.toEqual(RATE_LIMITED);
  });
});

describe("fail-open on KV failure (critic r2 sentinel)", () => {
  /** KV whose put always throws — models the real KV's concurrent-write races. */
  function throwingKv(): KVNamespace {
    return {
      get: async () => null,
      put: async () => {
        throw new Error("kv write race / outage");
      },
      delete: async () => undefined,
    } as unknown as KVNamespace;
  }

  async function hitThrowing(path: string): Promise<Response> {
    const app = new Hono<HonoEnv>();
    app.use("*", rateLimit("read"));
    app.get("/api/deck", (c) => c.json({ ok: true }));
    return app.request(path, { headers: { "CF-Connecting-IP": IP_A } }, {
      CACHE: throwingKv(),
    } as unknown as Env);
  }

  it("a KV put failure degrades to allow — never a user-visible 500", async () => {
    const res = await hitThrowing("/api/deck");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("stays allowed past the read budget while KV is down (outer layer only)", async () => {
    for (let i = 0; i < 130; i++) {
      const res = await hitThrowing("/api/deck");
      expect(res.status).toBe(200);
    }
  });
});
