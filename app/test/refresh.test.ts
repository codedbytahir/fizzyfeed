/**
 * Token refresh lifecycle tests (task T07): reactive 401 → one refresh + retry
 * with batch rotation (AAD-bound sealing), RefreshError surfacing, and the
 * proactive 24h cron sweep. Fake D1 rows are pre-sealed with the real crypto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { unseal } from "../src/worker/lib/crypto";
import { BufferApiError } from "../src/worker/lib/buffer";
import {
  RefreshError,
  refreshExpiringTokens,
  sealTokenColumns,
  unsealRefreshToken,
  withAccessToken,
} from "../src/worker/lib/refresh";
import { asU8, createTestRig, jsonResponse, type Row, type TestRig } from "./helpers";

const USER = "user-1";
const ACCESS_A = "at-original-0123456789abcdef";
const REFRESH_A = "rt-original-0123456789abcdef";
const ACCESS_B = "at-rotated-fedcba9876543210";
const REFRESH_B = "rt-rotated-fedcba9876543210";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

async function seedTokenRow(
  rig: TestRig,
  userId: string,
  access: string,
  refresh: string,
  expiresIn = 3600
): Promise<void> {
  const cols = await sealTokenColumns(rig.env.TOKEN_AES_KEY, userId, access, refresh);
  rig.db.tokens.set(userId, {
    user_id: userId,
    access_enc: cols.accessEnc,
    refresh_enc: cols.refreshEnc,
    iv: cols.iv,
    salt: cols.salt,
    expires_at: now() + expiresIn,
    scopes: "read",
    rotated_at: 0,
  });
}

function stubTokenRefresh(handler: (form: URLSearchParams) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== "https://api.buffer.com/1/oauth2/token.json") {
      throw new Error(`unexpected fetch ${url}`);
    }
    return handler(new URLSearchParams(String(init?.body ?? "")));
  });
}

function okRefreshResponse(): Response {
  return jsonResponse({ access_token: ACCESS_B, refresh_token: REFRESH_B, expires_in: 7200, scope: "read" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("withAccessToken (reactive 401)", () => {
  it("refreshes once on 401, rotates inside db.batch(), and retries with the new token", async () => {
    const rig = createTestRig();
    await seedTokenRow(rig, USER, ACCESS_A, REFRESH_A);
    stubTokenRefresh((form) => {
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe(REFRESH_A);
      expect(form.get("client_id")).toBe("test-client");
      expect(form.get("client_secret")).toBe("test-secret");
      expect(form.get("redirect_uri")).toBe("https://app.test/api/auth/buffer/callback");
      return okRefreshResponse();
    });

    const fn = vi.fn<(token: string) => Promise<string>>();
    fn.mockRejectedValueOnce(new BufferApiError(401, "expired"));
    fn.mockResolvedValueOnce("ok");

    const result = await withAccessToken(rig.env, USER, fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0]?.[0]).toBe(ACCESS_A);
    expect(fn.mock.calls[1]?.[0]).toBe(ACCESS_B);

    // rotation landed inside one atomic batch: tokens + sync_state watermark
    expect(rig.db.batches).toHaveLength(1);
    const batch = rig.db.batches[0] ?? [];
    expect(batch).toHaveLength(2);
    const tokenStmt = batch[0]!;
    expect(tokenStmt.sql.startsWith("UPDATE buffer_tokens")).toBe(true);
    const stateStmt = batch[1]!;
    expect(stateStmt.sql.startsWith("UPDATE sync_state")).toBe(true);
    expect(typeof stateStmt.params[0]).toBe("number");
    expect(stateStmt.params[1]).toBe(USER);

    // the new access token is AAD-bound to the owner — unsealable only by them
    const ct = asU8(tokenStmt.params[0]);
    const iv = asU8(tokenStmt.params[2]);
    const salt = asU8(tokenStmt.params[3]);
    expect(await unseal(rig.env.TOKEN_AES_KEY, { iv, salt, ct }, USER)).toBe(ACCESS_B);
    await expect(unseal(rig.env.TOKEN_AES_KEY, { iv, salt, ct }, "someone-else")).rejects.toThrow();

    // refresh token rotated too (self-describing envelope param)
    expect(await unsealRefreshToken(rig.env.TOKEN_AES_KEY, USER, asU8(tokenStmt.params[1]))).toBe(REFRESH_B);

    // stored row carries the new expiry (expires_in 7200)
    const stored = rig.db.tokens.get(USER) as Row;
    expect(Number(stored["expires_at"])).toBeGreaterThanOrEqual(now() + 7100);
    expect(Number(stored["rotated_at"])).toBeGreaterThan(0);
  });

  it("surfaces RefreshError 401 when the retry also 401s (rotation happened once)", async () => {
    const rig = createTestRig();
    await seedTokenRow(rig, USER, ACCESS_A, REFRESH_A);
    stubTokenRefresh(() => okRefreshResponse());

    const fn = vi.fn<(token: string) => Promise<string>>();
    fn.mockRejectedValue(new BufferApiError(401, "still expired"));

    const err = await withAccessToken(rig.env, USER, fn).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RefreshError);
    expect((err as RefreshError).status).toBe(401);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(rig.db.batches).toHaveLength(1);
  });

  it("rethrows non-401 upstream errors untouched (no refresh, no batch)", async () => {
    const rig = createTestRig();
    await seedTokenRow(rig, USER, ACCESS_A, REFRESH_A);
    const boom = new BufferApiError(502, "buffer down");
    const fn = vi.fn<(token: string) => Promise<string>>();
    fn.mockRejectedValue(boom);

    const err = await withAccessToken(rig.env, USER, fn).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(rig.db.batches).toHaveLength(0);
  });

  it("throws RefreshError 401 when no token row exists (never calls fn)", async () => {
    const rig = createTestRig();
    const fn = vi.fn<(token: string) => Promise<string>>();
    fn.mockResolvedValue("never");
    const err = await withAccessToken(rig.env, "ghost-user", fn).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RefreshError);
    expect((err as RefreshError).status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("maps a failed refresh call to RefreshError 502", async () => {
    const rig = createTestRig();
    await seedTokenRow(rig, USER, ACCESS_A, REFRESH_A);
    stubTokenRefresh(() => jsonResponse({ error: "boom" }, 500));

    const fn = vi.fn<(token: string) => Promise<string>>();
    fn.mockRejectedValueOnce(new BufferApiError(401, "expired"));

    const err = await withAccessToken(rig.env, USER, fn).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RefreshError);
    expect((err as RefreshError).status).toBe(502);
  });
});

describe("refreshExpiringTokens (proactive cron)", () => {
  it("refreshes only rows expiring within 24h, survives per-user failures, returns the count", async () => {
    const rig = createTestRig();
    await seedTokenRow(rig, "u-expiring", ACCESS_A, REFRESH_A, 3600);
    await seedTokenRow(rig, "u-fresh", ACCESS_A, REFRESH_A, 2 * 86_400);
    await seedTokenRow(rig, "u-expired", ACCESS_A, REFRESH_A, -10);
    await seedTokenRow(rig, "u-bad", ACCESS_A, "rt-bad-token", 3600);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    stubTokenRefresh((form) => {
      if (form.get("refresh_token") === "rt-bad-token") {
        return jsonResponse({ error: "invalid_grant" }, 500);
      }
      return okRefreshResponse();
    });

    const refreshed = await refreshExpiringTokens(rig.env);
    expect(refreshed).toBe(2); // u-expiring + u-expired; u-bad failed, u-far untouched

    const expiringRow = rig.db.tokens.get("u-expiring") as Row;
    expect(
      await unseal(rig.env.TOKEN_AES_KEY, {
        iv: asU8(expiringRow["iv"]),
        salt: asU8(expiringRow["salt"]),
        ct: asU8(expiringRow["access_enc"]),
      }, "u-expiring")
    ).toBe(ACCESS_B);

    const freshRow = rig.db.tokens.get("u-fresh") as Row;
    expect(
      await unseal(rig.env.TOKEN_AES_KEY, {
        iv: asU8(freshRow["iv"]),
        salt: asU8(freshRow["salt"]),
        ct: asU8(freshRow["access_enc"]),
      }, "u-fresh")
    ).toBe(ACCESS_A);

    // failures are logged with ids only
    const logged = errSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toContain("u-bad");
    expect(logged).not.toContain("rt-bad-token");
  });
});
