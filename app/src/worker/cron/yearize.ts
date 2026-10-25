/**
 * Hourly cron (spec 01 §4, spec 03 §2): proactive token refresh, backfill
 * resume (ceiling makes long backfills span multiple ticks), and incremental
 * polls for completed accounts. One summary line, counts only.
 */
import type { Env } from "../env";
import { refreshExpiringTokens } from "../lib/refresh";
import { pollIncremental, startBackfill } from "../lib/sync";

const POLL_INTERVAL_SEC = 3600;

export async function runYearizeCron(env: Env): Promise<void> {
  // 1 · proactive token refresh (spec 02 §4) — failures must not block sync
  try {
    await refreshExpiringTokens(env);
  } catch (err) {
    console.error(`yearize cron: token refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const now = Math.floor(Date.now() / 1000);
  let backfills = 0;
  let polls = 0;
  let errors = 0;

  // 2 · resume unfinished backfills (request ceiling resumes them next hour)
  const backfillRows = await env.DB.prepare(
    "SELECT user_id FROM sync_state WHERE backfill_done = 0"
  ).all<{ user_id: string }>();
  for (const row of backfillRows.results) {
    try {
      await startBackfill(env, row.user_id);
      backfills += 1;
    } catch (err) {
      errors += 1;
      console.error(
        `yearize cron: backfill failed: user=${row.user_id} err=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3 · incremental polls for accounts whose backfill is complete
  const pollRows = await env.DB.prepare(
    "SELECT user_id FROM sync_state WHERE backfill_done = 1 AND last_polled_at < ?"
  )
    .bind(now - POLL_INTERVAL_SEC)
    .all<{ user_id: string }>();
  for (const row of pollRows.results) {
    try {
      await pollIncremental(env, row.user_id);
      polls += 1;
    } catch (err) {
      errors += 1;
      console.error(
        `yearize cron: poll failed: user=${row.user_id} err=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(`yearize cron: backfills=${backfills} polls=${polls} errors=${errors}`);
}
