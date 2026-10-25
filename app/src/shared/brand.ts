/**
 * Single rename point for the whole product (AGENTS.md §1).
 * Changing this const must be the ONLY edit needed to rebrand the app.
 */
export const BRAND_NAME = "fizzyfeed";

/** Worker cron expression: hourly yearize fetch (spec 01 §4). */
export const CRON_EXPRESSION = "0 * * * *";

/** Backfill ceiling per token per day (spec 03 §2) — cron stops at 240 and resumes. */
export const DAILY_REQUEST_CEILING = 250;
/** Cron safety margin — never cross this many requests per token per day. */
export const DAILY_REQUEST_SAFETY_STOP = 240;
