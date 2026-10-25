/**
 * Fixed card gradients + ink constants for satori rendering (spec 04 §2).
 *
 * Satori cannot read CSS custom properties, so these literals are the one
 * documented exception to the "colors only from tokens" rule (AGENTS.md §1.3) —
 * every literal carries its tokens.css provenance comment. The 7 gradients are
 * FIXED: never recolor them (deck identity), only reference them.
 */
import type { CardGradient } from "../../shared/types";

/** [head, tail] stops for `linear-gradient(135deg, head 0%, tail 100%)`. */
export const CARD_GRADIENTS: Record<CardGradient, [string, string]> = {
  bolt: ["#0A5CFF", "#00D5FF"], /* token: electric-500 → volt-500 */
  aurora: ["#6333FF", "#0A5CFF"], /* token: violet-500 → electric-500 */
  fizz: ["#C8FF4D", "#00D5FF"], /* token: spark-500 → volt-500 */
  grape: ["#4A1FD9", "#0037B0"], /* token: violet-600 → electric-700 */
  sunset: ["#9A6BFF", "#C8FF4D"], /* token: violet-400 → spark-500 */
  nebula: ["#0037B0", "#6333FF"], /* token: electric-700 → violet-500 */
  coral: ["#0A5CFF", "#C8FF4D"], /* token: electric-500 → spark-500 */
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
