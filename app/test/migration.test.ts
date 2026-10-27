/**
 * T04 — D1 migration ⇄ row-types lockstep tests (spec 01 §3).
 * Reads migrations/0001_init.sql and src/shared/schema.ts from disk and
 * proves: all 6 tables + the 2 posts indexes exist, every table has a mirror
 * row interface (and vice versa, column by column), token material lives in
 * BLOB columns, and no banned copy leaks into either file.
 *
 * Note on node:fs: the worker tsconfig pins types to @cloudflare/workers-types
 * (no @types/node), so a static `import from "node:fs"` fails typecheck. Vitest
 * runs in Node ≥ 22.3, so fs is loaded via process.getBuiltinModule and typed
 * locally — no `any`, no suppression directives.
 */
import { describe, expect, it } from "vitest";

type FsLike = { readFileSync(path: string, encoding: "utf8"): string };

function loadFs(): FsLike {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const mod = proc?.getBuiltinModule?.("node:fs") as FsLike | undefined;
  if (!mod || typeof mod.readFileSync !== "function") {
    throw new Error("node:fs unavailable — migration tests need Node >= 22.3 (process.getBuiltinModule)");
  }
  return mod;
}

const fs = loadFs();
// workers-types' ImportMeta has no `url`, but vite-node always provides it at runtime
const hereUrl = (import.meta as unknown as { url: string }).url;
const sql = fs.readFileSync(new URL("../migrations/0001_init.sql", hereUrl).pathname, "utf8");
const sql2 = fs.readFileSync(new URL("../migrations/0002_share_links.sql", hereUrl).pathname, "utf8");
const schemaSrc = fs.readFileSync(new URL("../src/shared/schema.ts", hereUrl).pathname, "utf8");

interface TableDef {
  name: string;
  body: string; // raw column-list text, comments kept
  columns: string[]; // declared column names, in order, deduped
}

const CONSTRAINT_STARTERS = /^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)$/i;

/** table name → its schema.ts row interface */
const TABLE_TO_ROW: Record<string, string> = {
  users: "UserRow",
  buffer_tokens: "BufferTokenRow",
  posts: "PostRow",
  sync_state: "SyncStateRow",
  metrics_tokens: "MetricsTokenRow",
  ai_cache: "AiCacheRow",
  share_links: "ShareLinkRow",
};

function parseCreateTables(source: string): Map<string, TableDef> {
  const tables = new Map<string, TableDef>();
  const re = /CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue;
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const line of body.replace(/--[^\n]*/g, "").split("\n")) {
      for (const fragment of line.split(",")) {
        const token = (fragment.trim().split(/\s+/)[0] ?? "").replace(/[()]/g, "");
        if (token === "" || CONSTRAINT_STARTERS.test(token)) continue;
        if (!seen.has(token)) {
          seen.add(token);
          columns.push(token);
        }
      }
    }
    tables.set(name, { name, body, columns });
  }
  return tables;
}

function interfaceBody(source: string, name: string): string | null {
  const match = source.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? null;
}

function interfaceProps(body: string): string[] {
  const props: string[] = [];
  for (const match of body.matchAll(/^\s*(\w+)\s*:/gm)) {
    const name = match[1];
    if (name !== undefined) props.push(name);
  }
  return props;
}

const tables = parseCreateTables(`${sql}\n${sql2}`);

describe("0001_init.sql (spec 01 §3)", () => {
  it("declares exactly the 6 tables of the spec", () => {
    expect((sql.match(/CREATE TABLE /g) ?? []).length).toBe(6);
    expect([...parseCreateTables(sql).keys()].sort()).toEqual(
      ["ai_cache", "buffer_tokens", "metrics_tokens", "posts", "sync_state", "users"]
    );
  });

  it("declares the posts indexes (deck ordering + unique upserts)", () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_posts_user_time\s+ON\s+posts\s*\(/);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_posts_unique\s+ON\s+posts\s*\(/);
  });

  it("keeps token material in BLOB columns (AES-GCM ciphertext at rest)", () => {
    const tokens = tables.get("buffer_tokens");
    expect(tokens, "migration must declare buffer_tokens").toBeDefined();
    if (tokens) {
      for (const column of ["access_enc", "refresh_enc", "iv", "salt"] as const) {
        expect(
          new RegExp(`\\b${column}\\s+BLOB\\b`).test(tokens.body),
          `buffer_tokens.${column} must be BLOB`
        ).toBe(true);
      }
    }
    const metrics = tables.get("metrics_tokens");
    expect(metrics, "migration must declare metrics_tokens").toBeDefined();
    if (metrics) {
      expect(new RegExp("\\bpat_enc\\s+BLOB\\b").test(metrics.body)).toBe(true);
    }
  });
});

describe("0002_share_links.sql (feature 6)", () => {
  it("declares exactly the share_links table", () => {
    expect([...parseCreateTables(sql2).keys()]).toEqual(["share_links"]);
  });

  it("makes share_id a unique capability slug and enabled a strict 0/1", () => {
    const def = tables.get("share_links");
    expect(def, "0002 must declare share_links").toBeDefined();
    if (!def) return;
    expect(def.body).toMatch(/\bshare_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/);
    expect(def.body).toMatch(/\benabled\s+INTEGER[\s\S]*CHECK\s*\(enabled\s+IN\s*\(0,1\)\)/);
    expect(def.body).toMatch(/\brev\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0\b/);
  });
});

describe("schema.ts ⇄ migration lockstep", () => {
  it.each(Object.entries(TABLE_TO_ROW))(
    "%s is mirrored by interface %s, column for column",
    (table, rowInterface) => {
      const def = tables.get(table);
      expect(def, `migration must declare CREATE TABLE ${table}`).toBeDefined();
      expect(
        schemaSrc,
        `schema.ts must export interface ${rowInterface}`
      ).toMatch(new RegExp(`export interface ${rowInterface}\\b`));
      if (!def) return;
      const body = interfaceBody(schemaSrc, rowInterface);
      expect(body, `interface ${rowInterface} must have a body`).not.toBeNull();
      if (body === null) return;
      for (const column of def.columns) {
        expect(
          new RegExp(`\\b${column}\\b`).test(body),
          `interface ${rowInterface} lacks migration column ${column}`
        ).toBe(true);
      }
      for (const prop of interfaceProps(body)) {
        expect(
          def.columns,
          `${rowInterface}.${prop} has no matching column in ${table}`
        ).toContain(prop);
      }
    }
  );
});

describe("guardrails", () => {
  it("mentions the banned brand-conflict word nowhere", () => {
    // assembled at runtime — the literal itself may not appear in source
    const banned = ["wr", "app", "ed"].join("");
    const bannedRe = new RegExp(banned, "i");
    expect(bannedRe.test(sql)).toBe(false);
    expect(bannedRe.test(schemaSrc)).toBe(false);
  });
});
