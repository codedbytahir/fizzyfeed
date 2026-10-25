/**
 * Typed contracts shared by client + worker (spec 01 §5: "the single source of
 * truth for card data"). Every API route returns shapes defined here.
 */

// ── Buffer domain ────────────────────────────────────────────────────────────

export interface BufferChannel {
  id: string;
  service: string; // 'twitter' | 'instagram' | 'linkedin' | ...
  serviceId: string;
  name: string;
  avatarUrl?: string;
}

export interface BufferPost {
  id: string;
  channelId: string;
  service: string;
  text: string;
  createdAt: number; // unix seconds (published or due time)
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expiry
  scope: string;
}

export interface CreatePostInput {
  channelId: string;
  text: string;
  scheduledAt?: number; // unix seconds; omit → Buffer picks next free slot
  now?: boolean;
}

export interface BufferProfile {
  id: string;
  name: string;
  avatar?: string;
}

/** Port the worker code codes against; the only implementation is lib/buffer.ts. */
export interface BufferClient {
  getProfile(accessToken: string): Promise<BufferProfile>;
  listChannels(accessToken: string): Promise<BufferChannel[]>;
  /**
   * Buffer's posts API is per-channel; omitting channelId iterates the user's
   * channels and merges results. Posts come newest-first — implementers stop
   * paging once createdAt < since.
   */
  listPosts(
    accessToken: string,
    opts: { channelId?: string; since?: number; until?: number; page?: number; count?: number }
  ): Promise<{ posts: BufferPost[]; hasMore: boolean }>;
  createPost(accessToken: string, input: CreatePostInput): Promise<{ id: string }>;
  refreshAccessToken(refreshToken: string): Promise<TokenPair>;
}

// ── Yearize aggregates (spec 03 §3, verbatim shape) ─────────────────────────

export interface YearStats {
  year: number;
  totals: { posts: number; words: number; channels: number; activeDays: number };
  firstPost: { at: number; excerpt: string; channel: string } | null;
  rhythm: {
    bestDow: number; // 0=Sunday … 6=Saturday
    favoriteHour: number; // 0–23, UTC (stated in UI footnote)
    postsPerWeek: number;
    dowHistogram: number[]; // length 7
    hourHistogram: number[]; // length 24
  };
  streaks: {
    longest: number; // days
    longestStart: number; // unix seconds of streak day one
    busiestWeek: number; // ISO-ish week start unix seconds
    busiestWeekPosts: number;
  };
  mix: {
    channels: { service: string; count: number; pct: number }[];
    topTopics: string[]; // top-5 recurring 1–2 gram keywords, stopword-filtered
  };
  peaks: {
    bestMonth: number; // 0–11
    bestMonthPosts: number;
    bestWeekPosts: number;
    monthly: number[]; // length 12
  };
  daily: { date: string; count: number }[]; // 365 slots for the yearline spark
}

// ── Deck cards (spec 04 §1, closed union) ───────────────────────────────────

export type CardGradient =
  | "bolt"
  | "aurora"
  | "fizz"
  | "grape"
  | "sunset"
  | "nebula"
  | "coral";

export type CardData =
  | { n: 1; kind: "kickoff"; date: string; excerpt: string; gradient: "bolt" }
  | {
      n: 2;
      kind: "rhythm";
      bestDow: string;
      favoriteHour: string;
      postsPerWeek: number;
      spark: number[];
      gradient: "aurora";
    }
  | { n: 3; kind: "streaks"; longest: number; busiestWeekPosts: number; gradient: "fizz" }
  | {
      n: 4;
      kind: "mix";
      channels: { service: string; pct: number }[];
      topTopics: string[];
      gradient: "grape";
    }
  | { n: 5; kind: "peaks"; bestMonth: string; bestMonthPosts: number; gradient: "sunset" }
  | { n: 6; kind: "persona"; name: string; origin: string; gradient: "nebula" } // spec 05
  | { n: 7; kind: "recap"; totals: YearStats["totals"]; gradient: "coral" };

export interface Persona {
  name: string; // lowercase, ≤ 28 chars
  origin: string; // ≤ 90 chars, references a real YearStats number
  traits: string[]; // 3 chips, each ≤ 18 chars
}

export interface Deck {
  year: number;
  stats: YearStats;
  cards: CardData[]; // 7 with persona; 6 before persona; 1 empty-state card
  persona?: Persona;
  empty?: true; // account has "not enough year yet" (fixture-C state)
}

// ── Recap (spec 06) ─────────────────────────────────────────────────────────

export interface RecapPreview {
  text: string; // ≤ 500 chars, composed from YearStats verbatim
  channels: BufferChannel[];
  needsWriteScope: boolean;
  personaUsed: boolean;
}

export interface RecapChannelResult {
  channelId: string;
  service: string;
  ok: boolean;
  postId?: string;
  error?: { code: string; message: string };
}

export interface RecapQueueResult {
  queueId: string;
  results: RecapChannelResult[];
}

// ── Greatest Hits (spec 07) ─────────────────────────────────────────────────

export interface GreatestHit {
  postId: string;
  excerpt: string; // ≤ 80 chars
  channel: string; // service name
  metric: { name: string; value: number }; // labeled exactly as the API names it
}

// ── Session / auth API (spec 02 §5) ─────────────────────────────────────────

export interface MeResponse {
  id: string;
  displayName: string;
  avatarUrl?: string;
  channels: BufferChannel[];
  connected: boolean;
  backfillDone?: boolean;
}

// ── API error shape (spec 01 §5) ────────────────────────────────────────────

export interface ApiError {
  error: { code: string; message: string };
}

// ── Yearize API (spec 03 §4) ────────────────────────────────────────────────

export interface YearizeStatus {
  backfillDone: boolean;
  lastPolledAt: number;
  postsIndexed: number;
}
