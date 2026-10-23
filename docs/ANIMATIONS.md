# ANIMATIONS — landing page motion spec v1

> The landing page is a **motion piece**: a year of posts turning into a deck of cards.
> Inspired by the reference "tiles → hub → workflow cards" seamless SVG loop (24s loop,
> edge-fade masks, floating tiles, intake hub, output cards) and patterns from
> vibrant.design (bento feature grids, frosted glass, micro-interactions, bold hero wordmarks).

## 0 · Motion principles (hard rules)

1. **One gradient moment per viewport** — a section's animation may carry ONE gradient payoff. Never confetti.
2. **The spark is sacred** — the yearline spark always draws left→right, ease-out, with a 200ms overshoot pop on its end dot. Reuse this as the progress/delight gesture everywhere.
3. **Card reveal grammar** — stagger 80ms, scale 0.96→1, rise 12px. All card entrances use it. No exceptions, no variants.
4. **Glow is earned** — `--glow-electric` only on the primary CTA and live/active states, never as hover wallpaper.
5. **Seamless loops only** — every looping animation must cycle without a visible seam (first frame == last frame). Prefer long loops (12–24s) with motion always in flight.
6. **60fps or nothing** — animate only `transform` and `opacity` (plus SVG `stroke-dashoffset` for draws). No layout properties, no `filter` animations on large areas, no box-shadow tweens (use pre-baked glow layers crossfading).
7. **Reduced motion** — every module must honor `prefers-reduced-motion: reduce` by showing the *final composed frame* as a static image-like state (no loop, no parallax). Copy stays legible.
8. **Dark-first canvas** — `ink-950 #05070E` background, electric blue as the light source. Radial glows allowed at ≤ 0.25 opacity.
9. **Numbers never lie** — stats shown in animations are the real demo numbers; counters use JetBrains Mono, `tabular-nums`.
10. **Name-agnostic** — never hardcode the product name inside animation assets; read it from `[data-brand-name]` or a JS const the landing page injects.

## 1 · Design tokens (inline these — no external CSS imports)

```css
--electric-500:#0A5CFF; --electric-600:#0047E0; --volt-500:#00D5FF; --violet-500:#6333FF;
--spark-500:#C8FF4D; --ink-950:#05070E; --ink-900:#0A0E1A; --ink-800:#131A2B;
--ink-300:#9AA8C4; --ink-200:#C6D0E4; --ink-50:#F5F8FE; --white:#FFFFFF;
--grad-brand: linear-gradient(135deg,#6333FF,#0A5CFF,#00D5FF);
--grad-bolt:  linear-gradient(135deg,#0A5CFF,#00D5FF);  /* card 1 */
--grad-nebula:linear-gradient(135deg,#6333FF,#0A5CFF);  /* card 6 */
--grad-aurora:linear-gradient(135deg,#00D5FF,#00FFA3);  /* card 2 */
--grad-fizz:  linear-gradient(135deg,#C8FF4D,#00E5A0);  /* card 3 */
--grad-sunset:linear-gradient(135deg,#FF8A00,#FF3D77);  /* card 5 */
--grad-coral: linear-gradient(135deg,#FF5C5C,#FF9E2C);  /* card 7 */
--grad-grape: linear-gradient(135deg,#A855F7,#6366FA);  /* card 4 */
--radius-card:28px; --radius-md:14px; --radius-pill:999px;
--glow-electric: 0 0 0 1px rgb(10 92 255 / .25), 0 12px 48px rgb(10 92 255 / .35);
--shadow-card: 0 8px 30px rgb(5 7 14 / .35);
```

Fonts (Google Fonts): **Space Grotesk** 500/700 (display, lowercase), **Inter** 400/500/600 (UI),
**JetBrains Mono** 500 (numbers). Text on gradient cards is always white.

## 2 · Module contract (how every animation ships)

Each module is ONE file: `landing/animations/<id>/index.html`.

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>fx · <id></title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
  <style>
    /* == page scaffold (standalone preview only — landing strips this block) == */
    html,body{margin:0;background:#05070E}
    /* == fx-<id> module styles — ALL selectors scoped under .fx-<id> == */
    .fx-<id>{...}
  </style>
</head>
<body>
  <!-- MODULE ROOT: this whole div is what the landing page embeds -->
  <div class="fx fx-<id>" data-brand-name="fizzyfeed" role="img" aria-label="...">
    ...
  </div>
  <script>/* module JS — no globals, IIFE only, no network calls */</script>
</body>
</html>
```

Rules:
- All class names prefixed `fx-<id>__` (BEM-ish); no `body`/`html` styling inside the module block.
- Self-contained SVG inline; no external images; no network calls (fonts CDN excepted).
- Loops driven by CSS animations where possible; JS (rAF) only for sequencing/text morphs.
- Include a reduced-motion static fallback state (final composed frame, no loop).
- Target canvas ~1200×675 (16:9) desktop, stack to ~720px wide on mobile; the module must not overflow its root.
- Add `<!-- FX-MODULE-START -->` / `<!-- FX-MODULE-END -->` comments around the embeddable root div.
- torph (text morphing): load via `<script type="module">import { ... } from 'https://esm.sh/torph'</script>` ONLY in fx-04/fx-05/fx-06; must have a pure-CSS/rAF fallback if the import fails (wrap in try/catch dynamic import).

## 3 · The six modules

### fx-01 `hero-deck` — "your year becomes a deck" (hero centerpiece)
The signature loop. A single white yearline spark draws left→right across a subtle grid
(300–500ms feel, ease-out) — 12 tiny month ticks light up as it passes — the line then
folds/fans into **The Deck** (three fanned gradient cards: violet flank, electric core,
volt flank), the white spark pops on the front card with the overshoot dot, cards settle
with a soft 2–3° breathing sway. Loop 14s: draw → fold → settle sway → gentle dissolve → redraw.
Tiles from the feed may drift faintly in the deep background (opacity ≤ .12).

### fx-02 `feed-to-deck` — "your posts, harvested" (the reference homage)
Direct adaptation of the attached SVG loop, fizzyfeed-flavored: floating **channel tiles**
(Buffer channels as minimal monogram tiles — X, IG, in, f, ♪, ▶, th, P, b, M, G — white
glyph on `#131A2B` rounded tile with a 6px per-channel accent dot; NO real brand logos)
drift in from the edges with the horizontal/vertical **edge-fade masks**, stream diagonally
toward a central **deck hub** (the Deck mark with two open concentric rings + dark navy
intake, echoing the reference's hub language), and **story cards** (7 gradients, rotated
slightly) emerge from the hub and travel up-right before fading. 22s seamless loop,
floor shadow blur under the hub. Mirror the reference's craft: bevel highlight, intake
cutout mask, soft gaussian shadows.

### fx-03 `deck-fan` — "seven chapters" (bento chapter section)
Seven story cards fan out from a stacked deck in card order (Kickoff→Recap), each in its
gradient, revealing for 1.2s: chapter number (JetBrains Mono), one-line label (lowercase
Space Grotesk), then re-fan back with the spark pulse closing the loop. 12s loop, 80ms
stagger grammar on both open and close. Cards lift with the card shadow; on the live
landing, hover can pause the loop.

### fx-04 `yearline-draw` — "your rhythm, honestly" (stats band)
A wide yearline (365 data points, real-looking seasonal curve) draws across a 12-month
axis; as it passes each month, that month's post-count tick pops and a stat counter
**morphs up** to its value (JetBrains Mono, tabular-nums): 5,214 posts · 389,102 words ·
141-day streak · 12 channels. Then the end dot overshoot-pops and a `#C8FF4D` glow tint
pulses once. Counters use torph-style morphing (or rAF count-up if torph fails to load);
loop rests 2s then re-draws from a slightly different seed curve (3 variants rotating so
the loop feels alive). 16s cycle.

### fx-05 `persona-morph` — "meet your alter ego" (AI section)
A nebula-gradient card (violet→electric) holds a lowercase persona name that **morphs
between personas** using torph (vanilla build via esm.sh; graceful rAF crossfade fallback):
"the midnight archivist" → "the quiet storm" → "the tuesday regular" → "the long-game
builder". Under the name, a one-line origin story crossfades ("posted 214 nights after
11pm — consistency masquerading as insomnia"). Card breathes ±2° slowly; a thin white
sparkline draws itself along the card's bottom edge each cycle. 18s loop.

### fx-06 `queue-recap` — "one click, queued everywhere" (CTA section)
The recap post card (white surface on ink) composes itself line by line (typewriter,
torph cursorIndex if loaded); a primary "queue the recap" button (#0A5CFF, glow ON —
this is the CTA exception) presses once; the card then **fans into mini channel chips**
(same monogram tiles as fx-02) each gaining a #00D5FF checkmark in 80ms-stagger; ends
on the button glow pulse. 15s loop. This module doubles as the landing's final CTA visual.

## 4 · Landing page integration (assembled by the orchestrator, not modules)

- Page skeleton: `landing/index.html` + `landing/styles.css` + `landing/main.js`.
- Sections: nav → hero (fx-01) → proof band (fx-04) → how it works (fx-02) → chapters (fx-03) → alter ego (fx-05) → CTA (fx-06) → footer.
- Copy voice: playful-precise, sentence case, lowercase headlines; the word "wrapped" is BANNED everywhere.
- One `<section>` per module; each embeds the `fx-<id>` root div with its scoped styles + script, inlined at assemble time by the orchestrator.
- IntersectionObserver: modules animate only when in view (`data-fx-state="idle|live"`), saving CPU.
- `BRAND_NAME` const in main.js injects the name into `[data-brand-name]` slots.

## 5 · Acceptance checklist (every module must pass)

- [ ] Seamless loop (no jump cut), duration as specced ±20%
- [ ] transform/opacity/stroke-dashoffset only; 60fps in a clean profile
- [ ] `prefers-reduced-motion` static state renders the composed final frame
- [ ] All selectors scoped under `.fx-<id>`; no global leaks; no body styling in module block
- [ ] Tokens match §1 exactly (hex, radius, fonts); text on gradients is white
- [ ] Banned word absent; no hardcoded product name (uses data-brand-name)
- [ ] Works standalone (open file directly) AND when embedded in the landing page
- [ ] aria-label present describing the animation in one sentence
