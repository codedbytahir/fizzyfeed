# Spec 03 · Yearize pipeline — 12 months → story aggregates

> Status: approved. Route file: `app/src/worker/routes/yearize.ts` + `app/src/worker/cron/yearize.ts`.

## 1 · Purpose

Turn raw Buffer posts into the `YearStats` object every downstream feature consumes
(deck cards, persona, recap, landing demo numbers). Honest math only — no estimates
presented as facts; unknowns are absent fields, never zeros dressed as data.

## 2 · Two-phase sync

| Phase | Trigger | What happens |
|---|---|---|
| **Backfill** | right after OAuth callback (fire-and-forget `ctx.waitUntil`) | page `GET /post` (or list endpoint) for the past 12 months, up to the 250 req/day/token ceiling; pages of 50; writes rows + flips `sync_state.backfill_done` |
| **Incremental** | hourly cron + manual `POST /api/yearize/run` (debounced 60s/user) | fetch posts since `last_polled_at`; upsert new/updated rows; refresh `last_polled_at` |

Backfill budget math: 12 months ÷ 250 req/day → at 50 posts/page, an active account
(~1,500 posts/yr) needs ~30 requests. Ceiling enforcement: counter in `sync_state.poll_cursor`
metadata; cron stops at 240 req/day/token and resumes next hour.

## 3 · Aggregates (`YearStats`, typed in `shared/types.ts`)

```ts
{
  year: number;
  totals: { posts: number; words: number; channels: number; activeDays: number };
  firstPost:  { at: number; excerpt: string; channel: string } | null;
  rhythm:     { bestDow: number; favoriteHour: number; postsPerWeek: number;
                dowHistogram: number[7]; hourHistogram: number[24] };
  streaks:    { longest: number; longestStart: number; busiestWeek: number;
                busiestWeekPosts: number };
  mix:        { channels: { service: string; count: number; pct: number }[];
                topTopics: string[] };          // simple keyword top-k, honest labeling
  peaks:      { bestMonth: number; bestMonthPosts: number; bestWeekPosts: number;
                monthly: number[12] };
  daily:      { date: string; count: number }[]; // 365 slots for the yearline spark
}
```

Computation rules:
- All aggregates computed **in SQL where possible** (D1 group-by) with a TS reducer
  fallback for streak scanning; pure functions in `worker/lib/yearize.ts` → unit-tested
  against fixtures (see §5).
- "Streak" = consecutive days with ≥1 published post (calendar days, UTC — the user's
  Buffer channels are global; state the timezone assumption in the UI footnote).
- `topTopics`: top 5 recurring 1–2 gram keywords from post text minus stopwords;
  displayed as "what you posted about", never as AI insight (spec 05 owns AI framing).

## 4 · API

```
POST /api/yearize/run     → 202 { status: "queued" } (debounced; 429 within 60s)
GET  /api/yearize/status  → { backfillDone: boolean, lastPolledAt, postsIndexed }
```

## 5 · Tests (vitest, fixtures in `app/test/fixtures/`)

- Fixture A: 365-day daily posts, one 141-day streak → streak math exact
- Fixture B: 3 channels lopsided 80/15/5 → mix percentages sum to 100 ±0.1
- Fixture C: empty account → every aggregate null-safe, deck shows "not enough year yet"
  state (no fake zeros)
- Property test: `sum(monthly) == totals.posts` for random inputs

## 6 · Acceptance criteria

- [ ] Real account backfills ≤ 250 req/day/token; cron never exceeds ceiling
- [ ] `GET /api/deck` (spec 04) serves within 100ms after aggregates cached
- [ ] All fixtures pass; re-running yearize is idempotent (no duplicate post rows)
- [ ] Deleting a Buffer post locally then re-sync restores it (upsert semantics)
