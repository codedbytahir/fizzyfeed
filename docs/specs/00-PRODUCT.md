# Spec 00 · Product — fizzyfeed

> Status: **approved source of truth** for what we build. Derived from [`IDEA.md`](../../IDEA.md).
> Related: [01-ARCHITECTURE](01-ARCHITECTURE.md) · [08-BUILD-PLAN](08-BUILD-PLAN.md)

## 1 · One-line definition

Connect Buffer, and twelve months of publishing become a deck of 7 colorful story cards,
an AI-named posting alter ego, and a recap post queued to your accounts in one click.

## 2 · Users & jobs

| User | Job to be done | Payoff |
|---|---|---|
| Creator | "mark my year of posting" | a screenshot-worthy deck + a queued recap post |
| Community/agency manager | "recap every account in minutes" | one flow per account, deck per account |
| Small business owner | "show our marketing win of the year" | honest stats carded as a gift, not a dashboard |

Non-users (by design): people wanting real-time analytics panels — that's Buffer's job.

## 3 · The flow (5 steps, one sitting)

1. **Connect** — sign in with Buffer (PKCE OAuth, read-only scopes by default).
2. **Yearize** — we pull the past 12 months of posts and compute the story: cadence,
   streaks, channel mix, busy weeks, quiet months (spec 03).
3. **Your Deck** — 5–7 story cards render as shareable PNG images in the recap-card
   gradients (spec 04).
4. **Alter ego** — Workers AI reads the patterns and names the posting persona with a
   one-line origin story (spec 05).
5. **One-click recap** — a composed recap text is previewed, then queued through Buffer
   to all channels — the product's single write, behind explicit consent (spec 06).

Opt-in **Greatest Hits** unlocks top posts by real performance via a personal access
token, honestly scoped and revocable (spec 07).

## 4 · The 7 chapters (card contract summary)

| # | Card | Shows | Gradient (fixed) |
|---|---|---|---|
| 1 | Kickoff | when the year started, first post of the run | Bolt `#0A5CFF→#00D5FF` |
| 2 | Rhythm | posting heartbeat — best day, favorite hour, cadence | Aurora `#00D5FF→#00FFA3` |
| 3 | Streaks | longest streak, busiest week | Lime Fizz `#C8FF4D→#00E5A0` |
| 4 | The Mix | channel mix %, top topics | Grape Soda `#A855F7→#6366FA` |
| 5 | Peaks | biggest month, most prolific week | Sunset `#FF8A00→#FF3D77` |
| 6 | Alter Ego | AI-named persona + origin story | Nebula `#6333FF→#0A5CFF` |
| 7 | The Recap | year totals + CTA: *queue your recap post* | Coral Pop `#FF5C5C→#FF9E2C` |

## 5 · Principles (binding on every spec)

| We will | We won't |
|---|---|
| Show honest numbers — the chart IS the aesthetic | Inflate stats or invent engagement |
| Read-only OAuth by default, one-click revoke, encrypted tokens | Store anything unneeded |
| Keep the deck feelable in one sitting — 7 cards, not a dashboard | Build an analytics panel with a party hat |
| Ship on free-tier-friendly Cloudflare, one deploy | Call it "wrapped" anywhere |

## 6 · Success criteria (contest-fit)

- **Usefulness**: the queued recap is a genuine Buffer action; deck feeds a workflow.
- **Execution & craft**: single-Worker architecture, self-drawing sparkline motion,
  dark-first accessible UI, honest limits stated out loud.
- **Creativity**: AI alter-ego naming from real patterns + story-card deck format.

Demo-day definition of done: a real Buffer account runs the full flow end-to-end —
connect → deck in ≤ 60s → persona → recap queued and visible in the Buffer dashboard.

## 7 · Out of scope (v1)

Multi-year history, team/org accounts, scheduling edits post-queue, native mobile,
engagement metrics without explicit opt-in, i18n (English only), the word "wrapped" 🙂.
