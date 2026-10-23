# fizzyfeed — brand kit

**Electric Blue identity · your year in posts.**
Built for **Buffer Commit 2026** ($25,600 hackathon, Oct 28 – Nov 13).

![og](social/og-image.png)

## Name status

| Role | Name | Domain | State |
|---|---|---|---|
| Dev codename | `kroma` | kroma-ai.xyz (owned) | ✅ active — used during development |
| Final candidate A | `fizzyfeed` | fizzyfeed.cv (~$7.98/yr) | ⏳ pending purchase decision |
| Final candidate B | `feezyfeed` | feezyfeed.cv | ⏳ pending |

**The mark is name-agnostic by design** — it encodes the product (a sparkline of your posting year on a chromatic card), not a word. Swap the wordmark whenever the name lands; the Yearline never changes.

## The mark — "Yearline"

- **Gradient card** → your year of posts as colorful, shareable story cards (the chroma sweep nods to the `kroma` codename)
- **Ascending sparkline** → posting activity through the year, with ups and downs
- **Terminal dot** → the recap moment; the highlight the year builds toward

Files: `logo/svg/mark-gradient.svg` (primary), `mark-glyph-dark.svg` / `mark-glyph-light.svg` (mono, no card), `favicon.svg`.

Wordmarks & lockups (vector-outlined, font-independent): `logo/svg/wordmark-{name}-{on-dark|on-light}.svg`, `lockup-{name}-{on-dark|on-light}.svg` — pre-built for **kroma / fizzyfeed / feezyfeed** so the rename is a file swap, not a redesign.

## Palette

| Token | Hex | Use |
|---|---|---|
| `electric-500` | `#0A5CFF` | **Primary** — buttons, links, focus, brand moments |
| `electric-600` | `#0047E0` | Small text on white (AA-safe) |
| `volt-500` | `#00D5FF` | Gradient tail, live/active accents on dark |
| `violet-500` | `#6333FF` | Gradient head, secondary charts |
| `spark-500` | `#C8FF4D` | Delight accent — sparingly (≤5% of any screen) |
| `ink-950` | `#05070E` | App background (dark-first) |
| `ink-300` | `#9AA8C4` | Secondary text on dark |

Full scales, 7 recap-card gradients, radii, glows → `tokens.css` / `tokens.json`.

## Typography

| Role | Font | Notes |
|---|---|---|
| Display / wordmark | **Space Grotesk** 500/700 | lowercase headlines, -1% tracking feel |
| UI / body | **Inter** 400/500/600 | sentence case |
| Stats / numbers | **JetBrains Mono** 500 | tabular data, streaks, counts |

## Quick use

```html
<link rel="stylesheet" href="tokens.css">
<!-- or Tailwind v4 -->
<style>
  @theme {
    --color-electric-500: #0A5CFF;
    --color-ink-950: #05070E;
    --font-display: "Space Grotesk", sans-serif;
  }
</style>
```

## Social & OG assets

| File | Size | Use |
|---|---|---|
| `social/og-image.png` | 1200×630 | default OG (name-agnostic) |
| `social/og-image-kroma.png` / `-fizzyfeed.png` | 1200×630 | named variants |
| `social/github-social-preview.png` | 1280×640 | repo Settings → Social preview |
| `social/twitter-banner.png` | 1500×500 | X/Twitter header |
| `logo/png/avatar-400.png` | 400×400 | GitHub/X avatar |

Source `.svg` masters sit next to every PNG — edit those, re-render.

## Preview

Open `preview/index.html` in a browser — full brand board: logo variants, clearspace, palette, card gradients, type specimen, usage do/don'ts.

## Rules of thumb

1. Dark-first: `ink-950` background, electric blue as the light source.
2. One gradient per screen section — the chroma sweep is a highlight, not wallpaper.
3. Never recolor the mark's sparkline; the card gradient is the only color it wears.
4. Don't use the word "wrapped" anywhere in UI or copy (trademark).
5. Min sizes: mark 24px, glyph 20px, lockup height 32px.

## License & attribution

© 2026 — brand assets for this project. "Buffer" is a trademark of Buffer Inc.; this kit references the Buffer Commit contest but grants no rights to Buffer's name or logo.
