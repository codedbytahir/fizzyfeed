# DESIGN.md — the fizzyfeed design system

Locked by the Hallmark restyle of 2026-11-01 (theme **Hum**, playful genre, dealt 1/3 —
seed recorded in `.hallmark/log.json`). Every screen reads this file. When a rule here
and a gate disagree, this file wins inside the app; the Hallmark Floor always holds.

## The material

Grained cream paper, card stock you can press, blue-black ink, light from the top left.
Three accents that **never blend** (no gradient between them, ever) plus mint for growth:

| token | value | job |
| --- | --- | --- |
| `--color-paper` | `#F7F5EC` | the ground — never pure white, never a flat fill (grain + fibre sit on it) |
| `--color-ink` | `#12161C` | text, headlines, the torn ink footer band |
| `--color-accent` (pear) | `#F7D21A` | the action: primary buttons, the yearline field, rank beads 1–3 |
| `--color-accent-2` (blue) | `#0064BE` | links, focus rings, checked boxes — and the one dark sheet (05) |
| `--color-accent-3` (coral) | `#FF5E63` | one loud moment: chapter 07, the finale |
| `--color-mint` | `#70E093` | growth: chapter 03, queued/success states |
| `--color-kraft` / `--color-sand` / `--color-sugar` | `#AE7D52` / `#D9AC69` / `#C6DFEF` | support stocks: kraft strip, chapter 04/06 sheets, evidence mats |

`scripts/oklch2hex.py` regenerates every hex from the oklch tokens in `tokens.css`.

## Type

- **Chillax** (self-hosted, `public/fonts/chillax-500|600.woff2`, 500 + 600 only) carries
  display AND body. One family; no third face.
- Display: 600, `letter-spacing: -0.03em`, line-height 1.02–1.06, sentence case.
- Body: 500 at 16–19px, line-height 1.5.
- Labels/captions: the same face a step smaller, sentence case, `--color-muted`,
  **never** tracked capitals, never mono. Mono is gone from the product.
- Figures: `font-variant-numeric: tabular-nums`, set big (`.card__moment`, ledgers).
- Emphasis is a pear highlighter band (`.hl`), never colored text on dark.

## Surfaces

- **Story cards are card stock**: one SOLID sheet per chapter, radius 24, grain+fibre
  printed on top, inset top highlight, paper shadow falling down-right. Chapter → sheet:
  01 pear · 02 sugar · 03 mint · 04 sand · 05 blue (fringe text) · 06 kraft · 07 coral.
  The mapping lives once in `CardSurface` (client) and `lib/gradients.ts` (PNG renderer).
- **No card inside a card.** Content sits directly on its sheet; no inset panels,
  no scrims, no nested surfaces.
- **No gradient anywhere.** Not on buttons, not on text, not as ground. The only
  gradients in CSS are the pear highlighter band's flat stops and the radial paper pool
  behind the connect fan (both single-color washes, no accent-to-accent blend).
- Torn edges: the footer ink band and the kraft steps strip end in `clip-path` polygons.
  Torn edges are geometry, exempt from the spacing scale.
- Buttons are card stock that presses: 52px tall, radius 16, a solid 5px edge below
  (pear-deep on primary, edge color on secondary). Hover raises to 7px, active presses
  to 1px. Spring easing on the primary only; everything else snaps. Never scale().

## Motion

`transform` and `opacity` only. One route-entrance reveal (`route-in`, 500ms expo-out),
visible at rest. `@starting-style` for dialog/overlay entrances. Loading = three fizz
beads (pear, blue, coral) rising + a pear sweep bar. Everything answers
`prefers-reduced-motion` with the end state.

## Voice

Lowercase-forward, warm, direct, honest. Numbers come from the API and are formatted by
`formatCount` — never invented, never rounded up in copy. The chapter plate format
`chapter 0n — kind` is pinned by the PNG renderer and share tests: do not reword it.

## Renderer parity

The satori PNG pipeline (`lib/render.ts`) re-declares the tokens as hex with `/* token: … */`
provenance (satori cannot read CSS vars; AGENTS.md §1.3 exception). Paper canvas, the same
seven sheet fills, the same ink rules, Chillax 500/600 from `public/fonts/*.ttf`.
Change the client sheet and change the renderer sheet in the same commit.
