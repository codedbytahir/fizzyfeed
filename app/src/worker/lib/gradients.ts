/**
 * Deck sheet fills for satori rendering (theme: Hum).
 *
 * Satori cannot read CSS custom properties, so these literals are the one
 * documented exception to the "colors only from tokens" rule (AGENTS.md §1.3)
 * — every literal carries its tokens.css provenance comment, and
 * scripts/oklch2hex.py regenerates every value. One SOLID card-stock sheet
 * per chapter; accents never blend, no gradient anywhere (Hum do-nots).
 *
 * `on` is the ink that sits on the sheet: blue-black ink on every light
 * stock; the fringe (pale fibre core) on the blue sheet only — it is the one
 * fill light text can sit on (5.7:1). Dim variants are the same ink at alpha.
 */
import type { CardGradient } from "../../shared/types";

export interface SheetColors {
  fill: string;
  on: string;
  onDim: string;
}

const INK = "#12161C"; /* token: --color-ink */
const FRINGE = "#FEFCF8"; /* token: --color-fringe */

export const CARD_SHEETS: Record<CardGradient, SheetColors> = {
  bolt: { fill: "#F7D21A", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-pear */
  aurora: { fill: "#C6DFEF", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-sugar */
  fizz: { fill: "#70E093", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-mint */
  grape: { fill: "#D9AC69", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-sand */
  sunset: { fill: "#0064BE", on: FRINGE, onDim: "rgba(254,252,248,0.74)" }, /* token: --sheet-blue */
  nebula: { fill: "#AE7D52", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-kraft */
  coral: { fill: "#FF5E63", on: INK, onDim: "rgba(18,22,28,0.74)" }, /* token: --sheet-coral */
};

/** App canvas: grained cream paper (the page around the sheet). */
export const PAPER = "#F7F5EC"; /* token: --color-paper */

/** Share-page + OG constants re-declared from tokens.css (documented above). */
export const TEXT_SOLID = INK;
export const TEXT_BODY = "rgba(18,22,28,0.85)"; /* ink @ 85% */
export const TEXT_DIM = "rgba(18,22,28,0.62)"; /* ink @ 62% — labels on paper */
export const BAR_INK = "rgba(18,22,28,0.82)"; /* bars on a sheet */
export const DOT_INK = INK;
export const RULE_PAPER = "rgba(18,22,28,0.14)"; /* hairline on paper */
