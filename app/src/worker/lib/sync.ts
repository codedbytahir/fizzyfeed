/**
 * Sync plumbing (spec 03 §2): 12-month backfill with a per-day request
 * ceiling, incremental polling, and idempotent post upserts.
 *
 * Resume model: all progress lives in sync_state.poll_cursor (SyncCursor
 * JSON), persisted after EVERY page so a cron kill resumes mid-channel.
 * The request budget (DAILY_REQUEST_SAFETY_STOP) resets each UTC day while
 * `since` and the page position survive. Tokens never reach logs.
 */
import { DAILY_REQUEST_SAFETY_STOP } from "../../shared/brand";
import type { BufferClient, BufferPost } from "../../shared/types";
import type { PostRow, SyncStateRow } from "../../shared/schema";
import type { Env } from "../env";
import { withAccessToken } from "./refresh";
import { createBufferClient } from "./buffer";

export const BACKFILL_WINDOW_DAYS = 365;

const PAGE_SIZE = 50;
const UPSERT_CHUNK = 50;

export interface SyncCursor {
  backfillReqsToday: number;
  backfillDay: string; // YYYY-MM-DD (UTC) the budget belongs to
  backfillChannel: number; // index into listChannels() still to fetch
  backfillPage: number; // next page to fetch for backfillChannel
  since: number; // backfill window start (unix seconds)
}

export function utcDayString(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export function parseCursor(
  row: SyncStateRow | null,
  nowSec = Math.floor(Date.now() / 1000)
): SyncCursor {
  const fallback: SyncCursor = {
    backfillReqsToday: 0,
    backfillDay: utcDayString(nowSec),
    backfillChannel: 0,
    backfillPage: 1,
    since: nowSec - BACKFILL_WINDOW_DAYS * 86400,
  };
  if (!row?.poll_cursor) return fallback;
  try {
    const raw = JSON.parse(row.poll_cursor) as Partial<SyncCursor>;
    return {
      backfillReqsToday: typeof raw.backfillReqsToday === "number" ? raw.backfillReqsToday : 0,
      backfillDay: typeof raw.backfillDay === "string" ? raw.backfillDay : fallback.backfillDay,
      backfillChannel: typeof raw.backfillChannel === "number" ? raw.backfillChannel : 0,
      backfillPage:
        typeof raw.backfillPage === "number" && raw.backfillPage >= 1 ? raw.backfillPage : 1,
      since: typeof raw.since === "number" ? raw.since : fallback.since,
    };
  } catch {
    return fallback;
  }
}

/** Roll the daily budget over when the stored cursor is from an earlier UTC day. */
export function resetBudgetIfNeeded(cursor: SyncCursor, today: string): SyncCursor {
  if (cursor.backfillDay === today) return cursor;
  return { ...cursor, backfillDay: today, backfillReqsToday: 0 };
}

// ── D1 helpers (testable against a fake D1) ─────────────────────────────────

export async function getSyncState(env: Env, userId: string): Promise<SyncStateRow | null> {
  const row = await env.DB.prepare(
    "SELECT user_id, backfill_done, last_polled_at, poll_cursor FROM sync_state WHERE user_id = ?"
  )
    .bind(userId)
    .first<SyncStateRow>();
  return row ?? null;
}

/** sync_state rows are created by the OAuth callback; self-heal if absent. */
async function ensureSyncState(env: Env, userId: string): Promise<SyncStateRow> {
  const existing = await getSyncState(env, userId);
  if (existing) return existing;
  await env.DB.prepare(
    "INSERT INTO sync_state (user_id, backfill_done, last_polled_at) VALUES (?, 0, 0) ON CONFLICT (user_id) DO NOTHING"
  )
    .bind(userId)
    .run();
  const created = await getSyncState(env, userId);
  return created ?? { user_id: userId, backfill_done: 0, last_polled_at: 0, poll_cursor: null };
}

async function persistCursor(env: Env, userId: string, cursor: SyncCursor): Promise<void> {
  await env.DB.prepare("UPDATE sync_state SET poll_cursor = ? WHERE user_id = ?")
    .bind(JSON.stringify(cursor), userId)
    .run();
}

// ── posts upsert (idempotent; restores locally deleted posts, spec 03 §6) ───

const UPSERT_SQL = `INSERT INTO posts
  (id, user_id, channel_id, channel_service, text, created_at, year, month, dow, hour)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id, user_id) DO UPDATE SET
    text = excluded.text,
    created_at = excluded.created_at,
    channel_service = excluded.channel_service,
    year = excluded.year,
    month = excluded.month,
    dow = excluded.dow,
    hour = excluded.hour`;

export function bufferPostToRow(userId: string, post: BufferPost): PostRow {
  const at = new Date(post.createdAt * 1000);
  return {
    id: post.id,
    user_id: userId,
    channel_id: post.channelId,
    channel_service: post.service,
    text: post.text,
    created_at: post.createdAt,
    year: at.getUTCFullYear(),
    month: at.getUTCMonth(),
    dow: at.getUTCDay(),
    hour: at.getUTCHours(),
  };
}

export async function upsertPosts(env: Env, userId: string, posts: BufferPost[]): Promise<void> {
  if (posts.length === 0) return;
  // one prepared statement per row (real param binding), executed in batches
  // of 50 statements — idempotent upserts (re-sync restores deleted posts)
  const statements: D1PreparedStatement[] = posts.map((post) => {
    const r = bufferPostToRow(userId, post);
    return env.DB
      .prepare(UPSERT_SQL)
      .bind(
        r.id,
        r.user_id,
        r.channel_id,
        r.channel_service,
        r.text,
        r.created_at,
        r.year,
        r.month,
        r.dow,
        r.hour
      );
  });
  for (let i = 0; i < statements.length; i += UPSERT_CHUNK) {
    await env.DB.batch(statements.slice(i, i + UPSERT_CHUNK));
  }
}

// ── phase 1: 12-month backfill (ceiling + resume) ───────────────────────────

export interface SyncRunOpts {
  accessToken: string;
  /** unix seconds — injectable so tests control the UTC day. */
  now?: number;
}

/**
 * Backfill with an already-resolved token. startBackfill wraps this with
 * withAccessToken; tests inject a fake client directly.
 */
export async function startBackfillWith(
  env: Env,
  userId: string,
  client: BufferClient,
  opts: SyncRunOpts
): Promise<void> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const state = await ensureSyncState(env, userId);
  if (state.backfill_done) return;

  const cursor = resetBudgetIfNeeded(parseCursor(state, now), utcDayString(now));
  if (cursor.backfillReqsToday >= DAILY_REQUEST_SAFETY_STOP) {
    await persistCursor(env, userId, cursor);
    return;
  }

  let requests = cursor.backfillReqsToday;
  const channels = await client.listChannels(opts.accessToken);
  requests += 1;

  const startChannel = Math.min(Math.max(cursor.backfillChannel, 0), channels.length);
  const savedPage = Math.max(cursor.backfillPage, 1);
  let finished = true;

  for (let ci = startChannel; ci < channels.length; ci++) {
    const channel = channels[ci];
    if (!channel) break;
    let page = ci === startChannel ? savedPage : 1;
    let channelDone = false;
    while (!channelDone) {
      if (requests >= DAILY_REQUEST_SAFETY_STOP) {
        // out of budget → persist position, resume next tick/day
        finished = false;
        cursor.backfillReqsToday = requests;
        cursor.backfillChannel = ci;
        cursor.backfillPage = page;
        await persistCursor(env, userId, cursor);
        break;
      }
      const res = await client.listPosts(opts.accessToken, {
        channelId: channel.id,
        since: cursor.since,
        count: PAGE_SIZE,
        page,
      });
      requests += 1;
      await upsertPosts(env, userId, res.posts);
      cursor.backfillReqsToday = requests;
      if (res.hasMore && res.posts.length > 0) {
        page += 1;
        cursor.backfillChannel = ci;
        cursor.backfillPage = page;
        await persistCursor(env, userId, cursor);
        console.log(`${userId} backfill: page ${page}, budget ${requests}/${DAILY_REQUEST_SAFETY_STOP}`);
      } else {
        // page exhausted → next channel restarts at page 1
        channelDone = true;
        cursor.backfillChannel = ci + 1;
        cursor.backfillPage = 1;
        await persistCursor(env, userId, cursor);
      }
    }
    if (!finished) break;
  }

  if (finished) {
    // backfill complete: flip the flag and drop the resume cursor — the
    // position metadata is meaningless once every channel is drained
    await env.DB.prepare(
      "UPDATE sync_state SET backfill_done = 1, poll_cursor = NULL WHERE user_id = ?"
    )
      .bind(userId)
      .run();
  }
}

/** OAuth callback + cron entry point: resolves the token, then runs the backfill. */
export async function startBackfill(env: Env, userId: string): Promise<void> {
  const client = createBufferClient({
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
  });
  await withAccessToken(env, userId, (token) =>
    startBackfillWith(env, userId, client, { accessToken: token })
  );
}

// ── phase 2: incremental poll ───────────────────────────────────────────────

/**
 * Incremental poll with a resolved token. Advances last_polled_at ONLY when
 * the sweep completed — a budget-stop mid-window retries the same window
 * next hour instead of silently skipping posts.
 */
export async function pollIncrementalWith(
  env: Env,
  userId: string,
  client: BufferClient,
  opts: SyncRunOpts
): Promise<void> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const state = await getSyncState(env, userId);
  if (!state || !state.backfill_done) return; // nothing to poll before backfill

  const cursor = resetBudgetIfNeeded(parseCursor(state, now), utcDayString(now));
  if (cursor.backfillReqsToday >= DAILY_REQUEST_SAFETY_STOP) {
    await persistCursor(env, userId, cursor);
    return;
  }

  // poll window: last successful sweep → saved backfill window → trailing year
  const since =
    state.last_polled_at > 0
      ? state.last_polled_at
      : cursor.since > 0
        ? cursor.since
        : now - BACKFILL_WINDOW_DAYS * 86400;
  let requests = cursor.backfillReqsToday;
  const channels = await client.listChannels(opts.accessToken);
  requests += 1;

  let completed = true;
  for (const channel of channels) {
    let page = 1;
    let channelDone = false;
    while (!channelDone) {
      if (requests >= DAILY_REQUEST_SAFETY_STOP) {
        completed = false;
        break;
      }
      const res = await client.listPosts(opts.accessToken, {
        channelId: channel.id,
        since,
        count: PAGE_SIZE,
        page,
      });
      requests += 1;
      await upsertPosts(env, userId, res.posts);
      if (res.hasMore && res.posts.length > 0) {
        page += 1;
      } else {
        channelDone = true;
      }
    }
    if (!completed) break;
  }

  cursor.backfillReqsToday = requests;
  if (!completed) {
    await persistCursor(env, userId, cursor);
    return;
  }
  await env.DB.prepare(
    "UPDATE sync_state SET last_polled_at = ?, poll_cursor = ? WHERE user_id = ?"
  )
    .bind(now, JSON.stringify(cursor), userId)
    .run();
}

/** Cron entry point: resolves the token, then runs the incremental sweep. */
export async function pollIncremental(env: Env, userId: string): Promise<void> {
  const client = createBufferClient({
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
  });
  await withAccessToken(env, userId, (token) =>
    pollIncrementalWith(env, userId, client, { accessToken: token })
  );
}
