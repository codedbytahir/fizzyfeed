/**
 * YearStats aggregates (spec 03 §3) — pure functions, UTC calendar math.
 *
 * No I/O, no Date.now(): identical input always produces identical output
 * (deterministic for statsHash8 card cache keys). Honest numbers only —
 * counts are real zeros when there are no posts, firstPost is null for an
 * empty account, and topTopics only lists terms that actually recur.
 */
import type { PostRow } from "../../shared/schema";
import type { YearStats } from "../../shared/types";

const SEC_PER_DAY = 86400;
const EXCERPT_LEN = 80;
const TOPIC_LIMIT = 5;
const TOPIC_MIN_LEN = 3;

/** Small English stopword list for topTopics (exported for tests). */
export const STOPWORDS: readonly string[] = [
  "about", "after", "all", "and", "any", "are", "because", "been", "before",
  "but", "can", "did", "does", "for", "from", "had", "has", "have", "her",
  "his", "how", "into", "its", "just", "like", "more", "most", "new", "not",
  "now", "only", "our", "out", "over", "she", "some", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "too", "was",
  "were", "what", "when", "who", "why", "will", "with", "would", "you", "your",
];

const STOPWORD_SET: ReadonlySet<string> = new Set(STOPWORDS);

// ── small pure helpers ──────────────────────────────────────────────────────

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

function dayNumberOf(unixSec: number): number {
  return Math.floor(unixSec / SEC_PER_DAY);
}

function utcDateKey(dayNumber: number): string {
  return new Date(dayNumber * SEC_PER_DAY * 1000).toISOString().slice(0, 10);
}

/** argmax with ties resolved to the lower index. */
function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] ?? 0) > (values[best] ?? 0)) best = i;
  }
  return best;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Tokenize post text for topTopics: lowercase, strip urls and mentions,
 * keep hashtag words without the '#', drop remaining punctuation, then
 * remove stopwords and very short tokens.
 */
export function extractTokens(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/#([A-Za-z0-9_]+)/g, "$1")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ");
  return cleaned
    .split(/\s+/)
    .filter((w) => w.length >= TOPIC_MIN_LEN && !STOPWORD_SET.has(w));
}

// ── mix + topics ────────────────────────────────────────────────────────────

/**
 * Per-service counts sorted by count desc (ties alphabetical), with
 * largest-remainder percentages in tenths so pcts sum to exactly 100.0
 * whenever there is at least one post.
 */
function mixChannels(posts: PostRow[]): YearStats["mix"]["channels"] {
  if (posts.length === 0) return [];
  const counts = new Map<string, number>();
  for (const p of posts) {
    counts.set(p.channel_service, (counts.get(p.channel_service) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  const total = posts.length;
  const parts = sorted.map(([service, count]) => {
    const exactTenths = (count * 1000) / total;
    const floorTenths = Math.floor(exactTenths);
    return { service, count, floorTenths, rem: exactTenths - floorTenths };
  });

  const used = parts.reduce((sum, p) => sum + p.floorTenths, 0);
  const leftover = 1000 - used; // ≤ parts.length by construction
  const byRemainder = parts
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = parts[a]?.rem ?? 0;
      const rb = parts[b]?.rem ?? 0;
      return rb - ra || a - b;
    });
  for (let k = 0; k < leftover; k++) {
    const idx = byRemainder[k];
    const part = idx === undefined ? undefined : parts[idx];
    if (part) part.floorTenths += 1;
  }

  return parts.map((p) => ({ service: p.service, count: p.count, pct: p.floorTenths / 10 }));
}

/**
 * Top recurring 1–2 gram keywords across all post text. "Recurring" means a
 * term (uni- or bi-gram) shows up at least twice — a keyword that never
 * repeats is not a topic, and an account with no recurring terms honestly
 * gets an empty list.
 */
function topTopics(posts: PostRow[]): string[] {
  const counts = new Map<string, number>();
  const bump = (term: string) => counts.set(term, (counts.get(term) ?? 0) + 1);
  for (const p of posts) {
    const tokens = extractTokens(p.text);
    for (const t of tokens) bump(t);
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      const cur = tokens[i];
      if (prev && cur) bump(`${prev} ${cur}`);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, TOPIC_LIMIT)
    .map(([term]) => term);
}

// ── main aggregate ──────────────────────────────────────────────────────────

/**
 * Compute YearStats for `year` from post rows. Rows are trusted when their
 * precomputed row.year matches; daily/streak math derives UTC calendar days
 * from created_at. `asOf` is accepted for API symmetry but never influences
 * the result — the full year's slots are always emitted.
 */
export function computeYearStats(posts: PostRow[], year: number, _asOf?: number): YearStats {
  const inYear = posts.filter((p) => p.year === year);
  const dayCount = daysInYear(year);
  const yearStartDay = Math.floor(Date.UTC(year, 0, 1) / (SEC_PER_DAY * 1000));

  const perDay = new Map<number, number>();
  const dowHistogram = new Array<number>(7).fill(0);
  const hourHistogram = new Array<number>(24).fill(0);
  const monthly = new Array<number>(12).fill(0);
  const channelIds = new Set<string>();
  let words = 0;
  let first: PostRow | null = null;

  for (const p of inYear) {
    const day = dayNumberOf(p.created_at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    dowHistogram[p.dow] = (dowHistogram[p.dow] ?? 0) + 1;
    hourHistogram[p.hour] = (hourHistogram[p.hour] ?? 0) + 1;
    monthly[p.month] = (monthly[p.month] ?? 0) + 1;
    channelIds.add(p.channel_id);
    words += countWords(p.text);
    if (!first || p.created_at < first.created_at) first = p;
  }

  // daily: one slot per calendar day of the year (365 or 366), zero-filled
  const daily: YearStats["daily"] = [];
  for (let i = 0; i < dayCount; i++) {
    daily.push({
      date: utcDateKey(yearStartDay + i),
      count: perDay.get(yearStartDay + i) ?? 0,
    });
  }

  // streaks: consecutive UTC calendar days with ≥1 post
  const sortedDays = [...perDay.keys()].sort((a, b) => a - b);
  let longest = 0;
  let longestStartDay = yearStartDay;
  let runLen = 0;
  let runStartDay = yearStartDay;
  let prevDay: number | null = null;
  for (const day of sortedDays) {
    if (prevDay !== null && day - prevDay === 1) {
      runLen += 1;
    } else {
      runLen = 1;
      runStartDay = day;
    }
    if (runLen > longest) {
      longest = runLen;
      longestStartDay = runStartDay;
    }
    prevDay = day;
  }

  // busiest week: max posts over any sliding 7-consecutive-day window in-year
  let busiestWeekPosts = 0;
  let busiestWeekDay = yearStartDay;
  for (let i = 0; i + 7 <= dayCount; i++) {
    let windowSum = 0;
    for (let j = 0; j < 7; j++) {
      windowSum += perDay.get(yearStartDay + i + j) ?? 0;
    }
    if (windowSum > busiestWeekPosts) {
      busiestWeekPosts = windowSum;
      busiestWeekDay = yearStartDay + i;
    }
  }

  const firstPost = first
    ? {
        at: first.created_at,
        excerpt: first.text.slice(0, EXCERPT_LEN),
        channel: first.channel_service,
      }
    : null;

  const bestDow = argmax(dowHistogram);
  const bestMonth = argmax(monthly);

  return {
    year,
    totals: {
      posts: inYear.length,
      words,
      channels: channelIds.size,
      activeDays: perDay.size,
    },
    firstPost,
    rhythm: {
      bestDow,
      favoriteHour: argmax(hourHistogram),
      postsPerWeek: Math.round((inYear.length / 52) * 10) / 10,
      dowHistogram,
      hourHistogram,
    },
    streaks: {
      longest,
      longestStart: longestStartDay * SEC_PER_DAY,
      busiestWeek: busiestWeekDay * SEC_PER_DAY,
      busiestWeekPosts,
    },
    mix: { channels: mixChannels(inYear), topTopics: topTopics(inYear) },
    peaks: {
      bestMonth,
      bestMonthPosts: monthly[bestMonth] ?? 0,
      bestWeekPosts: busiestWeekPosts,
      monthly,
    },
    daily,
  };
}

// ── fingerprint ─────────────────────────────────────────────────────────────

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Stable 8-hex-char FNV-1a fingerprint of the stats JSON — card cache keys
 * invalidate rendered cards whenever any stat changes (spec 04).
 */
export function statsHash8(stats: YearStats): string {
  const bytes = new TextEncoder().encode(JSON.stringify(stats));
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
