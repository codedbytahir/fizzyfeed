# Spec 09 · Landing page — as built (motion system, chrome, SEO, deploy)

> Status: as-built 2026-10, live at <https://codedbytahir.github.io/fizzyfeed/>. This spec
> documents the shipping landing page so agents can maintain it without re-reading 3,000
> lines of HTML. The fx module internals stay governed by
> [`docs/ANIMATIONS.md`](../ANIMATIONS.md); this spec governs everything around them.

## 1 · Files & shape

```
landing/
  index.html      # ~2,990 lines: <head> + chrome <style id="fx-css"> (6 inlined modules) + body + 4 module scripts
  styles.css      # 153 lines: page chrome only (tokens, nav, sections, reveal system, responsive)
  main.js         # 85 lines: brand injection, hosting-aware links, fx CPU guard, reveal observer, footer year
  halftone.js     # vanilla port of the HalftoneDots React component — deck-fan card dot art (see §4.5)
  robots.txt      # pages-root crawl policy + sitemap pointer
  sitemap.xml     # single URL (the landing)
  logo/           # favicon-48.png, lockup-on-dark.svg (main.js swaps .brand src to the svg)
  social/         # og-image.png (1200×630)
  img/chapters/   # 7 webp artworks (512px, white-point normalized) sampled by halftone.js
  animations/     # standalone module sources (each fx-0*/index.html opens directly)
```

Contract: **module styles and scripts are inlined into `index.html`** at assemble time
(ANIMATIONS.md §2). `styles.css` and `main.js` are page-level glue and must never style
inside `.fx-*` roots.

## 2 · Design tokens (chrome)

`styles.css :root` is the single source of truth for page chrome (raw hex outside `:root`
= 0, enforced by grep). Two token families live there:

1. **Brand** (mirrors `tokens.json`): `--electric-400/500/600`, `--volt-500`,
   `--violet-500`, `--spark-500`, `--ink-950/900/800/300/200/50`, `--grad-brand`,
   `--radius-card/md/pill`, `--glow-electric`, `--shadow-card`, `--wrap: 1120px`,
   `--line`/`--line-strong` (white alpha hairlines).
2. **Motion library** (measured from vibrant.design production CSS — benchmark data in the
   `experiments-with-ai` repo, `data/extracted-tokens.json`):

| Token | Value | Use |
|---|---|---|
| `--ease-out-quint` | `cubic-bezier(.22,1,.36,1)` | default entrances |
| `--ease-out-quart` | `cubic-bezier(.23,1,.32,1)` | panels, cards, hover lifts |
| `--ease-out-expo` | `cubic-bezier(.16,1,.3,1)` | hero reveals, big surfaces |
| `--ease-inout-quint` | `cubic-bezier(.32,.72,0,1)` | state changes |
| `--ease-inout-cubic` | `cubic-bezier(.66,0,.34,1)` | loops, position swaps |
| `--ease-spring` | `cubic-bezier(.34,1.96,.94,1)` | success pops |
| `--ease-spring-soft` | `cubic-bezier(.34,1.45,.64,1)` | button press/release |
| `--dur-hover` / `--dur-entrance` / `--stagger` | `180ms / 500ms / 64ms` | duration bands |

Motion laws (chrome): only `transform`, `opacity`, `filter`, `background-position` animate;
hovers 150–250ms with translateY ≤ 2px or scale ≤ 1.03; `transition: all` count must stay 0.

## 3 · Entrance reveal system (G1 gate)

- Markup: `.reveal` class on 31 nodes (hero copy children, every section head, steps,
  chapters, cta-box). Initial state `opacity:0; translateY(16px)`.
- `main.js` assigns `--i` per section (capped at 8 — the benchmark stagger cap) and adds
  `.is-in` at 15% visibility with `rootMargin: 0px 0px -40px`, then unobserves.
- Transition on `.is-in`: 500ms `--ease-out-expo` for opacity + transform, delay
  `calc(var(--i) * var(--stagger))`.
- Safety nets (all three required): `@media (prefers-reduced-motion: reduce)` shows
  everything instantly; `.no-js .reveal` rule + `<html class="no-js">` (removed by main.js);
  `<noscript><style>` unhides reveals. Content must never be stranded hidden.

## 4 · Page behaviors (main.js)

1. **Brand injection** — `BRAND_NAME` const (single rename point); swaps `img.brand` src to
   the SVG lockup; fills leaf `[data-brand-name]` text slots only (never `.fx` roots).
2. **Hosting-aware links** — on `*.github.io`: `[data-connect]` CTAs → the GitHub repo
   (no backend exists there) and footer `../` links → `github.com/codedbytahir/fizzyfeed/blob/main/…`.
   Anywhere else: CTAs keep the honest `/api/auth/buffer/login` deep-link. This keeps H2
   (zero dead links) true on both hosts.
3. **fx CPU guard** — IntersectionObserver toggles `data-fx-state="idle|live"` on `.fx`
   roots; `styles.css` pauses all CSS loops while idle.
4. **Reveal observer** — §3 above.
5. **Footer year** — `[data-year]` ← current year.

## 4.5 · Deck-fan halftone art (halftone.js)

Vanilla port of the uploaded `HalftoneDots` React component (no build step). Each of the 7
`.fx-deck-fan__card`s carries a `.fx-deck-fan__art[data-halftone]` layer (absolute inset 0,
`border-radius: inherit`, `overflow: hidden`, `pointer-events: none`) that renders its chapter
artwork (`img/chapters/ch-0*.webp`) as a dot lattice on a canvas — an **ink dot print over the
card's brand gradient**: `data-from="\#05070E"`/`data-to="\#131A2B"` force the ink ramp,
`data-accent="\#FFFFFF"` draws the corner registration marks, and the host's `color: #FFFFFF`
becomes the faint paper-dot frost. The chapters-grid below the fan is the plain bento list
(no halftone there — the dots live only in the animated cards).

- **Behavior**: staggered radial morph reveal when the fan first approaches the viewport
  (lazy load at 480px); render loop runs only while morphing — the dots are otherwise a
  static print that rides the card's own fan/beat/sway transforms.
- **Decorative by design**: the fan root is `role="img"`, so art hosts take
  `pointer-events: none` — no hover lens, no ripples, no 7-press burst here (those
  interactions belong to the standalone component/plates, not to a role="img" module).
  `halftone.js` still attaches its listeners; they simply never fire.
- **Resilience**: `crossOrigin` only on http(s); a taint probe marks the host
  `.halftone-failed` on file:// (canvas stays transparent → the fan degrades to exactly
  its pre-halftone gradient look) — smoke stays console-clean.
- `prefers-reduced-motion`: static single render, no morph, no listeners; canvases
  `aria-hidden`; resize handled by a debounced ResizeObserver (cards scale with `cqw`).

## 5 · SEO & meta (C gates)

`<head>` carries: canonical → the pages URL; `og:type/url/title/description/image` +
`twitter:card/title/description/image` (image absolute, 1200×630); JSON-LD `WebSite`
(name, url, description, publisher → the repo). Title 29 chars; description 154 chars
(band 90–155). `robots.txt` + `sitemap.xml` deploy to the site root. Headline rules:
H1 ≤ 10 words ("your year in posts." = 4), subhead names concrete nouns, CTAs verb-first
("connect buffer", "see the deck"). Banned filler words ("seamless", "revolutionary",
"unleash", …) must stay absent — grep before copy edits.

## 6 · Responsive system

- Chrome: `clamp()` type + `clamp(64px,9vw,128px)` section rhythm; 900px breakpoint
  (how-grid stacks, nav links hide, hero tightens). Zero horizontal scroll at any width —
  the accepted overflow baseline is decorative SVG internals + the by-design fx-06 crop.
- fx-05 persona: card is absolutely centered (`translate:-50% -50%`, Chrome safe-centering
  proof) and steps `--fx-card-scale` 0.75/.62/.55/.48 at 720/560/430/360px.
- fx-06: JS `fit()` (ResizeObserver) crop-scales the 1200px stage on <720px
  (`(w/1200)*1.8` capped 0.66) so the recap card + CTA stay prominent; side chips crop away.
- fx-03: label floors `max(1.0833cqw,6px)` / `max(2cqw,11px)` keep text legible.

## 7 · Verification & deploy (run before every push to main)

| Script | Proves |
|---|---|
| `node scripts/smoke-test-landing.js` | landing + 6 standalone modules render console-clean |
| `node scripts/halftone-check.js` | 7 deck-fan dot canvases paint (decorative pointer rules, grid restore), mobile, reduced-motion |
| `node scripts/responsive-test.js` | 390/768 sweep + overflow detector (baseline: §6) |
| `node scripts/benchmark-verify.js` | reveals fire on load/scroll, reduced-motion shows 31/31, link rewrite logic |
| `node scripts/fx06-tour-test.js` | courier choreography beats + mobile fit |

Deploy: `bash scripts/deploy-gh-pages.sh` — force-rebuilds the orphan `gh-pages` branch
from `landing/*` (+ `.nojekyll`, robots, sitemap) and pushes. Verify live with cache-busted
curl greps for the markers changed in the edit. Never edit `gh-pages` directly.

## 8 · Change rules for agents

1. Edit `landing/` sources only; redeploy via §7. Keep module edits inside `.fx-*` scope.
2. New section → add its `.reveal` hooks + aria-labelledby heading, keep one gradient
   moment per viewport (ANIMATIONS.md §0.1).
3. Any new easing/duration goes in `:root` tokens first — no one-off cubic-beziers.
4. After motion edits re-run all four §7 scripts; after copy edits re-grep banned words
   and the 90–155 char description band.
5. `main.js` stays ≤ ~100 lines; if it grows, split into modules with the same no-framework IIFE style.
