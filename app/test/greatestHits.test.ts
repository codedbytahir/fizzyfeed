/**
 * Greatest Hits tests (spec 07, task T19): enable / refresh / revoke / status
 * over fake D1 + KV bindings with Buffer's HTTP mocked at the global fetch
 * level (the user.json PAT-validation probe + the metrics endpoint).
 *
 * Covered: the AES-GCM discipline (ciphertext ≠ plaintext at rest, roundtrip
 * only under the row owner's AAD), the 10-minute debounce, exact metric-label
 * pass-through ("impressions" stays "impressions"), serve-from-cache without
 * refetch, expiry/revoke semantics, and the sentinel rule — the PAT reaches
 * ZERO console calls, ZERO response bodies, and ZERO KV entries.
 *
 * The D1 fake extends helpers.FakeD1 with exactly the two metrics_tokens
 * statements the route adds on top of the base (upsert insert, select) —
 * anything unknown still throws, so schema drift fails loudly. The KV fake
 * gains the "json" read mode real KV has (debounceCheck needs it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import greatestHitsRoute, { METRICS_URL } from "../src/worker/routes/greatestHits";
import { unseal } from "../src/worker/lib/crypto";
import { setSessionCookie } from "../src/worker/lib/session";
import type { Env, HonoEnv } from "../src/worker/env";
import type { GreatestHit } from "../src/shared/types";
import {
  FakeD1,
  asU8,
  createTestRig,
  jsonResponse,
  type BoundStub,
  type FakeKV,
  type Row,
} from "./helpers";

const USER = "user-gh-1";
/** Sentinel PAT — every test asserts this string never leaks anywhere. */
const PAT = "pat-sentinel-9f2c74ae51d08b36";
const GH_KEY = `gh:${USER}`;
const DEB_KEY = `deb:gh:${USER}`;
// Dummy 32-byte test key built at runtime (recap.test.ts pattern) — not a secret.
const SESSION_SECRET = btoa("0123456789abcdef0123456789abcdef");
const TOKEN_PAGE = "https://buffer.com/app/settings/developers";

// ── fake D1: base + the two metrics_tokens statements ───────────────────────

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

class GHD1 extends FakeD1 {
  override prepare(sql: string): Prepared {
    const db = this;
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO metrics_tokens")) {
      return stubFor(sql, async (params) => {
        const [userId, patEnc, iv, salt, createdAt] = params as [
          string,
          Uint8Array,
          Uint8Array,
          Uint8Array,
          number
        ];
        // mirrors the ON CONFLICT(user_id) DO UPDATE (re-enable path)
        db.metricsTokens.set(userId, {
          user_id: userId,
          pat_enc: patEnc,
          iv,
          salt,
          created_at: createdAt,
          revoked_at: null,
        });
        return [];
      });
    }
    if (q.startsWith("SELECT * FROM metrics_tokens")) {
      return stubFor(sql, async (params) => {
        const row = db.metricsTokens.get(String(params[0]));
        return row ? [row] : [];
      });
    }
    return super.prepare(sql); // DELETE FROM metrics_tokens etc. via the base
  }
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

// ── rig + session helpers ───────────────────────────────────────────────────

interface GhRig {
  env: Env;
  db: GHD1;
  kv: FakeKV;
  app: Hono<HonoEnv>;
}

function makeRig(): GhRig {
  const base = createTestRig();
  const db = new GHD1();
  const env: Env = {
    ...base.env,
    DB: db as unknown as Env["DB"],
    CACHE: jsonKv(base.kv),
    SESSION_SECRET, // fixed so loginCookie() signs what the routes verify
  };
  const app = new Hono<HonoEnv>();
  app.route("/api/greatest-hits", greatestHitsRoute);
  return { env, db, kv: base.kv, app };
}

async function loginCookie(): Promise<string> {
  const app = new Hono<HonoEnv>();
  app.get("/login", async (c) => {
    await setSessionCookie(c, USER);
    return c.text("ok");
  });
  const res = await app.request("/login", {}, { SESSION_SECRET } as unknown as HonoEnv["Bindings"]);
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("session cookie missing from login response");
  return setCookie.slice(0, setCookie.indexOf(";"));
}

// ── request helpers (every response body is recorded for the sentinel) ──────

const responseBodies: string[] = [];

async function record(res: Response): Promise<Response> {
  responseBodies.push(await res.clone().text());
  return res;
}

async function post(
  rig: GhRig,
  path: string,
  cookie: string | null,
  body?: unknown
): Promise<Response> {
  const res = await rig.app.request(
    `/api/greatest-hits${path}`,
    {
      method: "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    rig.env
  );
  return record(res);
}

async function get(rig: GhRig, path: string, cookie: string | null): Promise<Response> {
  const res = await rig.app.request(
    `/api/greatest-hits${path}`,
    { method: "GET", headers: cookie ? { Cookie: cookie } : {} },
    rig.env
  );
  return record(res);
}

function at<T>(list: T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`missing item ${i}`);
  return v;
}

// ── Buffer HTTP mock (global fetch) ─────────────────────────────────────────

interface FetchCall {
  url: string;
  status: number;
}

let calls: FetchCall[] = [];
let userStatus = 200;
let metricsStatus = 200;
let metricsBody: unknown = [];

function installFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.startsWith("https://api.buffer.com/1/user.json")) {
      calls.push({ url, status: userStatus });
      return jsonResponse({ id: "buf-user-1", name: "ada" }, userStatus);
    }
    if (url.startsWith(METRICS_URL)) {
      calls.push({ url, status: metricsStatus });
      return jsonResponse(metricsBody, metricsStatus);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function probeCalls(): FetchCall[] {
  return calls.filter((c) => c.url.startsWith("https://api.buffer.com/1/user.json"));
}

function metricsCalls(): FetchCall[] {
  return calls.filter((c) => c.url.startsWith(METRICS_URL));
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** 11 posts, values 1000…900; post 0 carries "impressions", post 1 "favorites". */
function metricsFixture(): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < 11; i++) {
    const value = 1000 - i * 10;
    const name = i === 0 ? "impressions" : i === 1 ? "favorites" : "clicks";
    const text = i === 0 ? `long post ${i} ${"fizz ".repeat(40)}` : `post ${i} about shipping`;
    const update: Record<string, unknown> = { id: `u-${i}`, text, metrics: { [name]: value } };
    if (i === 2) {
      update["channel"] = "linkedin"; // tolerated alternative field, no `service`
    } else {
      update["service"] = "twitter";
    }
    out.push(update);
  }
  return out;
}

/** Simulate the 600s KV cache TTL passing (FakeKV ignores TTLs — age by hand). */
function ageCache(rig: GhRig, seconds: number): void {
  const raw = rig.kv.map.get(GH_KEY);
  if (!raw) throw new Error("cache entry missing");
  const entry = JSON.parse(raw) as { cachedAt: number };
  entry.cachedAt = Math.floor(Date.now() / 1000) - seconds;
  rig.kv.map.set(GH_KEY, JSON.stringify(entry));
}

function enableAndRefresh(rig: GhRig, cookie: string): Promise<void> {
  return (async () => {
    const enable = await post(rig, "/enable", cookie, { token: PAT });
    expect(enable.status).toBe(204);
    const refresh = await post(rig, "/refresh", cookie);
    expect(refresh.status).toBe(200);
  })();
}

beforeEach(() => {
  calls = [];
  responseBodies.length = 0;
  userStatus = 200;
  metricsStatus = 200;
  metricsBody = metricsFixture();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── POST /enable ────────────────────────────────────────────────────────────

describe("POST /enable", () => {
  it("validates with one cheap read, seals the PAT, writes the row, purges stale cache", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();
    rig.kv.put(GH_KEY, '{"top":[],"metricNames":[],"cachedAt":0}'); // stale cache

    const res = await post(rig, "/enable", cookie, { token: PAT });
    expect(res.status).toBe(204);

    // exactly ONE fetch: the user.json validation probe, PAT in the query
    expect(calls).toHaveLength(1);
    expect(at(probeCalls(), 0).url).toContain("access_token=");

    // row written — ciphertext at rest, not the plaintext PAT
    const row = rig.db.metricsTokens.get(USER);
    expect(row).toBeDefined();
    expect(row?.["revoked_at"]).toBeNull();
    expect(typeof row?.["created_at"]).toBe("number");
    const patEnc = asU8(row?.["pat_enc"]);
    expect(new TextDecoder().decode(patEnc)).not.toBe(PAT);
    expect(new TextDecoder().decode(patEnc)).not.toContain("pat-");

    // roundtrip works only under the row owner's AAD
    const opened = await unseal(
      rig.env.TOKEN_AES_KEY,
      { iv: asU8(row?.["iv"]), salt: asU8(row?.["salt"]), ct: patEnc },
      USER
    );
    expect(opened).toBe(PAT);
    await expect(
      unseal(
        rig.env.TOKEN_AES_KEY,
        { iv: asU8(row?.["iv"]), salt: asU8(row?.["salt"]), ct: patEnc },
        "someone-else"
      )
    ).rejects.toThrow();

    // stale cached results never outlive a re-enable
    expect(rig.kv.map.has(GH_KEY)).toBe(false);
  });

  it("buffer rejects the PAT → 400 invalid_token with the token-page link, no row written", async () => {
    const rig = makeRig();
    installFetch();
    userStatus = 401;
    const cookie = await loginCookie();

    const res = await post(rig, "/enable", cookie, { token: PAT });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("invalid_token");
    expect(err.error.message).toContain(TOKEN_PAGE);

    expect(probeCalls()).toHaveLength(1); // validation was attempted exactly once
    expect(rig.db.metricsTokens.size).toBe(0); // nothing stored for a bad PAT
  });

  it("no session → 401 no_session (and no upstream call)", async () => {
    const rig = makeRig();
    installFetch();

    const res = await post(rig, "/enable", null, { token: PAT });
    expect(res.status).toBe(401);
    const err = (await res.json()) as { error: { code: string } };
    expect(err.error.code).toBe("no_session");
    expect(calls).toHaveLength(0);
  });

  it("short token → 400 invalid_token without even probing buffer", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    const res = await post(rig, "/enable", cookie, { token: "short-token" });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("invalid_token");
    expect(err.error.message).toContain(TOKEN_PAGE);
    expect(calls).toHaveLength(0);
    expect(rig.db.metricsTokens.size).toBe(0);
  });
});

// ── POST /refresh ───────────────────────────────────────────────────────────

describe("POST /refresh", () => {
  it("maps + sorts + slices honestly: top 9 desc, labels pass through verbatim", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    const enable = await post(rig, "/enable", cookie, { token: PAT });
    expect(enable.status).toBe(204);
    const res = await post(rig, "/refresh", cookie);
    expect(res.status).toBe(200);

    expect(metricsCalls()).toHaveLength(1); // one metrics read per refresh
    const body = (await res.json()) as { top?: GreatestHit[] };
    const top = body.top;
    if (!top) throw new Error("missing top in refresh response");
    expect(top).toHaveLength(9); // 11 posts in, only the top 9 out
    expect(top.map((h) => h.postId)).not.toContain("u-9");
    expect(top.map((h) => h.postId)).not.toContain("u-10");

    // exact pass-through: the API's own field names, never renamed
    expect(at(top, 0).metric).toEqual({ name: "impressions", value: 1000 });
    expect(at(top, 1).metric).toEqual({ name: "favorites", value: 990 });
    expect(at(top, 0).channel).toBe("twitter");
    expect(at(top, 2).channel).toBe("linkedin"); // tolerated `channel` field

    // sorted by value, descending
    const values = top.map((h) => h.metric.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));

    // excerpts capped at 80 chars
    for (const hit of top) expect(hit.excerpt.length).toBeLessThanOrEqual(80);
    expect(at(top, 0).excerpt).toContain("long post 0");
    expect(at(top, 0).excerpt.length).toBe(80);

    // cache entry: { top, metricNames, cachedAt } with a 600s TTL put
    const raw = rig.kv.map.get(GH_KEY);
    expect(raw).toBeDefined();
    const entry = JSON.parse(raw ?? "{}") as {
      top?: GreatestHit[];
      metricNames?: string[];
      cachedAt?: number;
    };
    expect(entry.top).toHaveLength(9);
    expect(entry.metricNames).toEqual(["impressions", "favorites", "clicks"]);
    expect(typeof entry.cachedAt).toBe("number");
  });

  it("debounces a rapid second call → 429 rate_limited", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();
    await enableAndRefresh(rig, cookie);
    expect(metricsCalls()).toHaveLength(1);

    const res = await post(rig, "/refresh", cookie);
    expect(res.status).toBe(429);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("rate_limited");
    expect(err.error.message).toContain("try again in");
    expect(metricsCalls()).toHaveLength(1); // no extra upstream read
  });

  it("410 gone without a row, or with a revoked row", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    const noRow = await post(rig, "/refresh", cookie);
    expect(noRow.status).toBe(410);
    const err = (await noRow.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("gone");
    expect(err.error.message).toContain("enable it again");

    // revoked_at set → same 410 (row exists but is dead). The first refresh
    // consumed the debounce window, so simulate it passing before retrying.
    await post(rig, "/enable", cookie, { token: PAT });
    const row = rig.db.metricsTokens.get(USER);
    expect(row).toBeDefined();
    if (row) row["revoked_at"] = 1_234;
    rig.kv.delete(DEB_KEY);
    const revoked = await post(rig, "/refresh", cookie);
    expect(revoked.status).toBe(410);
    expect(((await revoked.json()) as { error: { code: string } }).error.code).toBe("gone");
  });

  it("PAT expired upstream (401) → 410 + row deleted + cached results purged", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();
    await enableAndRefresh(rig, cookie); // success → cache written
    expect(rig.kv.map.has(GH_KEY)).toBe(true);
    expect(rig.db.metricsTokens.has(USER)).toBe(true);

    metricsStatus = 401;
    ageCache(rig, 601); // simulate the cache TTL passing…
    rig.kv.delete(DEB_KEY); // …and the 10-min debounce window passing

    const res = await post(rig, "/refresh", cookie);
    expect(res.status).toBe(410);
    const err = (await res.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("gone");

    expect(at(metricsCalls(), 1).status).toBe(401); // the expired probe
    expect(rig.db.metricsTokens.has(USER)).toBe(false); // row deleted
    expect(rig.kv.map.has(GH_KEY)).toBe(false); // cache purged
  });

  it("tampered ciphertext row → 410 + row deleted (unreadable = expired)", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();
    await post(rig, "/enable", cookie, { token: PAT });

    const row = rig.db.metricsTokens.get(USER);
    expect(row).toBeDefined();
    if (row) {
      const tampered = asU8(row["pat_enc"]).slice();
      const head = tampered[0];
      if (head === undefined) throw new Error("empty ciphertext");
      tampered[0] = head ^ 0xff;
      rig.db.metricsTokens.set(USER, { ...row, pat_enc: tampered });
    }

    const res = await post(rig, "/refresh", cookie);
    expect(res.status).toBe(410);
    expect(rig.db.metricsTokens.has(USER)).toBe(false);
    expect(metricsCalls()).toHaveLength(0); // never reached the metrics read
  });

  it("serves the cached top from KV with zero extra upstream reads", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    const enable = await post(rig, "/enable", cookie, { token: PAT });
    expect(enable.status).toBe(204);
    const res1 = await post(rig, "/refresh", cookie);
    expect(res1.status).toBe(200);
    const top1 = (await res1.clone().json()) as { top: GreatestHit[] };
    expect(metricsCalls()).toHaveLength(1);

    // second call inside the window → 429 (cache is NOT consulted yet)
    const res2 = await post(rig, "/refresh", cookie);
    expect(res2.status).toBe(429);
    expect(metricsCalls()).toHaveLength(1);

    // simulate the debounce window passing (mission trick: clear the key) and
    // swap the upstream payload — a refetch would return the decoy
    rig.kv.delete(DEB_KEY);
    metricsBody = [{ id: "decoy", text: "decoy", service: "twitter", metrics: { clicks: 5 } }];

    const res3 = await post(rig, "/refresh", cookie);
    expect(res3.status).toBe(200);
    const top3 = (await res3.json()) as { top: GreatestHit[] };
    expect(top3).toEqual(top1); // same cached hits…
    expect(top3.top[0]?.postId).toBe("u-0"); // …not the decoy
    expect(metricsCalls()).toHaveLength(1); // fetch spy count stays
  });
});

// ── POST /revoke ────────────────────────────────────────────────────────────

describe("POST /revoke", () => {
  it("→ 204, row gone, cache purged, subsequent refresh → 410", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();
    await enableAndRefresh(rig, cookie);
    expect(rig.kv.map.has(GH_KEY)).toBe(true);

    const res = await post(rig, "/revoke", cookie);
    expect(res.status).toBe(204);
    expect(rig.db.metricsTokens.has(USER)).toBe(false);
    expect(rig.kv.map.has(GH_KEY)).toBe(false);

    rig.kv.delete(DEB_KEY); // simulate the debounce window passing
    const after = await post(rig, "/refresh", cookie);
    expect(after.status).toBe(410);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe("gone");
  });

  it("no session → 401", async () => {
    const rig = makeRig();
    installFetch();
    const res = await post(rig, "/revoke", null);
    expect(res.status).toBe(401);
  });
});

// ── GET /status ─────────────────────────────────────────────────────────────

describe("GET /status", () => {
  it("no session → 401", async () => {
    const rig = makeRig();
    installFetch();
    const res = await get(rig, "/status", null);
    expect(res.status).toBe(401);
  });

  it("enabled true with since; false once revoked; re-enable flips it back", async () => {
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    const off = await get(rig, "/status", cookie);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ enabled: false });

    await post(rig, "/enable", cookie, { token: PAT });
    const on = await get(rig, "/status", cookie);
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as { enabled: boolean; since?: number };
    expect(onBody.enabled).toBe(true);
    expect(onBody.since).toBe(rig.db.metricsTokens.get(USER)?.["created_at"]);
    // never token material of any kind — not even a masked hint
    expect(Object.keys(onBody).sort()).toEqual(["enabled", "since"]);

    // manual revoke → disabled, and no `since` key at all
    const row = rig.db.metricsTokens.get(USER);
    if (row) row["revoked_at"] = 1_234;
    const dead = await get(rig, "/status", cookie);
    expect(await dead.json()).toEqual({ enabled: false });

    // re-enable clears revoked_at (upsert path)
    await post(rig, "/enable", cookie, { token: PAT });
    expect(rig.db.metricsTokens.get(USER)?.["revoked_at"]).toBeNull();
    const alive = await get(rig, "/status", cookie);
    expect(((await alive.json()) as { enabled: boolean }).enabled).toBe(true);

    await post(rig, "/revoke", cookie);
    const gone = await get(rig, "/status", cookie);
    expect(await gone.json()).toEqual({ enabled: false });
  });
});

// ── sentinel (spec 07 §5) ───────────────────────────────────────────────────

describe("sentinel", () => {
  it("the PAT reaches zero console calls, zero response bodies, zero KV rows", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rig = makeRig();
    installFetch();
    const cookie = await loginCookie();

    await post(rig, "/enable", cookie, { token: PAT });
    await post(rig, "/refresh", cookie);
    await post(rig, "/revoke", cookie);
    await get(rig, "/status", cookie);

    const consoleText = [logSpy, errorSpy, warnSpy]
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(consoleText.includes(PAT)).toBe(false);

    for (const body of responseBodies) {
      expect(body.includes(PAT)).toBe(false);
    }
    for (const value of rig.kv.map.values()) {
      expect(value.includes(PAT)).toBe(false);
    }
    for (const stmt of rig.db.log) {
      for (const param of stmt.params) {
        expect(String(param)).not.toContain(PAT); // only ciphertext is bound
      }
    }
  });
});
