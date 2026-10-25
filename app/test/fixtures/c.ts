/**
 * Fixture C — the empty account: every aggregate must stay null-safe with
 * honest zeros (no NaN, no fake data).
 */
import type { PostRow } from "../../src/shared/schema";

export const fixC: PostRow[] = [];
