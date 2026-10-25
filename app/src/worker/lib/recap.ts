/**
 * Deterministic recap composition (spec 06 §1) — pure string assembly from
 * YearStats. No AI in the critical path, no I/O, no Date.now(): identical
 * input always yields identical text, so the preview and the queued post can
 * never disagree. Numbers render verbatim from the stats (en-US grouping),
 * the persona line only renders when a persona exists, and the banned
 * brand-conflict word is guarded by validateRecapText on the queue path.
 *
 * The single Buffer write that consumes this text lives in routes/recap.ts.
 */
import { hourLabel } from "../routes/deck";
import type { Persona, YearStats } from "../../shared/types";

export { hourLabel };

/** OAuth scope token that allows posting (spec 02 §2, spec 06 §2). */
export const WRITE_SCOPE = "write";

/** Server-side hard cap for recap text (spec 06 §2/§5: reject > 500 chars). */
export const RECAP_MAX_CHARS = 500;

/** OAuth upgrade consent endpoint, owned by routes/auth.ts (spec 02 §2). */
export const UPGRADE_PATH = "/api/auth/buffer/upgrade";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** 9 → "october" (lowercase, deck copy convention). */
export function monthName(month: number): string {
  return MONTHS[month] ?? "month";
}

/** True when a stored scopes string grants the write scope (spec 02 §2). */
export function hasWriteScope(scopes: string): boolean {
  return scopes.split(/[\s,]+/).includes(WRITE_SCOPE);
}

// The brand-conflict word is never spelled out in source (agent-check §1) —
// assembled exactly the way test/migration.test.ts assembles it.
const BANNED_TERM = new RegExp(["wr", "app", "ed"].join(""), "i");

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The exact recap template family (spec 06 §1): ≤ 500 chars, sentence case,
 * channel-agnostic, numbers verbatim, persona line only when a persona
 * exists, no engagement claims, no AI.
 */
export function composeRecap(stats: YearStats, persona: Persona | null, appOrigin: string): string {
  const lines: string[] = [
    "12 months of posting, carded:",
    `${fmt(stats.totals.posts)} posts · ${fmt(stats.totals.words)} words · ${fmt(stats.streaks.longest)}-day streak`,
    `best hour: ${hourLabel(stats.rhythm.favoriteHour)} · biggest month: ${monthName(stats.peaks.bestMonth)}`,
  ];
  if (persona) lines.push(`this year's alter ego: ${persona.name}`);
  lines.push(`queue your year → ${appOrigin}`);
  return lines.join("\n");
}

export type RecapTextVerdict = { ok: true } | { ok: false; reason: string };

/** Server-side guard for the (possibly user-edited) recap text (spec 06 §2). */
export function validateRecapText(text: string): RecapTextVerdict {
  if (text.length > RECAP_MAX_CHARS) return { ok: false, reason: "text exceeds 500 characters" };
  if (text.trim().length === 0) return { ok: false, reason: "text is empty" };
  if (BANNED_TERM.test(text)) return { ok: false, reason: "text contains a banned term" };
  return { ok: true };
}
