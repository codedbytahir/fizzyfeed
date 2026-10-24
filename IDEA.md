# IDEA — fizzyfeed (dev codename: `kroma`)

> **Your year in posts.**
> Connect Buffer, and twelve months of publishing become a deck of 7 colorful story cards, an AI-named posting alter ego, and a recap post queued to your accounts in one click.

This file explains **what we're building and why**. For colors, logo, and tokens see [`BRAND-GUIDELINES.md`](BRAND-GUIDELINES.md) and [`tokens.css`](tokens.css).

---

## The pitch (30 seconds)

Every December, music apps prove that people love seeing their own year reflected back at them — those recaps get screenshotted and shared everywhere. Creators, community managers, and small businesses spend the whole year publishing through Buffer, and at the end of it… nothing marks the milestone. The data exists, but it sits in a dashboard as rows and numbers.

**fizzyfeed turns that archive into a gift.** You connect Buffer with read-only OAuth, we analyze your twelve months of posts — rhythm, streaks, topics, peaks — and hand you a deck of story cards worth screenshotting. AI studies your actual patterns and names the alter ego you became this year. Then comes the part that makes it a tool instead of a toy: **one click composes your recap post and queues it through Buffer to all your channels.** Your year in posts, ready to publish.

## What we're building

### The flow

| Step | What happens | Buffer API role |
|---|---|---|
| 1 · Connect | Sign in with Buffer (PKCE OAuth, read-only by default) | OAuth 2.0 + PKCE |
| 2 · Yearize | We pull your posts from the past 12 months and compute the story: cadence, streaks, channel mix, busy weeks, quiet months | `GET /post` polling via scheduled fetches |
| 3 · Your Deck | 5–7 story cards render as shareable images in the recap-card palette | — |
| 4 · Alter ego | AI reads your patterns and names your posting persona (with a one-line origin story) | Workers AI, Buffer data as context |
| 5 · One-click recap | We compose a text recap of your year and queue it — you approve, it publishes on schedule | `POST /post` (the real write) |

### The chapters — one card each

| # | Card | What it shows | Gradient |
|---|---|---|---|
| 1 | Kickoff | when your posting year started, your first post of the run | Bolt |
| 2 | Rhythm | your posting heartbeat — best day, favorite hour, cadence | Aurora |
| 3 | Streaks | longest streak, busiest week, the grind you forgot you did | Lime Fizz |
| 4 | The Mix | which channels you fed, and what you posted about | Grape Soda |
| 5 | Peaks | your biggest month, your most prolific week | Sunset |
| 6 | Alter Ego | the AI-named persona + its origin story, derived from your real data | Nebula |
| 7 | The Recap | the year in one card + the CTA: *queue your recap post* | Coral Pop |

### Greatest Hits (opt-in, honest about limits)

Buffer's OAuth flow does not expose post metrics (likes, clicks, impressions). We won't fake them. For power users who want real engagement numbers, we offer an opt-in chapter: paste a **personal access token**, and we unlock **Greatest Hits** — your top posts of the year by real performance. The token is AES-GCM encrypted at rest, used only for the metrics read, and revocable in one click. Everyone else still gets a complete deck from OAuth data alone.

## Who it's for

- **Creators** who want an end-of-year shareable that isn't a generic template
- **Niche communities & agencies** managing multiple channels — recap every account in minutes
- **Small businesses** whose "marketing win of the year" deserves a moment

## Why this exists

1. **White space.** The Buffer integration directory is full of schedulers, analytics panels, and AI writers — utility everywhere, delight nowhere. Nobody marks the emotional milestone of a full year of publishing.
2. **Proven format.** Year-in-review recaps reliably go viral every year; the format is loved, and no Buffer-ecosystem tool does it.
3. **A useful anchor.** Pure "fun" apps struggle to justify themselves. The auto-queued recap post is a real action with real value — it completes the loop from memory to content. That's the difference between a screenshot generator and a tool.

## Principles

| We will | We won't |
|---|---|
| Show honest numbers — the chart IS the aesthetic | Inflate stats or invent engagement you didn't earn |
| Read-only OAuth by default, one-click revoke, encrypted tokens | Store anything we don't need, or touch accounts without consent |
| Keep the deck feelable in one sitting — 7 cards, not a dashboard | Build an analytics panel with a party hat on |
| Ship on free-tier-friendly Cloudflare, one deploy | Call it "wrapped" anywhere (that word belongs to a music app) |

## Under the hood

| Layer | Choice | Why |
|---|---|---|
| Hosting | Cloudflare Workers — single deploy, **$5/mo plan** (needed for PNG-render CPU) | one stack, one log, contest-friendly |
| Frontend | Vite + React SPA on Workers Static Assets | fast, no SSR complexity in a 17-day build |
| API | Hono (`/api/*`, worker-first) | tiny, TS-native, made for Workers |
| Database | D1 — posts + AES-GCM encrypted tokens (rotated in `batch()`) | serverless SQL, token safety |
| Cache | KV — AI output & rendered-card cache only | OAuth state lives in signed cookies + D1, not eventually-consistent KV |
| AI | Workers AI — `llama-3.3-70b` (persona naming), `3.1-8b` (card copy) | 10k free neurons/day ≈ ~55 generations, zero keys to manage |
| Card images | satori + resvg-wasm → PNG, cached by slug | shareable images without a browser or server |
| Scheduling | Cron Triggers (yearize fetches within 250 req/day/token limits) | no webhooks in Buffer API — polling is the honest path |
| CI/CD | Workers Builds | push to deploy |

## Contest fit — Buffer Commit 2026

| Criterion | How the idea scores |
|---|---|
| **Usefulness** | the queued recap post is a genuine Buffer action; the deck feeds a workflow, not just a wow moment |
| **Execution & craft** | single-Worker architecture, self-drawing sparkline motion, dark-first accessible UI, honest limits stated out loud |
| **Creativity** | AI alter-ego naming from real posting patterns + a story-card deck format nobody in the ecosystem has shipped |

Timeline: build window **Oct 28 → Nov 13**. Week 1: OAuth + yearize + deck render. Week 2: AI persona + recap queue + polish. Final 48h: demo video, real-account end-to-end test, this repo tidied.

## Status

- [x] Idea validated against judges & ecosystem white space
- [x] Brand kit v0.1 (this repo)
- [ ] Phase 1 — Cloudflare Worker scaffold + Buffer OAuth (PKCE) round-trip
- [ ] Phase 2 — yearize pipeline + deck rendering (satori)
- [ ] Phase 3 — alter-ego naming + one-click recap queue
- [ ] Phase 4 — Greatest Hits (opt-in token) + demo video
