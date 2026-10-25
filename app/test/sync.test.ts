/**
 * Sync plumbing tests (spec 03 §2): fake D1 + fake BufferClient.
 * Exercises the pure resume/budget logic via the *With entry points —
 * no real tokens, no real Buffer, no real D1.
 */
import { describe, expect, it } from "vitest";
import {
  BACKFILL_WINDOW_DAYS,
  getSyncState,
  parseCursor,
  pollIncrementalWith,
  resetBudgetIfNeeded,
  startBackfillWith,
  upsertPosts,
  utcDayString,
} from "../src/worker/lib/sync";
import type { SyncCursor } from "../src/worker/lib/sync";
import type { SyncStateRow } from "../src/shared/schema";
import type { BufferChannel, BufferClient, BufferPost } from "../src/shared/types";
import type { Env } from "../src/worker/env";
import { JAN1_2025 } from "./fixtures/a";

// ── fakes ───────────────────────────────────────────────────────────────────

interface LoggedStmt {
  sql: string;
  params: unknown[];
}

class FakeD1 {
  log: LoggedStmt[] = [];
  batches: LoggedStmt[][] = [];
  state = new Map<string, { backfill_done: number; last_polled_at: number; poll_cursor: string | null }>();

  prepare(sql: string) {
    const db = this;
    return {
      bind(...params: unknown[]) {
        const exec = (): void => {
          db.log.push({ sql, params });
          db.apply(sql, params);
        };
        return {
          _exec: exec,
          run: async () => {
            exec();
            return { success: true };
          },
          first: async <T>() => {
            exec();
            return db.selectFirst(sql, params) as T | null;
          },
          all: async <T>() => ({ results: [] as T[] }),
        };
      },
    };
  }

  async batch(stmts: Array<{ _exec: () => void }>): Promise<void> {
    const group: LoggedStmt[] = [];
    const before = this.log.length;
    for (const stmt of stmts) stmt._exec();
    group.push(...this.log.slice(before));
    this.batches.push(group);
  }

  private apply(sql: string, params: unknown[]): void {
    if (sql.includes("UPDATE sync_state SET poll_cursor")) {
      const stored = this.state.get(String(params[1]));
      if (stored) stored.poll_cursor = String(params[0]);
    } else if (sql.includes("UPDATE sync_state SET backfill_done = 1")) {
      const stored = this.state.get(String(params[0]));
      if (stored) {
        stored.backfill_done = 1;
        stored.poll_cursor = null; // completion drops the resume cursor
      }
    } else if (sql.includes("UPDATE sync_state SET last_polled_at")) {
      const stored = this.state.get(String(params[2]));
      if (stored) {
        stored.last_polled_at = Number(params[0]);
        stored.poll_cursor = String(params[1]);
      }
    } else if (sql.includes("INSERT INTO sync_state")) {
      const uid = String(params[0]);
      if (!this.state.has(uid)) {
        this.state.set(uid, { backfill_done: 0, last_polled_at: 0, poll_cursor: null });
      }
    }
  }

  private selectFirst(sql: string, params: unknown[]): unknown {
    if (sql.includes("FROM sync_state")) {
      const uid = String(params[0]);
      const stored = this.state.get(uid);
      if (!stored) return null;
      const row: SyncStateRow = {
        user_id: uid,
        backfill_done: stored.backfill_done,
        last_polled_at: stored.last_polled_at,
        poll_cursor: stored.poll_cursor,
      };
      return row;
    }
    return null;
  }

  insertStmts(): LoggedStmt[] {
    return this.log.filter((s) => s.sql.includes("INSERT INTO posts"));
  }
}

function makeEnv(db: FakeD1): Env {
  return { DB: db as unknown as Env["DB"] } as unknown as Env;
}

interface ChannelPlan {
  channelId: string;
  dataPages: number; // pages that return a post with hasMore
  loop?: boolean; // never runs out (budget tests)
}

class FakeBufferClient implements BufferClient {
  listChannelsReq = 0;
  listPostsReq = 0;
  pages: { channelId: string; page: number; since?: number; count?: number }[] = [];

  constructor(private plans: ChannelPlan[]) {}

  async listChannels(): Promise<BufferChannel[]> {
    this.listChannelsReq += 1;
    return this.plans.map((p, i) => ({
      id: p.channelId,
      service: `service${i}`,
      serviceId: p.channelId,
      name: p.channelId,
    }));
  }

  async listPosts(
    _accessToken: string,
    opts: { channelId?: string; since?: number; until?: number; page?: number; count?: number }
  ): Promise<{ posts: BufferPost[]; hasMore: boolean }> {
    this.listPostsReq += 1;
    const page = opts.page ?? 1;
    this.pages.push({
      channelId: opts.channelId ?? "",
      page,
      since: opts.since,
      count: opts.count,
    });
    const plan = this.plans.find((p) => p.channelId === opts.channelId);
    if (plan && (plan.loop || page <= plan.dataPages)) {
      const post: BufferPost = {
        id: `${plan.channelId}-${page}`,
        channelId: plan.channelId,
        service: "service",
        text: `post ${plan.channelId} page ${page}`,
        createdAt: 1_735_363_200 + page * 60,
      };
      return { posts: [post], hasMore: true };
    }
    return { posts: [], hasMore: false };
  }

  async getProfile(): Promise<never> {
    throw new Error("unused in sync tests");
  }
  async createPost(): Promise<never> {
    throw new Error("unused in sync tests");
  }
  async refreshAccessToken(): Promise<never> {
    throw new Error("unused in sync tests");
  }
}

// ── shared clock ────────────────────────────────────────────────────────────

const NOW = 1_800_000_000; // 2027-01-15T04:00:00Z
const TODAY = utcDayString(NOW);
const SINCE = 1_700_000_000;

function seedState(db: FakeD1, userId: string, patch: Partial<SyncStateRow> = {}): void {
  db.state.set(userId, {
    user_id: userId,
    backfill_done: 0,
    last_polled_at: 0,
    poll_cursor: null,
    ...patch,
  });
}

function cursorPatch(overrides: Partial<SyncCursor> = {}): string {
  return JSON.stringify({
    backfillReqsToday: 0,
    backfillDay: TODAY,
    backfillChannel: 0,
    backfillPage: 1,
    since: SINCE,
    ...overrides,
  });
}

// ── upsertPosts ─────────────────────────────────────────────────────────────

describe("upsertPosts", () => {
  it("emits ON CONFLICT upserts chunked into batches of 50", async () => {
    const db = new FakeD1();
    const posts = Array.from({ length: 120 }, (_, i) => ({
      id: `p${i}`,
      channelId: "c1",
      service: "twitter",
      text: `post ${i}`,
      createdAt: JAN1_2025 + i * 3600,
    }));
    await upsertPosts(makeEnv(db), "u1", posts);

    const inserts = db.insertStmts();
    expect(inserts).toHaveLength(120);
    expect(db.batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(inserts[0]?.sql).toContain("ON CONFLICT (id, user_id) DO UPDATE SET");
  });

  it("maps BufferPost to PostRow with UTC year/month/dow/hour", async () => {
    const db = new FakeD1();
    const jan1 = JAN1_2025; // a Wednesday, 00:00 UTC
    await upsertPosts(makeEnv(db), "u1", [
      { id: "p1", channelId: "c1", service: "twitter", text: "hello", createdAt: jan1 },
    ]);
    const params = db.insertStmts()[0]?.params ?? [];
    expect(params[0]).toBe("p1");
    expect(params[1]).toBe("u1");
    expect(params[2]).toBe("c1");
    expect(params[3]).toBe("twitter");
    expect(params[5]).toBe(jan1);
    expect(params[6]).toBe(2025);
    expect(params[7]).toBe(0); // month
    expect(params[8]).toBe(3); // Wednesday
    expect(params[9]).toBe(0); // hour
  });

  it("no-ops on empty input", async () => {
    const db = new FakeD1();
    await upsertPosts(makeEnv(db), "u1", []);
    expect(db.batches).toHaveLength(0);
    expect(db.insertStmts()).toHaveLength(0);
  });
});

// ── getSyncState / parseCursor ──────────────────────────────────────────────

describe("getSyncState", () => {
  it("returns the stored row and null for unknown users", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { backfill_done: 1, last_polled_at: 42 });
    const found = await getSyncState(makeEnv(db), "u1");
    expect(found).toMatchObject({ user_id: "u1", backfill_done: 1, last_polled_at: 42 });
    expect(await getSyncState(makeEnv(db), "ghost")).toBeNull();
  });
});

describe("parseCursor", () => {
  it("defaults on a null row", () => {
    const c = parseCursor(null);
    expect(c.backfillReqsToday).toBe(0);
    expect(c.backfillChannel).toBe(0);
    expect(c.backfillPage).toBe(1);
    expect(c.backfillDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expectedSince = Math.floor(Date.now() / 1000) - BACKFILL_WINDOW_DAYS * 86400;
    expect(Math.abs(c.since - expectedSince)).toBeLessThan(5);
  });

  it("parses stored JSON and fills missing fields", () => {
    const row: SyncStateRow = {
      user_id: "u1",
      backfill_done: 0,
      last_polled_at: 0,
      poll_cursor: JSON.stringify({ backfillReqsToday: 12, backfillPage: 4, since: SINCE }),
    };
    const c = parseCursor(row);
    expect(c.backfillReqsToday).toBe(12);
    expect(c.backfillPage).toBe(4);
    expect(c.since).toBe(SINCE);
    expect(c.backfillChannel).toBe(0);
    expect(c.backfillDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const row: SyncStateRow = {
      user_id: "u1",
      backfill_done: 0,
      last_polled_at: 0,
      poll_cursor: "{{not json",
    };
    const c = parseCursor(row);
    expect(c.backfillReqsToday).toBe(0);
    expect(c.backfillPage).toBe(1);
  });
});

describe("resetBudgetIfNeeded", () => {
  it("resets the counter on a new UTC day, keeping since and position", () => {
    const rolled = resetBudgetIfNeeded(
      {
        backfillReqsToday: 239,
        backfillDay: "2020-01-01",
        backfillChannel: 2,
        backfillPage: 5,
        since: SINCE,
      },
      "2025-06-01"
    );
    expect(rolled.backfillReqsToday).toBe(0);
    expect(rolled.backfillDay).toBe("2025-06-01");
    expect(rolled.since).toBe(SINCE);
    expect(rolled.backfillChannel).toBe(2);
    expect(rolled.backfillPage).toBe(5);
  });

  it("keeps the counter on the same day", () => {
    const c: SyncCursor = {
      backfillReqsToday: 7,
      backfillDay: "2025-06-01",
      backfillChannel: 0,
      backfillPage: 1,
      since: SINCE,
    };
    expect(resetBudgetIfNeeded(c, "2025-06-01")).toBe(c);
  });
});

// ── backfill ────────────────────────────────────────────────────────────────

describe("startBackfillWith", () => {
  it("stops at the 240-request safety stop and persists the cursor per page", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { poll_cursor: cursorPatch() });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0, loop: true }]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.listChannelsReq).toBe(1);
    expect(client.listPostsReq).toBe(239); // 1 (channels) + 239 pages = 240
    expect(db.state.get("u1")?.backfill_done).toBe(0);
    const saved = JSON.parse(db.state.get("u1")?.poll_cursor ?? "{}") as SyncCursor;
    expect(saved.backfillReqsToday).toBe(240);
    expect(saved.backfillPage).toBe(240);
    expect(saved.backfillChannel).toBe(0);
    expect(saved.since).toBe(SINCE);
    const cursorWrites = db.log.filter((s) => s.sql.includes("UPDATE sync_state SET poll_cursor"));
    expect(cursorWrites.length).toBe(240); // after every page + final stop
  });

  it("makes zero requests when today's budget is already exhausted", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { poll_cursor: cursorPatch({ backfillReqsToday: 240 }) });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0, loop: true }]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.listChannelsReq).toBe(0);
    expect(client.listPostsReq).toBe(0);
  });

  it("resumes from the saved page after a simulated restart", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { poll_cursor: cursorPatch({ backfillPage: 3 }) });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0, loop: true }]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.pages[0]?.page).toBe(3);
    expect(client.pages[0]?.channelId).toBe("ch1");
  });

  it("resets the budget on a new UTC day and keeps the resume position", async () => {
    const db = new FakeD1();
    seedState(db, "u1", {
      poll_cursor: cursorPatch({ backfillReqsToday: 239, backfillPage: 5, backfillDay: "2020-01-01" }),
    });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0, loop: true }]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.pages[0]?.page).toBe(5); // position kept across the day roll
    const saved = JSON.parse(db.state.get("u1")?.poll_cursor ?? "{}") as SyncCursor;
    expect(saved.backfillDay).toBe(TODAY);
    expect(saved.backfillReqsToday).toBe(240); // ran a fresh full budget
    expect(saved.since).toBe(SINCE); // window unchanged
  });

  it("flips backfill_done and drops the cursor when every channel is exhausted, then stays idempotent", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { poll_cursor: cursorPatch() });
    const client = new FakeBufferClient([
      { channelId: "ch1", dataPages: 1 },
      { channelId: "ch2", dataPages: 0 },
    ]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.listPostsReq).toBe(3); // ch1: page1 + terminator; ch2: terminator
    const stored = db.state.get("u1");
    expect(stored?.backfill_done).toBe(1);
    expect(stored?.poll_cursor).toBeNull(); // resume position is meaningless now

    const reqsAfterFirst = client.listPostsReq;
    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });
    expect(client.listPostsReq).toBe(reqsAfterFirst);
  });

  it("continues with the next channel after one finishes", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { poll_cursor: cursorPatch() });
    const client = new FakeBufferClient([
      { channelId: "ch1", dataPages: 1 },
      { channelId: "ch2", dataPages: 1 },
    ]);

    await startBackfillWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    const ch2First = client.pages.find((p) => p.channelId === "ch2");
    expect(ch2First?.page).toBe(1); // next channel restarts at page 1
    expect(db.state.get("u1")?.backfill_done).toBe(1);
  });
});

// ── incremental poll ────────────────────────────────────────────────────────

describe("pollIncrementalWith", () => {
  it("sweeps since last_polled_at and advances it on completion", async () => {
    const db = new FakeD1();
    seedState(db, "u1", {
      backfill_done: 1,
      last_polled_at: 1_000,
      poll_cursor: cursorPatch({ backfillReqsToday: 5, backfillPage: 2, backfillChannel: 1 }),
    });
    const client = new FakeBufferClient([
      { channelId: "ch1", dataPages: 1 },
      { channelId: "ch2", dataPages: 0 },
    ]);

    await pollIncrementalWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.pages.length).toBeGreaterThan(0);
    expect(client.pages.every((p) => p.since === 1_000)).toBe(true);
    const stored = db.state.get("u1");
    expect(stored?.last_polled_at).toBe(NOW);
    const saved = JSON.parse(stored?.poll_cursor ?? "{}") as SyncCursor;
    expect(saved.backfillReqsToday).toBe(9); // 5 carried + channels + 3 pages
    expect(saved.backfillPage).toBe(2); // cursor metadata preserved
    expect(saved.backfillChannel).toBe(1);
  });

  it("uses the backfill window as `since` on first poll", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { backfill_done: 1, last_polled_at: 0, poll_cursor: null });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0 }]);

    await pollIncrementalWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.pages[0]?.since).toBe(NOW - BACKFILL_WINDOW_DAYS * 86400);
    expect(db.state.get("u1")?.last_polled_at).toBe(NOW);
  });

  it("falls back to the saved cursor window when last_polled_at is unset", async () => {
    const db = new FakeD1();
    seedState(db, "u1", {
      backfill_done: 1,
      last_polled_at: 0,
      poll_cursor: cursorPatch({ since: SINCE }),
    });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0 }]);

    await pollIncrementalWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.pages[0]?.since).toBe(SINCE);
    expect(db.state.get("u1")?.last_polled_at).toBe(NOW);
  });

  it("does not advance last_polled_at when the budget stops mid-sweep", async () => {
    const db = new FakeD1();
    seedState(db, "u1", {
      backfill_done: 1,
      last_polled_at: 777,
      poll_cursor: cursorPatch({ backfillReqsToday: 239 }),
    });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0, loop: true }]);

    await pollIncrementalWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(db.state.get("u1")?.last_polled_at).toBe(777); // window retries next hour
    expect(client.listPostsReq).toBe(0); // listChannels alone hit the ceiling
  });

  it("skips accounts whose backfill has not completed", async () => {
    const db = new FakeD1();
    seedState(db, "u1", { backfill_done: 0 });
    const client = new FakeBufferClient([{ channelId: "ch1", dataPages: 0 }]);

    await pollIncrementalWith(makeEnv(db), "u1", client, { accessToken: "tok", now: NOW });

    expect(client.listChannelsReq).toBe(0);
    expect(client.listPostsReq).toBe(0);
  });
});
