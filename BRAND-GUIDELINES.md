# fizzyfeed — Brand Guidelines v0.1

> Electric Blue identity · dev codename `kroma` · final name pending (`fizzyfeed` / `feezyfeed`).
> Everything here is **name-agnostic**: the mark encodes the product, the wordmark is a swappable part.

---

## 1 · Brand idea

**"Your year in posts."** The product turns a year of Buffer posting history into 5–7 colorful, shareable story cards, names your posting persona with AI, and queues a recap post in one click.

The brand must feel like that promise: **data turned into delight**. Precise enough to be a tool, warm enough to be a gift. Think less "analytics dashboard", more "trading cards of your own year".

Three personality anchors:

- **Electric** — energy, spark, alive. Dark canvas, blue light.
- **Chromatic** — color is the payoff (the `kroma` heritage). One gradient moment per view, never confetti everywhere.
- **Honest** — real numbers, real charts, no fake inflation. The sparkline IS the aesthetic: we draw your actual year.

## 2 · Naming system

| Layer | Decision |
|---|---|
| Codename (dev) | `kroma` — internal, commit messages, staging, this repo's dev branch |
| Candidate A | `fizzyfeed` — fizzy (energy/fizz of a good year) + feed |
| Candidate B | `feezyfeed` — variant spelling, same treatment |
| Lock-in rule | Do **not** bake either name into code identifiers; use a single `BRAND_NAME` const + this asset swap |

The **Yearline mark never changes** when the name does. Only the wordmark file swaps. This was a hard design requirement: one logo must survive a rename that hasn't happened yet.

Wordmark rendering: **Space Grotesk Bold, lowercase, no tagline attached**. The supplied `wordmark-*.svg` / `lockup-*.svg` files are vector-outlined — no font install needed, they render identically everywhere.

## 3 · The Yearline mark

### 3.1 Meaning

| Element | Meaning |
|---|---|
| Rounded gradient card | the story cards; the chroma sweep = your colorful year |
| Ascending sparkline | posting activity across the year, with dips kept honest |
| Terminal dot | the recap moment — the point the whole year rises toward |

### 3.2 Variants

| File | Use |
|---|---|
| `mark-gradient.svg` | primary — app icon, favicon, avatars, buttons, loading states |
| `mark-glyph-dark.svg` | white sparkline+dot only — on `ink-800`…`ink-950` backgrounds, headers |
| `mark-glyph-light.svg` | ink sparkline+dot only — on `ink-50`/white backgrounds, print |

### 3.3 Clearspace & minimums

- Clearspace on all sides = **the diameter of the terminal dot** (64/512 of mark height ≈ 12.5%).
- Minimum sizes: gradient mark **24px**, mono glyph **20px**, favicon renders down to 16px.
- In lockups, wordmark cap-height ≈ 75% of mark height; gap = 22% of mark height (pre-built in the files).

### 3.4 Misuse — never

- Recolor the sparkline or place it on a photo.
- Rotate, add drop shadows, or outline the card.
- Stretch non-uniformly; only proportional scaling.
- Put the gradient mark on a colored background busier than `ink-800`.
- Rebuild the wordmark in another font "just this once".

## 4 · Color

### 4.1 Core scales

Electric Blue is the primary; `electric-500 #0A5CFF` is THE brand color. Use `electric-600 #0047E0` for small text on white (AA). Volt cyan (`#00D5FF`) and Chroma Violet (`#6333FF`) exist to complete the brand gradient — on their own they are accents, never co-primary.

Ink neutrals are **blue-tinted** on purpose: the whole product lives on `ink-950 #05070E`, and pure gray would feel dead next to electric blue.

### 4.2 Usage ratio (60 / 30 / 10)

- **60%** ink neutrals (backgrounds, surfaces, body text)
- **30%** electric blue + volt (interactive elements, focus, data)
- **10%** chroma moments (brand gradient, card gradients, spark lime)

### 4.3 Recap card palette

One gradient per story card, assigned by content mood. Brand cards (Bolt, Nebula) lead the deck:

| Card | Gradient | Mood |
|---|---|---|
| Bolt | `#0A5CFF → #00D5FF` | energy, top streaks |
| Nebula | `#6333FF → #0A5CFF` | deep-work, big thoughts |
| Aurora | `#00D5FF → #00FFA3` | growth, milestones |
| Lime Fizz | `#C8FF4D → #00E5A0` | fun, viral moments |
| Sunset | `#FF8A00 → #FF3D77` | evenings, personal |
| Coral Pop | `#FF5C5C → #FF9E2C` | warm, community |
| Grape Soda | `#A855F7 → #6366FA` | playful, weird |

Rule: text on cards is always **white**; no card uses the brand gradient's violet head with white small text below 18px without checking contrast.

## 5 · Typography

| Role | Font | Weight | Case |
|---|---|---|---|
| Display, wordmark, big numbers on cards | Space Grotesk | 500 / 700 | **lowercase** headlines |
| UI, body, buttons | Inter | 400 / 500 / 600 | sentence case |
| Stats, timestamps, counters | JetBrains Mono | 500 | as-is |

- Headlines are lowercase — it's the friendly half of "playful-precise".
- Never letterspace Space Grotesk display sizes beyond -1%.
- Numbers that change live (counts, streaks) use JetBrains Mono with `font-variant-numeric: tabular-nums`.

## 6 · Voice & microcopy

**Playful-precise.** Confident, short, a little cheeky — then immediately useful.

| ✅ Do | ❌ Don't |
|---|---|
| "Your year in posts." | "Introducing our amazing year-review tool!" |
| "5,214 posts. 389,102 words. One very tired keyboard." | fake enthusiasm, exclamation stacks |
| "Queue the recap" | "Wrapped for Buffer!" (trademark — the word **wrapped** is banned in UI/copy) |
| "name your posting alter ego" | "AI-powered persona generation engine" |

Microcopy is sentence case, ≤ 40 chars for buttons, and always names the real action.

## 7 · Motion & delight notes

- The sparkline **draws itself** left→right on first reveal (300–500ms, ease-out); the dot pops with a 200ms overshoot. This is the signature motion — reuse it for progress moments.
- Card reveals: stagger 80ms, slight scale 0.96→1 + rise 12px.
- Glow (`--glow-electric`) is reserved for the primary CTA and live states — not hover wallpaper.

## 8 · Social & OG kit

| Asset | Spec |
|---|---|
| `social/og-image.png` | 1200×630, name-agnostic (mark + headline + chip) |
| `social/og-image-kroma.png` / `-fizzyfeed.png` | named variants — swap when the name lands |
| `social/github-social-preview.png` | 1280×640 — upload in repo Settings → Social preview |
| `social/twitter-banner.png` | 1500×500 |
| `logo/png/avatar-{400,1000}.png` | avatars |
| `logo/png/favicon-32.png`, `apple-touch-icon-180.png`, `icon-{192,512}.png` | web icons |

OG layout system: `ink-950` bg → two soft radial glows (electric top-right, violet bottom-left) → gradient mark centered → Space Grotesk headline → one-line sub → pill chip → 6px brand-gradient bar at the bottom edge. Keep every future OG/card template in this system so the feed of shared cards looks like one deck.

## 9 · Accessibility

- Body text on `ink-950`: use `ink-200` or lighter (≥ 4.5:1).
- `electric-500` on `ink-950` passes for large text/UI; for small text on white use `electric-600`.
- Never rely on gradient color alone to encode meaning on cards — pair with labels.
- Focus rings: 2px `volt-500` + 2px offset on dark.

## 10 · Asset index

```
logo/svg/    16 files — marks (4), wordmarks (6), lockups (6) · vector masters
logo/png/    10 files — icons, avatars, glyphs · rendered from svg
social/      5 svg + 5 png — OG ×3, GitHub preview, Twitter banner
preview/     index.html — open in browser for the visual board
tokens.css   drop-in design tokens (CSS custom properties)
tokens.json  same tokens, W3C design-tokens shape
```

Regenerate PNGs after editing any SVG master (see repo scripts or render at the sizes above).
