/**
 * Per-IP edge rate limiting (feature #4): fixed-window KV counters layered on
 * debounceCheck (spec 01 §6.4). This middleware is the OUTER per-IP layer —
 * routes keep their own per-user limits (recap's 5/day counter, the
 * debounce60s gates in yearize/persona/greatest-hits), and the two compose:
 * a single user is bounded by both their user budget and their IP budget,
 * while many users behind one NAT share the IP budget. No new bindings —
 * counters live in the existing CACHE KV alongside the deb:* keys.
 *
 * Classes (max requests per IP per window):
 *   auth   20 / 300s — /api/auth/* (oauth round-trips, session rotation)
 *   write  30 / 300s — costly mutations: recap queue, share queue, share-link, yearize
 *   read   120 / 60s — API reads + anything unmatched (the catch-all budget)
 *   public 60 / 60s  — /u/* public share pages (no session, attacker-reachable)
 *
 * /api/health is always exempt (uptime probes must never 429). The identity
 * is CF-Connecting-IP; a missing header collapses onto the shared "unknown"
 * bucket rather than bypassing the limit (tests set the header explicitly).
 */
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../env";
import { debounceCheck, jsonError } from "./http";

export type RateClass = "auth" | "write" | "read" | "public";

const LIMITS: Record<RateClass, { windowSec: number; max: number }> = {
  auth: { windowSec: 300, max: 20 },
  write: { windowSec: 300, max: 30 },
  read: { windowSec: 60, max: 120 },
  public: { windowSec: 60, max: 60 },
};

export function rateLimit(cls: RateClass): MiddlewareHandler<HonoEnv> {
  const { windowSec, max } = LIMITS[cls];
  return async (c, next) => {
    if (c.req.path === "/api/health") return next(); // probes are never throttled
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    // one bucket key per class+IP+window; debounceCheck owns start/count/TTL
    const nowSec = Math.floor(Date.now() / 1000);
    const key = `rl:${cls}:${ip}:${Math.floor(nowSec / windowSec)}`;
    // fail-open: KV's ~1 write/sec/key means parallel same-bucket requests can
    // race the counter put — a lost counter write must degrade to "allowed"
    // (outer layer only; per-user budgets in the routes still hold), never 500.
    let verdict;
    try {
      verdict = await debounceCheck(c.env.CACHE, key, windowSec, max);
    } catch {
      return next();
    }
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSec));
      return jsonError(c, 429, "rate_limited", "too many requests — slow down and try again shortly");
    }
    return next();
  };
}
