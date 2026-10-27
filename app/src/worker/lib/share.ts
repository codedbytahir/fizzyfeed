/**
 * Deterministic card-share composition (task #5) — pure string assembly from
 * a deck CardData (+ YearStats for the kickoff year line). No AI, no I/O, no
 * Date.now(): identical input always yields identical text, so the preview
 * the user consented to and the queued post can never disagree. Numbers are
 * verbatim from the card/stats only (en-US grouping, one decimal for floats),
 * copy is lowercase per brand law, ≤ 500 chars, and the last line is a
 * BRAND_NAME sign-off ending with the app-origin link.
 *
 * The consent-gated Buffer write that consumes this text lives in
 * routes/share.ts (mirrors routes/recap.ts).
 */
import { BRAND_NAME } from "../../shared/brand";
import type { CardData, YearStats } from "../../shared/types";

/** Server-side hard cap for share text (mirrors RECAP_MAX_CHARS). */
export const SHARE_MAX_CHARS = 500;

const CHAPTER_LABELS: Record<CardData["kind"], string> = {
  kickoff: "kickoff",
  rhythm: "rhythm",
  streaks: "streaks",
  mix: "the mix",
  peaks: "peaks",
  persona: "alter ego",
  recap: "the recap",
};

/** Enforce the lowercase copy law on card-derived labels (render.ts convention). */
function lc(s: string): string {
  return s.toLowerCase();
}

/** Text safety valve — keeps long card fields from blowing the layout budget. */
function clamp(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Tabular-friendly number: integers grouped, floats at one decimal. */
function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Per-kind detail line — honest numbers from the card (and stats) only. */
function detailLine(card: CardData, stats: YearStats): string {
  switch (card.kind) {
    case "kickoff": {
      // empty decks never reach here via routes (409 empty_deck first)
      const started = card.date
        ? `it started on ${lc(clamp(card.date, 40))}, ${stats.year}`
        : `your ${stats.year} in posts`;
      return `${started} — first post: ${clamp(card.excerpt, 120)}`;
    }
    case "rhythm":
      return `${lc(card.bestDow)}s at ${lc(card.favoriteHour)} — ${fmtNum(card.postsPerWeek)} posts a week`;
    case "streaks":
      return `longest streak: ${fmtNum(card.longest)} days · ${fmtNum(card.busiestWeekPosts)} posts in the busiest week`;
    case "mix": {
      const parts = card.channels
        .slice(0, 3)
        .map((ch) => `${lc(ch.service)} ${fmtNum(ch.pct)}%`);
      if (parts.length === 0) return "the mix: no channel breakdown yet";
      const topics = card.topTopics.slice(0, 3);
      const base = `the mix: ${parts.join(", ")}`;
      return topics.length > 0 ? `${base} · talking about: ${topics.join(", ")}` : base;
    }
    case "peaks":
      return `${lc(card.bestMonth)} was the biggest month — ${fmtNum(card.bestMonthPosts)} posts`;
    case "persona":
      return `alter ego: ${lc(clamp(card.name, 28))} — ${clamp(card.origin, 90)}`;
    case "recap": {
      const t = card.totals;
      return `${fmtNum(t.posts)} posts · ${fmtNum(t.words)} words · ${fmtNum(t.activeDays)} active days · ${fmtNum(t.channels)} channels`;
    }
  }
}

/**
 * The exact share template family: "chapter NN — <kind>" header, one detail
 * line, then the BRAND_NAME sign-off whose link ends the text. Deterministic
 * per kind; never invents a number that isn't on the card or stats.
 */
export function composeShareText(card: CardData, stats: YearStats, appOrigin: string): string {
  const label = CHAPTER_LABELS[card.kind] ?? card.kind;
  const lines: string[] = [
    `chapter ${String(card.n).padStart(2, "0")} — ${label}`,
    detailLine(card, stats),
    `made with ${BRAND_NAME} → ${appOrigin}`,
  ];
  return lines.join("\n");
}

export type ShareTextVerdict = { ok: true } | { ok: false; reason: string };

/**
 * C0 control characters EXCEPT \n (line breaks are legitimate post copy, the
 * composed templates are multi-line) and \t — plus DEL. Everything else in
 * the range can corrupt form encoding or downstream rendering.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** Server-side guard for the (possibly user-edited) share text. */
export function validateShareText(text: string): ShareTextVerdict {
  if (text.trim().length === 0) return { ok: false, reason: "text is empty" };
  if (text.length > SHARE_MAX_CHARS) return { ok: false, reason: "text exceeds 500 characters" };
  if (CONTROL_CHARS.test(text)) return { ok: false, reason: "text contains control characters" };
  return { ok: true };
}
