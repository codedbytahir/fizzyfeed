/**
 * Fixture A — year 2025: a 141-day consecutive-day streak (2025-07-13 …
 * 2025-11-30) plus 59 posts scattered on days 2+ days away from the streak
 * and from each other, so longest stays exactly 141. 200 rows across 2
 * channels, every row in-year.
 *
 * This file also hosts the CANONICAL deterministic PostRow builders for the
 * yearize fixtures/tests (agent 4-c's owned files) — fixtures b/c and both
 * test suites import them from here, so parallel edits to the shared
 * test/helpers.ts cannot break this suite.
 */
import type { PostRow } from "../../src/shared/schema";

export const SEC_PER_DAY = 86400;

export const JAN1_2025 = Date.UTC(2025, 0, 1) / 1000; // 1735689600
export const JUL13_2025 = Date.UTC(2025, 6, 13) / 1000; // fixture-A streak day 1

let seq = 0;

/**
 * Build a PostRow with sane defaults; year/month/dow/hour are derived from
 * created_at (UTC) unless explicitly overridden, so rows stay self-consistent.
 */
export function row(overrides: Partial<PostRow> = {}): PostRow {
  seq += 1;
  const createdAt = overrides.created_at ?? JAN1_2025 + 12 * 3600;
  const at = new Date(createdAt * 1000);
  return {
    id: overrides.id ?? `post-${String(seq).padStart(6, "0")}`,
    user_id: overrides.user_id ?? "user-test",
    channel_id: overrides.channel_id ?? "chan-a",
    channel_service: overrides.channel_service ?? "twitter",
    text: overrides.text ?? "a fixed test post",
    created_at: createdAt,
    year: overrides.year ?? at.getUTCFullYear(),
    month: overrides.month ?? at.getUTCMonth(),
    dow: overrides.dow ?? at.getUTCDay(),
    hour: overrides.hour ?? at.getUTCHours(),
  };
}

/**
 * mulberry32 — tiny deterministic PRNG (public-domain reference algorithm,
 * constants in decimal). Same seed → same sequence on every platform.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 1831565813) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── fixture A rows ──────────────────────────────────────────────────────────

const streak: PostRow[] = Array.from({ length: 141 }, (_, i) =>
  row({
    created_at: JUL13_2025 + i * SEC_PER_DAY + (i % 20) * 3600, // same UTC day
    channel_id: i % 2 === 0 ? "chan-alpha" : "chan-beta",
    channel_service: i % 2 === 0 ? "twitter" : "instagram",
    text: `streak day ${i + 1} shipping the thing again`,
  })
);

// 44 posts Jan→Jun at 4-day spacing (last: Jun 22, 21 days before the streak)
const spring: PostRow[] = Array.from({ length: 44 }, (_, k) =>
  row({
    created_at: JUL13_2025 - 193 * SEC_PER_DAY + k * 4 * SEC_PER_DAY, // Jan 1 2025 + 4k days
    channel_id: "chan-alpha",
    channel_service: "twitter",
    text: `scattered spring post number ${k + 1}`,
  })
);

// 15 posts Dec 3…Dec 31 on odd days (2-day gaps, clear of Dec 1)
const december: PostRow[] = Array.from({ length: 15 }, (_, k) =>
  row({
    created_at: JUL13_2025 + 143 * SEC_PER_DAY + k * 2 * SEC_PER_DAY, // Dec 3 = streak end + 3 days
    channel_id: "chan-beta",
    channel_service: "instagram",
    text: `scattered december post number ${k + 1}`,
  })
);

export const fixA: PostRow[] = [...streak, ...spring, ...december];
