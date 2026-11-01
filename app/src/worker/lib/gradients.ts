/**
 * Fixed card gradients + ink constants for satori rendering (spec 04 §2).
 *
 * Satori cannot read CSS custom properties, so these literals are the one
 * documented exception to the "colors only from tokens" rule (AGENTS.md §1.3) —
 * every literal carries its tokens.css provenance comment. The 7 gradients are
 * FIXED: never recolor them (deck identity), only reference them.
 */
import type { CardGradient } from "../../shared/types";

/** [head, tail] stops for `linear-gradient(135deg, head 0%, tail 100%)`.
 *  Restored 2026-11 to the committed palette — tokens.css `--grad-*`,
 *  BRAND-GUIDELINES §4 and spec 00 §4 agree on these stops; the previous
 *  six off-palette pairs were a drift the connect fan's token-true colors
 *  exposed (finish review, rebuild directive 1). */
export const CARD_GRADIENTS: Record<CardGradient, [string, string]> = {
  bolt: ["#0A5CFF", "#00D5FF"], /* token: --grad-bolt (electric-500 → volt-500) */
  aurora: ["#00D5FF", "#00FFA3"], /* token: --grad-aurora (volt-500 → #00FFA3) */
  fizz: ["#C8FF4D", "#00E5A0"], /* token: --grad-fizz (spark-500 → #00E5A0) */
  grape: ["#A855F7", "#6366FA"], /* token: --grad-grape (#A855F7 → #6366FA) */
  sunset: ["#FF8A00", "#FF3D77"], /* token: --grad-sunset (#FF8A00 → #FF3D77) */
  nebula: ["#6333FF", "#0A5CFF"], /* token: --grad-nebula (violet-500 → electric-500) */
  coral: ["#FF5C5C", "#FF9E2C"], /* token: --grad-coral (#FF5C5C → #FF9E2C) */
};

/** App background ink (dark-first canvas, AGENTS.md §1.4). */
export const INK_950 = "#05070E"; /* token: ink-950 */

/** White-alpha text/bar styles — satori has no var(); alpha ramps over gradients. */
export const TEXT_SOLID = "rgba(255,255,255,1)"; /* headline/stat white on ink-950 */
export const TEXT_BODY = "rgba(255,255,255,0.85)"; /* caption white-85 on ink-950 */
export const TEXT_DIM = "rgba(255,255,255,0.7)"; /* overline/label white-70 on ink-950 */
export const BAR_WHITE = "rgba(255,255,255,0.9)"; /* spark/microbar white-90 on ink-950 */
export const DOT_WHITE = "rgba(255,255,255,0.92)"; /* footer mark dot on ink-950 */
export const SEGMENT_WHITE = "rgba(255,255,255,0.25)"; /* mix segment white-25 overlay */
export const CHIP_BORDER = "rgba(255,255,255,0.3)"; /* persona chip border white-30 */
