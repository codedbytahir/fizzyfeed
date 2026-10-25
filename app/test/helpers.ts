/**
 * Hand-rolled test doubles for the D1/KV/ExecutionContext bindings (vitest node
 * env). The D1 fake implements exactly the statements the worker issues — any
 * unknown SQL throws, so schema drift fails loudly. Keys are random per run so
 * no secret material is ever committed.
 */
import type { Env } from "../src/worker/env";

export type Row = Record<string, unknown>;

export interface CapturedStatement {
  sql: string;
  params: unknown[];
}

export interface BoundStub {
  readonly sql: string;
  readonly params: unknown[];
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: true }>;
}

export class FakeD1 {
  /** every executed statement, in order (incl. statements inside batches) */
  readonly log: CapturedStatement[] = [];
  /** one entry per batch() call — snapshots of sql + params */
  readonly batches: CapturedStatement[][] = [];

  readonly users = new Map<string, Row>(); // by buffer_id
  readonly usersById = new Map<string, Row>(); // by id
  readonly tokens = new Map<string, Row>(); // buffer_tokens, by user_id
  readonly syncState = new Map<string, Row>(); // sync_state, by user_id
  readonly metricsTokens = new Map<string, Row>(); // metrics_tokens, by user_id

  prepare(sql: string): BoundStub & { bind: (...params: unknown[]) => BoundStub } {
    const db = this;
    const make = (params: unknown[]): BoundStub => ({
      sql,
      params,
      first: async <T = Row>(): Promise<T | null> =>
        ((await db.exec(sql, params)) as unknown as T[])[0] ?? null,
      all: async <T = Row>(): Promise<{ results: T[] }> => ({
        results: (await db.exec(sql, params)) as unknown as T[],
      }),
      run: async (): Promise<{ success: true }> => {
        await db.exec(sql, params);
        return { success: true };
      },
    });
    return {
      ...make([]),
      bind: (...params: unknown[]) => make(params),
    };
  }

  async batch(statements: BoundStub[]): Promise<unknown[]> {
    this.batches.push(statements.map((s) => ({ sql: s.sql, params: s.params })));
    const out: unknown[] = [];
    for (const stmt of statements) {
      await this.exec(stmt.sql, stmt.params);
      out.push({ success: true });
    }
    return out;
  }

  private async exec(sql: string, params: unknown[]): Promise<Row[]> {
    this.log.push({ sql, params });
    const q = sql.replace(/\s+/g, " ").trim();

    if (q.startsWith("INSERT INTO users")) {
      const [id, bufferId, displayName, avatarUrl, createdAt, updatedAt] = params as [
        string,
        string,
        string,
        string | null,
        number,
        number
      ];
      const existing = this.users.get(bufferId);
      if (existing) {
        existing["display_name"] = displayName;
        existing["avatar_url"] = avatarUrl;
        existing["updated_at"] = updatedAt;
        return [];
      }
      const row: Row = {
        id,
        buffer_id: bufferId,
        display_name: displayName,
        avatar_url: avatarUrl,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      this.users.set(bufferId, row);
      this.usersById.set(id, row);
      return [];
    }
    if (q.startsWith("SELECT id FROM users WHERE buffer_id")) {
      const row = this.users.get(String(params[0]));
      return row ? [{ id: row["id"] }] : [];
    }
    if (q.startsWith("SELECT id, display_name, avatar_url FROM users WHERE id")) {
      const row = this.usersById.get(String(params[0]));
      return row ? [row] : [];
    }

    if (q.startsWith("INSERT INTO buffer_tokens")) {
      const [userId, accessEnc, refreshEnc, iv, salt, expiresAt, scopes, rotatedAt] = params;
      const row: Row = {
        user_id: userId,
        access_enc: accessEnc,
        refresh_enc: refreshEnc,
        iv,
        salt,
        expires_at: expiresAt,
        scopes,
        rotated_at: rotatedAt,
      };
      const existing = this.tokens.get(String(userId));
      this.tokens.set(String(userId), existing ? { ...existing, ...row } : row);
      return [];
    }
    if (q.startsWith("SELECT user_id, access_enc")) {
      const row = this.tokens.get(String(params[0]));
      return row ? [row] : [];
    }
    if (q.startsWith("SELECT user_id FROM buffer_tokens")) {
      const horizon = Number(params[0]);
      return [...this.tokens.values()]
        .filter((r) => Number(r["expires_at"]) < horizon)
        .map((r) => ({ user_id: r["user_id"] }));
    }
    if (q.startsWith("UPDATE buffer_tokens")) {
      const row = this.tokens.get(String(params[6]));
      if (!row) return [];
      row["access_enc"] = params[0];
      row["refresh_enc"] = params[1];
      row["iv"] = params[2];
      row["salt"] = params[3];
      row["expires_at"] = params[4];
      row["rotated_at"] = params[5];
      return [];
    }

    if (q.startsWith("INSERT INTO sync_state")) {
      const userId = String(params[0]);
      if (!this.syncState.has(userId)) {
        this.syncState.set(userId, {
          user_id: userId,
          backfill_done: 0,
          last_polled_at: 0,
          poll_cursor: null,
        });
      }
      return [];
    }
    if (q.startsWith("SELECT backfill_done")) {
      const row = this.syncState.get(String(params[0]));
      return row ? [{ backfill_done: row["backfill_done"] }] : [];
    }
    if (q.startsWith("UPDATE sync_state")) {
      const row = this.syncState.get(String(params[1]));
      if (row) row["last_polled_at"] = params[0];
      return [];
    }

    if (q.startsWith("DELETE FROM buffer_tokens")) {
      this.tokens.delete(String(params[0]));
      return [];
    }
    if (q.startsWith("DELETE FROM sync_state")) {
      this.syncState.delete(String(params[0]));
      return [];
    }
    if (q.startsWith("DELETE FROM metrics_tokens")) {
      this.metricsTokens.delete(String(params[0]));
      return [];
    }

    throw new Error(`FakeD1: unhandled sql: ${sql}`);
  }
}

export class FakeKV {
  readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Stand-in for the Workers ExecutionContext — records waitUntil tasks. */
export class FakeExecutionContext {
  readonly tasks: Promise<unknown>[] = [];
  waitUntil(p: Promise<unknown>): void {
    this.tasks.push(p);
  }
  passThroughOnException(): void {}
  /** await all tracked tasks (settled — failures surface via console spies) */
  async settle(): Promise<void> {
    await Promise.allSettled(this.tasks);
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface TestRig {
  env: Env;
  db: FakeD1;
  kv: FakeKV;
}

export function createTestRig(): TestRig {
  const db = new FakeD1();
  const kv = new FakeKV();
  const env: Env = {
    DB: db as unknown as Env["DB"],
    CACHE: kv as unknown as Env["CACHE"],
    AI: {} as unknown as Env["AI"],
    ASSETS: {} as unknown as Env["ASSETS"],
    BUFFER_CLIENT_ID: "test-client",
    BUFFER_REDIRECT_URI: "https://app.test/api/auth/buffer/callback",
    APP_ORIGIN: "https://app.test",
    BUFFER_CLIENT_SECRET: "test-secret",
    // random per run — never commit key material
    SESSION_SECRET: toBase64(crypto.getRandomValues(new Uint8Array(32))),
    TOKEN_AES_KEY: toBase64(crypto.getRandomValues(new Uint8Array(32))),
  };
  return { env, db, kv };
}

// ── small shared helpers ────────────────────────────────────────────────────

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function asU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new Error("expected bytes param");
}

/** undici exposes getSetCookie() at runtime; the ES2022 lib lacks the type. */
export function getSetCookie(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

export function cookieValue(res: Response, name: string): string {
  const raw = getSetCookie(res).find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`no ${name} cookie on response`);
  return raw.split(";")[0] ?? "";
}

export function cookieIsCleared(res: Response, name: string): boolean {
  return getSetCookie(res).some((c) => c.startsWith(`${name}=;`) && c.includes("Max-Age=0"));
}
