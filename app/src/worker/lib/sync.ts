/**
 * Sync plumbing (backfill + upsert + ceiling budget, spec 03 §2) — CONTRACT
 * STUB, replaced by task T09.
 *
 *  - startBackfill: 12-month page-fetch per channel, ≤ DAILY_REQUEST_SAFETY_STOP
 *    requests/day/token (budget tracked in sync_state.poll_cursor JSON), idempotent
 *    upserts, flips sync_state.backfill_done on completion. Resumes across ticks.
 *  - upsertPosts / getSyncState: shared helpers used by routes + cron.
 */
import type { Env } from "../env";
import type { BufferPost } from "../../shared/types";
import type { SyncStateRow } from "../../shared/schema";

export const BACKFILL_WINDOW_DAYS = 365;

export async function startBackfill(_env: Env, _userId: string): Promise<void> {
  throw new Error("not_implemented: startBackfill lands with task T09");
}

export async function upsertPosts(
  _env: Env,
  _userId: string,
  _posts: BufferPost[]
): Promise<void> {
  throw new Error("not_implemented: upsertPosts lands with task T09");
}

export async function getSyncState(
  _env: Env,
  _userId: string
): Promise<SyncStateRow | null> {
  throw new Error("not_implemented: getSyncState lands with task T09");
}

export interface SyncCursor {
  backfillReqsToday: number;
  backfillDay: string; // YYYY-MM-DD (UTC) the budget belongs to
  backfillPage: number;
  since: number; // backfill window start (unix seconds)
}

export function parseCursor(row: SyncStateRow | null): SyncCursor {
  if (!row?.poll_cursor) {
    return {
      backfillReqsToday: 0,
      backfillDay: new Date().toISOString().slice(0, 10),
      backfillPage: 1,
      since: Math.floor(Date.now() / 1000) - BACKFILL_WINDOW_DAYS * 86400,
    };
  }
  return JSON.parse(row.poll_cursor) as SyncCursor;
}

export type { SyncStateRow };
