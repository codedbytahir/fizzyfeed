/**
 * Yearize API (spec 03 §4): manual sync trigger (debounced 60s/user) and
 * sync status. Mounted at /api/yearize.
 */
import { Hono } from "hono";
import type { HonoEnv } from "../env";
import type { YearizeStatus } from "../../shared/types";
import { jsonError, debounce60s } from "../lib/http";
import { readSessionUserId } from "../lib/session";
import { getSyncState, pollIncremental, startBackfill } from "../lib/sync";

const yearize = new Hono<HonoEnv>();

yearize.post("/run", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in to sync your year");

  const deb = await debounce60s(c.env.CACHE, `deb:yearize:${userId}`);
  if (!deb.allowed) {
    return jsonError(c, 429, "rate_limited", `try again in ${deb.retryAfterSec}s`);
  }

  // fire-and-forget: respond immediately, sync runs in the background
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const state = await getSyncState(c.env, userId);
        if (state?.backfill_done) {
          await pollIncremental(c.env, userId);
        } else {
          await startBackfill(c.env, userId);
        }
      } catch (err) {
        console.error(
          `yearize run failed: user=${userId} err=${err instanceof Error ? err.message : String(err)}`
        );
      }
    })()
  );

  return c.json({ status: "queued" }, 202);
});

yearize.get("/status", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in to check sync status");

  const state = await getSyncState(c.env, userId);
  const counted = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();

  const status: YearizeStatus = {
    backfillDone: !!state?.backfill_done,
    lastPolledAt: state?.last_polled_at ?? 0,
    postsIndexed: counted?.n ?? 0,
  };
  return c.json(status);
});

export default yearize;
