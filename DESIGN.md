---
name: fizzyfeed
description: your year in posts — a gallery-hung recap deck of 7 fixed-gradient story cards on an ink-950 wall
colors:
  ink-50: "#F5F8FE"
  ink-100: "#E7EDF8"
  ink-200: "#C6D0E4"
  ink-300: "#9AA8C4"
  ink-400: "#6B7A99"
  ink-500: "#4A5774"
  ink-600: "#33405C"
  ink-700: "#1F2940"
  ink-800: "#131A2B"
  ink-900: "#0A0E1A"
  ink-950: "#05070E"
  electric-200: "#A3C4FF"
  electric-300: "#6FA1FF"
  electric-400: "#3B7DFF"
  electric-500: "#0A5CFF"
  volt-400: "#2FDDFF"
  volt-500: "#00D5FF"
  violet-400: "#9A6BFF"
  violet-500: "#6333FF"
  spark-500: "#C8FF4D"
  warning: "#FFB020"
  danger: "#FF4757"
  line: "color-mix(in srgb, var(--ink-50) 7%, transparent)"
  line-strong: "color-mix(in srgb, var(--ink-50) 14%, transparent)"
  glass-bg: "color-mix(in srgb, var(--ink-800) 62%, transparent)"
  glass-bg-soft: "color-mix(in srgb, var(--ink-800) 38%, transparent)"
  glass-bg-deep: "color-mix(in srgb, var(--ink-900) 72%, transparent)"
  glass-highlight: "color-mix(in srgb, var(--ink-50) 7%, transparent)"
  aurora-electric: "color-mix(in srgb, var(--electric-500) 20%, transparent)"
  aurora-violet: "color-mix(in srgb, var(--violet-500) 16%, transparent)"
  aurora-volt: "color-mix(in srgb, var(--volt-500) 12%, transparent)"
  plate-bg: "color-mix(in srgb, var(--ink-950) 58%, transparent)"
  spot-electric: "color-mix(in srgb, var(--electric-500) 26%, transparent)"
  spot-volt: "color-mix(in srgb, var(--volt-500) 16%, transparent)"
  card-scrim: "color-mix(in srgb, var(--ink-950) 70%, transparent)"
  scroll-thumb: "color-mix(in srgb, var(--ink-400) 55%, var(--ink-600))"
  grad-safe: "linear-gradient(120deg, var(--electric-300) 0%, var(--volt-400) 100%)"
typography:
  display:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "clamp(44px, 7vw, 76px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "clamp(30px, 4.5vw, 44px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "clamp(25px, 2.7vw, 33px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "clamp(40px, 5vw, 60px)"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.12em"
    fontFeature: "tabular-nums"
rounded:
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "32px"
  card: "28px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "var(--grad-brand) (background-size 220% 220%)"
    textColor: "{colors.ink-50}"
    typography: "600 15px Inter (var(--font-sans))"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "var(--grad-brand) (background-position 85% 50%)"
    textColor: "{colors.ink-50}"
    typography: "600 15px Inter (var(--font-sans))"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-ghost:
    backgroundColor: "{colors.glass-bg-soft}"
    textColor: "{colors.ink-200}"
    typography: "600 15px Inter (var(--font-sans))"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-300}"
    typography: "600 15px Inter (var(--font-sans))"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  chip:
    backgroundColor: "{colors.glass-bg-soft}"
    textColor: "{colors.ink-200}"
    typography: "400 12.5px Inter (var(--font-sans))"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  input:
    backgroundColor: "color-mix(in srgb, var(--ink-900) 82%, transparent)"
    textColor: "{colors.ink-50}"
    typography: "400 15px/1.6 Inter (var(--font-sans))"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  card-face:
    backgroundColor: "var(--grad-*) — one of the 7 fixed gradients"
    textColor: "{colors.ink-50}"
    typography: "700 Space Grotesk, lowercase (var(--font-display))"
    rounded: "{rounded.card}"
    padding: "28px"
    width: "4/5 aspect ratio"
  state-panel:
    backgroundColor: "linear-gradient(180deg, var(--glass-bg), var(--glass-bg-deep))"
    textColor: "{colors.ink-200}"
    typography: "400 16px/1.6 Inter (var(--font-sans))"
    rounded: "{rounded.lg}"
    padding: "44px 40px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-300}"
    typography: "500 13.5px Inter (var(--font-sans))"
    padding: "13px 10px"
---

# Design System: fizzyfeed

## Overview

**Creative North Star: "the gallery hang"**

Every screen is a curated wall on an `ink-950` gallery ground. The subject of each
route — the fanned deck, the yearline plaque, the persona cover plate — hangs from a
shared hairline at a shared eyeline, lit by one chroma light pool, with mono caption
plates naming what hangs. This refuses the category default of a form floating in
dark space: nothing is unframed, unlabeled, or unlit. Standard web controls stay
standard; the world enters through type, palette, density, and the caption-plate +
spotlight move.

The material is glass on ink: surfaces are translucent `color-mix` panels with a
12–16px backdrop blur and a 1px top highlight, so the fixed aurora ambience (three
radial glows + monochrome grain, drifting 26s behind everything) shows through every
panel. Depth comes from light — pools, glows, and hairlines — not from stacked gray
shadows. Chroma is rationed by the 60/30/10 law: ink ground and glass (~60), electric
blue + volt light (~30), and the seven fixed card gradients as the only confetti (~10).

The tone is playful-precise (BRAND-GUIDELINES §6 carries voice law — DESIGN.md does
not duplicate it): lowercase Space Grotesk display, sentence-case Inter UI, JetBrains
Mono folios and numerals. Numbers are the exhibit's provenance labels: mono,
tabular, and always saying where they come from.

**Key Characteristics:**
- ink-950 wall + aurora ambience + grain behind every route, including the standalone 404
- glass panels (`glass-bg → glass-bg-deep`, blur, inset 1px highlight) for every container
- every screen's subject hangs from one hairline with a spotlight pool and a mono caption plate
- the 7 fixed gradients are the only chroma; referenced as `var(--grad-*)`, never restopped
- JetBrains Mono 500 + `tabular-nums` for every number that changes
- one authored entrance per route; all motion collapses near-instant under `prefers-reduced-motion`
- AA is engineered, not hoped for: every custom mix carries its contrast math inline in the CSS

## Colors

A blue-tinted dark system: one electric light source on an ink ground, with all
derived surfaces mixed from the core scales — no hue exists outside `tokens.css`.

### Primary
- **Electric Blue** (`electric-500`): THE brand color and the only light source — focus-glow pools, spotlight radial gradients, CTA gradient core, active checkbox fill, the yearline spark's family. `electric-400` is the lit edge (spark stroke, checked borders, hover accents); `electric-300` is small accent text on dark (links, overlines, share URLs, mono metrics); `electric-200` is the hover state of links.

### Secondary
- **Volt Cyan** (`volt-400`, `volt-500`): the live-wire accent — global focus rings (2px + 2px offset), input carets, status-line dots, loading fizz, metric text (`gh-metric`), the yearline plaque's top hairline glint. Never co-primary.
- **Chroma Violet** (`violet-400`, `violet-500`): the gradient head and the second aurora glow; `violet-400` lends sunset its hover bloom. Never on its own as text.

### Tertiary
- **Spark Lime** (`spark-500`): delight only, sparingly — third fizz dot (footer + loading) and the fizz card's glow source. Never a text color.

### Neutral
- **Ink scale** (`ink-50` → `ink-950`): blue-tinted on purpose (pure gray reads dead next to electric blue). `ink-950` is the wall; `ink-900`/`ink-800` are field and glass bases; `ink-700`/`ink-600` are skeleton and ghost strokes; `ink-500`/`ink-400` are folios and hints; `ink-300` is sub-copy; `ink-200` is body text (≥ 4.5:1 on `ink-950` per BRAND-GUIDELINES §9); `ink-50`/`ink-100` are headings and emphasized rows.
- **Semantic**: `warning` (charcount warn, inline-note border, share confirm), `danger` (error marks and status). Success states use electric/volt marks, not green.

### Surface kit (derived, tokens.css)
- **Glass** (`glass-bg`, `glass-bg-soft`, `glass-bg-deep`, `glass-highlight`): the container material — always the 180° glass gradient plus blur, never flat fills.
- **Light pools** (`aurora-*`, `spot-*`): radial-gradient ambience and the spotlight over hung objects; `plate-bg` backs caption plates.
- **Hairlines** (`line`, `line-strong`): 1px rules at 7%/14% ink-50; the named hang line and footer rule are gradient-dressed versions.
- **`card-scrim`**: ink-950 at 70% — the AA layer under white text on gradient faces. Mirrored by the PNG renderer (`worker/lib/render.ts` `TEXT_PANEL`); do not rename it.

### Gradients (the fixed seven — tokens.css is the source)
- **The Fixed Seven Rule.** The 7 card gradients (`--grad-bolt`, `--grad-nebula`, `--grad-aurora`, `--grad-fizz`, `--grad-sunset`, `--grad-coral`, `--grad-grape`) are immutable deck identity. Client code references them only as `var(--grad-*)` (`CardSurface.tsx`, `Connect.tsx` fan); the satori PNG renderer carries the same stops as literals with provenance comments (`worker/lib/gradients.ts`). Never recolor, reorder the ramp, or restop.
- **The One Light Source Rule.** Electric blue (with volt) is the only light on the wall; 60/30/10 — ink/glass ~60, electric+volt ~30, gradient chroma ~10. Gradients live in `cards.css` and the two legal text treatments; nowhere else.
- **The Scrim Carries AA Rule.** Text on gradient faces is always white (`ink-50`) over the `card-scrim` panel (ink-950 70%) — worst-case stops measure 4.95:1 (white-70), 6.42:1 (white-85), 8.14:1 (solid). Never fix contrast by darkening a gradient; fix it with the scrim.

## Typography

**Display Font:** Space Grotesk (self-hosted via @fontsource, 500/700) with Inter fallback
**Body Font:** Inter (400/500/600) with system-ui fallback
**Label/Mono Font:** JetBrains Mono (500)

**Character:** Grotesk display gives the wall its exhibit voice — lowercase, tightly
tracked, balanced; Inter keeps the tool calm and Operate-grade; JetBrains Mono marks
everything measured: folios, indices, captions, counts.

### Hierarchy
- **Display** (700, clamp(44px, 7vw, 76px), 1.02, −0.03em): connect wall headline only; lowercase via `text-transform`. The persona cover name runs the same family at clamp(40px, 6.5vw, 72px) as gradient-clipped text.
- **Headline** (700, clamp(30px, 4.5vw, 44px), 1.05, −0.02em): route titles (`headline--lg`); `--sm` (24px) for compact states. `text-wrap: balance`.
- **Title** (700, clamp(25px, 2.7vw, 33px), 1.05, −0.02em): card headlines on faces; 404 ghost numerals run display family at clamp(72px, 16vw, 140px) as background art.
- **Stat** (500, clamp(40px, 5vw, 60px), 1, tabular): the big card moment number; compact variant clamp(22px, 2.6vw, 30px). Ranked lists use 24px mono with the `grad-safe` clip.
- **Body** (400, 16px, 1.6): Inter, max ~56ch subs, 36ch card captions (14px/1.55). UI controls 13.5–15px/600.
- **Label** (500, 10–13px mono, +0.04–0.14em, lowercase): overlines, folios, indices, charcounts, captions — always `tabular-nums`, usually on a plate or pill.

### Named Rules
**The Lowercase Voice Rule.** All display and all mono folios are lowercase (`text-transform: lowercase`); UI copy is sentence case. The wordmark and every headline comply — it's the friendly half of playful-precise.

**The Live Number Rule.** Any number that changes or measures — counts, ranks, indices, timestamps, charcounts — is JetBrains Mono 500 with `font-variant-numeric: tabular-nums`. Body never carries live numerals.

**The Large-Type Gradient Rule.** `grad-brand` gradient-clipped text is display-size only (its violet head clears 3:1, not 4.5:1); small gradient text uses `--grad-safe` (electric-300 → volt-400, both ≥ 4.5:1 on ink-950) — see `.gh-rank`.

**The Tracking Note (divergence, recorded not ruled).** The build tracks display at −0.02 to −0.03em (−0.04em on the 404 ghost) — tighter than BRAND-GUIDELINES §5's −1% cap. The build wins as shipped; the cap reads as a mid-size guardrail, and DESIGN.md records observed values rather than re-legislating either way.

## Layout

A single centered column — the wall — with content hung from a shared top hairline.

- **Container**: `--wrap: 1120px` max-width, 24px side padding (20px ≤760px); `app-main` padding 44px 24px 96px (32px 20px 72px ≤760px). Sticky 64px glass nav (`--nav-h`) that gains weight (88% opacity + shadow) once the wall scrolls 8px.
- **Hang line**: every route header (`.deck-head`) hangs from one 1px gradient hairline (electric 40% → line-strong → transparent) with the step label as a caption plate pill on it.
- **Connect (first viewport)**: two-column grid 1.05fr/0.95fr — wall text left (overline plate, display headline, proof chips, steps pill, CTA bottom-left), the real 7-card fan right on a spotlight stage, rotated −2°, breathing, easing apart on hover/focus-within. Stacks (copy first, stage second) ≤960px; fan scales 0.86 ≤1120px, 0.62 ≤520px.
- **Deck grid**: `repeat(auto-fill, minmax(300px, 1fr))`, 24px gap; cards are 4/5 aspect. The yearline plaque hangs between header and grid.
- **Spacing rhythm**: 4 / 8 / 10 / 12 / 16 / 24px gaps dominate; 30px header bottom, 40px deck foot. No spacing tokens — px values are the observed scale.
- **Breakpoints** (max-width): 1120px, 960px (connect stacks), 760px (nav condenses to brand+user row plus scrollable link row; buttons stretch), 520px (fan 0.62, single-column forms, ≥44px tap targets enforced).
- **Density**: Operate-calm — one column of glass, generous wall space; no dense data tables; ranked rows are 16/18px-padded glass cards.

## Elevation & Depth

Hybrid: glass translucency + light, with shadows as ambient anchors — never gray drop
shadow as structure. Every glass container stacks `inset 0 1px 0 var(--glass-highlight)`
(the lit top edge) over one ambient ink shadow. The aurora field and per-object
spotlight pools do the real depth work; hover lifts (−1 to −4px) deepen the glow, not
the gray.

### Shadow Vocabulary
- **Glow (primary CTA)** (`--glow-electric`: `0 0 0 1px rgb(10 92 255/0.25), 0 12px 48px rgb(10 92 255/0.35)`): the primary button at rest; hover deepens to electric-400/500 at 40–48%. Reserved for the CTA and live states.
- **Card** (`--shadow-card`: `0 8px 30px rgb(5 7 14/0.35)`): story cards and glass panels.
- **Pop** (`--shadow-pop`: `0 2px 8px rgb(5 7 14/0.25), 0 16px 56px rgb(10 92 255/0.22)`): dialogs and hover-promoted rows (gh-row, ghost hover).
- **Per-face glow** (`--face-glow`): each card's hover shadow (0 24px 64px) is keyed to its own gradient family via `data-gradient`; sunset/coral have no warm token scale, so they borrow the nearest chroma blooms — never a recolored face.
- **Scrolled nav** (`0 12px 40px rgb(5 7 14/0.45)`): weight gain only on scroll.

### Named Rules
**The Glow Is Earned Rule.** `--glow-electric` appears on the primary CTA and live states only — never as hover wallpaper on ordinary surfaces.

## Shapes

Rounded-exhibit geometry on a hairline grid. Radii scale: 8px (sm: plates, small
controls), 14px (md: buttons, inputs, rows), 22px (lg: panels, plaque, dialog), 28px
(card: story faces), 32px (xl: persona cover, 404 card), 999px (pills, dots, toggle).
One-offs: 10px small buttons, 16px fan mini-cards, 6px link buttons, 5px checkbox boxes,
6–7px skeleton bars. Dashed 1px borders mark pending/ghost states (skeleton cards,
awaiting persona, ghost slot). Hairlines (1px `line`) bound every glass panel; gradient
hairlines dress the hang line, footer seam, and plaque top. Icon strokes inherit the
electric→volt gradient via SVG stop classes (`state-grad-a/b`).

## Components

### Buttons
- **Shape:** 14px radius (10px small), inline-flex, 8px gap.
- **Primary:** brand gradient fill (220% size, hover slides background-position to 85%), `ink-50` text, `--glow-electric`; hover lifts −2px, press scales 0.98. 600 weight, 15px.
- **Ghost:** glass fill + blur, AA boundary border (ink-400 50% + ink-700 — documented ≥3:1), hover tints electric 10% and lifts −1px.
- **Quiet:** transparent, ink-300 → ink-50 on hover. Disabled: opacity 0.4, no transform/glow. Link buttons (`linkbtn`) are the 13.5px quiet sibling.

### Chips
- **Style:** glass pill (`glass-bg-soft`, `line-strong` border), 4px 12px, 12.5px, with a 6px status dot (electric, glowing) welded in via `::before`.
- **State:** `--oncard` variant flips to scrim-on-gradient: white text, ink-950 30% fill, volt dot.

### Cards / Containers (the story card — signature component)
- **Corner Style:** 28px (`--radius-card`), 4/5 aspect.
- **Background:** one fixed `var(--grad-*)` face (never CSS-layered recolors), plus a 16% white top sheen and a bottom vignette baked as pseudo-elements.
- **Shadow Strategy:** `--shadow-card` at rest; hover lifts −4px and glows `--face-glow` keyed to the face's own gradient.
- **Border:** none on chroma faces; dashed `line-strong` on skeleton/ghost cards.
- **Internal Padding:** 28px face; the `card__body` caption panel hugs the bottom on `card-scrim` (20px 22px, 14px radius). Overline plate ("chapter 0n — kind", 12px mono lowercase on scrim pill), tabular index pill top-right, headline lowercase display, big mono moment numeral, dataline provenance in 12px mono, footer plate with white dot + `BRAND_NAME` in 13px display.
- **Ghost slot:** ink gradient + dashed border, no sheen/scrim, ink-scale text (documented 8.04:1 on ink-900).

### Inputs / Fields
- **Style:** ink-900 82% fill, AA boundary border (ink-400 75% + ink-700), 14px radius, 12px 14px padding, volt caret, glass inset highlight; textarea min-height 170px (120px in dialog).
- **Focus:** 2px volt-400 outline (offset 1px) + electric-400 border.
- **Error / Disabled:** charcount flips to `warning` past the limit; checkbox rows use `:has(:checked)` to tint electric; disabled opacity 0.55 (switch) / 0.65 (linkbtn — documented ≥3:1).

### Navigation
Sticky glass bar (72% ink-950 + 16px blur) on a `line` seam; wordmark left (lowercase display 18px, 10px gradient dot, glow), section links center with mono index prefixes (01/04/05/+), active route carries a scaleX gradient rule; session (avatar in a 2px gradient ring + name + quiet disconnect) right. Mobile: two-row condense with a scrollable link strip.

### State Panels (loading / empty / error)
Centered glass panel (22px radius, 44px 40px) with a top spotlight pool (`::before`) and a gradient-stroked SVG icon in electric-300; actions row beneath. Loading adds the three fizz dots (electric/volt/spark, 150ms stagger), a 2px gradient progress bar on ink-800, breathing skeleton lines, mono counter, and 13px hint.

### Share (dialog + link row)
Fixed overlay (ink-950 78% + 12px blur) over a 560px glass dialog with `--shadow-pop` and an AA boundary border; preview image on `line-strong` border; consent copy in mono; focus returns to the trigger on close.

### Yearline (the plaque)
Glass plaque (22px radius) with a volt glint hairline across its top edge; the spark is a fixed electric-400 1.5px stroke with a same-hue drop-shadow (brand law — never recolored; mirrored by the PNG renderer); caption in 12px mono tabular stating the data's provenance.

### Signature moment: the connect fan
Seven real mini story cards (132×184, 16px radius) fanned on a −26°→+26° arc, alternating z-order, breathing 7–9s; hover/focus-within eases the fan apart to −30°→+30° with per-card lift. The gradient faces are the fixed law; each mini card wears a scrim index pill and a white spark bar under the bottom light.

## Do's and Don'ts

### Do:
- **Do** reference the 7 card gradients only as `var(--grad-*)` (client) or provenance-commented literals (satori renderer) — `tokens.css` is the single source.
- **Do** keep text white on gradient faces and let `--card-scrim` (ink-950 70%) carry AA; keep the token name stable — the PNG renderer mirrors it.
- **Do** give every interactive element the 2px volt-400 focus outline (2px offset; 1px inside fields).
- **Do** set live numbers in JetBrains Mono 500 with `tabular-nums`, and pair gradient colors with text labels (the chapter overline names what the face encodes).
- **Do** document contrast math inline next to every custom border/text mix, as the shipped CSS does.
- **Do** gate all motion behind `prefers-reduced-motion` (no-preference gates for entrances; the global reduce block near-instants everything).
- **Do** use `--grad-safe` for small gradient text and reserve `--grad-brand` clips for display sizes (persona name, 404 ghost, ranks ≥24px).
- **Do** keep the aurora + grain fixed backdrop on every route so even the 404 sits on the same wall.

### Don't:
- **Don't** put raw hex in client code — tokens only; the documented exception is the satori renderer's literals, each carrying its `tokens.css` provenance comment.
- **Don't** bake the brand name into code or copy — one `BRAND_NAME` constant (`src/shared/brand.ts`) renders everywhere, including card footers and document titles.
- **Don't** use the trademark-banned year-review verb anywhere in UI, copy, docs, or commits (AGENTS.md §1.2); the honest phrase is "your year in posts".
- **Don't** recolor the yearline spark (fixed electric-400) or the card glow mapping by hand — hover glows come from `--face-glow` per `data-gradient`, borrowing nearest token-scale blooms where a warm scale doesn't exist.
- **Don't** letterspace display beyond the shipped −0.02 to −0.03em range, and never letterspace Inter body.
- **Don't** hang a screen without its caption plate, spotlight pool, and place on the hang line — a form floating in dark space is the category default this world exists to refuse.
- **Don't** add a second authored entrance per route; one `route-in` (520ms) plus the deck's 64ms stagger is the whole budget.
