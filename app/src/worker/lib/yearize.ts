/**
 * Yearize aggregates (spec 03 §3) — CONTRACT STUB, replaced by task T10.
 *
 *  - computeYearStats: pure YearStats from post rows (UTC calendar math).
 *  - statsHash8: stable 8-hex fingerprint of aggregates — card cache keys
 *    (spec 04: statsHash8 invalidates stale cards).
 */
import type { PostRow } from "../../shared/schema";
import type { YearStats } from "../../shared/types";

export function computeYearStats(
  _posts: PostRow[],
  _year: number,
  _asOf?: number
): YearStats {
  throw new Error("not_implemented: computeYearStats lands with task T10");
}

export function statsHash8(_stats: YearStats): string {
  throw new Error("not_implemented: statsHash8 lands with task T10");
}
