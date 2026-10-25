/**
 * HTTP helpers: the single error shape (spec 01 §5), origin checks, and KV
 * debounce counters (spec 01 §6.4).
 */
import type { Context, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../env";

export function jsonError(
  c: Context<HonoEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 502,
  code: string,
  message: string
) {
  return c.json({ error: { code, message } }, status);
}

/** Reject mutations whose Origin header (when present) doesn't match APP_ORIGIN. */
export function originCheck(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    const origin = c.req.header("Origin");
    const appOrigin = new URL(c.env.APP_ORIGIN).origin;
    const allowed = new Set([appOrigin]);
    const reqUrl = new URL(c.req.url);
    allowed.add(reqUrl.origin); // same-origin always allowed
    if (origin && !allowed.has(origin)) {
      return jsonError(c, 403, "bad_origin", "cross-origin mutation rejected");
    }
    return next();
  };
}

export interface DebounceResult {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window KV debounce. Key caller-chosen (e.g. `deb:{userId}:persona`).
 * Counter: `{ start, count }` — window = windowSec; count compared to max.
 */
export async function debounceCheck(
  kv: KVNamespace,
  key: string,
  windowSec: number,
  max: number
): Promise<DebounceResult> {
  const now = Math.floor(Date.now() / 1000);
  const cur = await kv.get<{ start: number; count: number }>(key, "json");
  if (!cur || now - cur.start >= windowSec) {
    await kv.put(key, JSON.stringify({ start: now, count: 1 }), { expirationTtl: windowSec + 60 });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (cur.count >= max) {
    return { allowed: false, retryAfterSec: windowSec - (now - cur.start) };
  }
  await kv.put(key, JSON.stringify({ start: cur.start, count: cur.count + 1 }), {
    expirationTtl: windowSec + 60,
  });
  return { allowed: true, retryAfterSec: 0 };
}

/** Per-user 60s debounce used by yearize/persona/regenerate (spec 01 §6.4). */
export async function debounce60s(kv: KVNamespace, key: string): Promise<DebounceResult> {
  return debounceCheck(kv, key, 60, 1);
}

export function truncateForLog(s: string, max = 64): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
