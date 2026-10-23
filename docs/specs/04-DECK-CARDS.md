# Spec 04 · Deck cards — data contract + satori rendering

> Status: approved. Route files: `app/src/worker/routes/deck.ts`, `app/src/worker/routes/cards.ts`.

## 1 · What renders

`GET /api/deck` returns the `Deck`: `{ year, stats: YearStats, cards: CardData[7], persona? }`.
`CardData` is a **closed union** — each variant carries exactly the fields its card needs:

```ts
type CardData =
  | { n: 1; kind: "kickoff"; date: string; excerpt: string; gradient: "bolt" }
  | { n: 2; kind: "rhythm"; bestDow: string; favoriteHour: string; postsPerWeek: number; spark: number[]; gradient: "aurora" }
  | { n: 3; kind: "streaks"; longest: number; busiestWeekPosts: number; gradient: "fizz" }
  | { n: 4; kind: "mix"; channels: { service: string; pct: number }[]; topTopics: string[]; gradient: "grape" }
  | { n: 5; kind: "peaks"; bestMonth: string; bestMonthPosts: number; gradient: "sunset" }
  | { n: 6; kind: "persona"; name: string; origin: string; gradient: "nebula" }   // spec 05
  | { n: 7; kind: "recap"; totals: YearStats["totals"]; gradient: "coral" };
```

Deck assembly rules: cards 1–5 and 7 come from `YearStats` alone (deck is complete without
AI). Card 6 is injected once persona exists (spec 05) — until then the deck renders 6 cards
and the UI shows the persona slot as "naming you…". Empty account → single "not enough
year yet" state card (bolt gradient, friendly copy).

## 2 · Rendering — satori + resvg-wasm → PNG

| Property | Value |
|---|---|
| Size | 1080×1350 (4:5 — IG-friendly, crops well on X/LinkedIn) |
| Engine | `satori` (JSX-ish object tree) → SVG → `@resvg/resvg-wasm` → PNG |
| Cache | KV `card:{userId}:{year}:{slug}` (slug = `card{n}-{statsHash8}`); TTL 30d; `Cache-Control: public, max-age=3600` on responses |
| Fonts | Space Grotesk 500/700 + Inter 400/600 + JetBrains Mono 500 subset, loaded once per isolate from static assets |
| Canvas | ink-950 `#05070E` background; card face = its fixed gradient; white text only; radius 28px |

Layout system (mirrors the OG template in BRAND-GUIDELINES §8, portrait):
margin 72px → overline (mono, white 70%, uppercase-free lowercase) → headline (Space
Grotesk 700, lowercase, ~64px) → the stat moment (mono 500, tabular-nums, ~120px) →
caption (Inter 400, white 85%) → footer strip: deck mark glyph 24px + `fizzyfeed` wordmark
lockup (from `logo/svg/lockup-*-on-dark.svg` paths, name via `BRAND_NAME`).

Per-card visual anchors:
1. **Kickoff** — big date + first-post excerpt, bolt gradient
2. **Rhythm** — 7-day bar strip + best day/hour chips, aurora
3. **Streaks** — giant "141" style number + "days in a row", fizz
4. **The Mix** — proportional channel bar (single bar, segments = channel pcts), grape
5. **Peaks** — month name + count, small 12-month microbars, sunset
6. **Alter Ego** — persona name + origin story line, nebula
7. **The Recap** — totals grid (4 stats, mono) + CTA line "queue your recap post", coral

## 3 · Endpoints

```
GET /api/cards/:n.png   → image/png (KV → miss: render → cache) — shareable per-card link
GET /api/cards/og.png   → 1200×630 name-agnostic OG card (same engine, landscape variant)
```

Rules: rendering is CPU-bound — one card render must stay < 50ms CPU (Workers paid plan
allows it; measure, and if hot, pre-render on yearize completion instead of on-request).
Never render per-pixel-variant caches (max 8 slugs per user-year).

## 4 · Acceptance criteria

- [ ] 7 PNGs render for the demo account, text legible, contrast ≥ 4.5:1 (white on gradients;
      check the fizz card — lime is light: text stays white per brand law, verify visually)
- [ ] KV hit path < 15ms; second identical request reads cache (verify with KV reads metric)
- [ ] `statsHash8` changes when aggregates change → stale cards self-invalidate
- [ ] Wordmark uses lockup SVG paths + `BRAND_NAME` — renaming the const changes the footer
- [ ] The word "wrapped" appears nowhere in card copy; copy is lowercase/sentence-case
