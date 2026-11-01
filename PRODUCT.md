# PRODUCT.md — fizzyfeed (dev codename `kroma`)

> Written by impeccable init without a live interview: inferred from the user's brief
> ("the UI UX is very simple — upgrade the design of every screen"), AGENTS.md,
> BRAND-GUIDELINES.md, docs/specs/00-PRODUCT.md, and the shipped client code.
> Assumptions are marked **[assumed]**.

## What this is

fizzyfeed turns twelve months of Buffer publishing into a deck of 7 story cards, an
AI-named alter ego, and a recap post queued to every channel in one click. Read-only
OAuth, honest numbers, one sitting. The tagline is "your year in posts."

## Who uses it and where

Creators, community managers, and small business owners, on their own laptops, mostly
evenings, after a year of posting — a "mark my year" moment. Sessions are short and
goal-directed: connect → deck → persona → recap in minutes, then share cards.
**[assumed]** Primary device is desktop; mobile is a first-class fallback (the share
moment often happens on a phone).

## Surface modes

- **Connect screen (`/`)** — Persuade: the visitor decides to connect; the hero must
  prove the mechanism (the deck) before asking for the click.
- **Deck / Persona / Recap / Greatest Hits (`/app/*`)** — Operate: the visitor completes
  a task. Scanability, honest states, and calm consistency outrank expression; brand
  lives in precise details (mono numerals, hairlines, the fixed card gradients).
- **404** — a small brand moment, not a dead end.

## What must remain true (product law, non-negotiable)

- Dark-first `ink-950` canvas; electric blue is the only light source (60/30/10).
- Colors only from `tokens.css`; the 7 card gradients are fixed and never recolored.
- Lowercase display headlines (Space Grotesk), sentence-case UI, mono numerals.
- Honest numbers only; labels exactly as the API names them; the word "wrapped" is banned.
- Name-agnostic: no brand literals in code; one `BRAND_NAME` constant.
- The click is the consent: the one write is previewed, edited, then approved by click.
- The yearline spark and card text scrim (`--card-scrim`) are mirrored by the worker's
  PNG renderer — client CSS must not rename or break them.

## What the design upgrade must prove

The current build is correct but visually quiet: generic header-then-content layouts,
a plain loading state, form screens that read as forms. The upgrade should make every
screen feel like the deck world — carded, chroma-lit, editorial — while staying an
Operate-grade tool: one authored motion per route, states for everything (loading,
empty, error, focus), and the first viewport of each screen carrying its job.
