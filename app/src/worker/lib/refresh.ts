/**
 * Token refresh lifecycle (spec 02 §4) — CONTRACT STUB, replaced by task T07.
 *
 *  - withAccessToken: decrypt access token, run fn; on Buffer 401 refresh ONCE
 *    (rotation inside db.batch()) and retry; second failure throws RefreshError.
 *  - refreshExpiringTokens: cron helper — refresh rows with expires_at < now+24h.
 */
import type { Env } from "../env";

export class RefreshError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 502 = 502
  ) {
    super(message);
    this.name = "RefreshError";
  }
}

export async function withAccessToken<T>(
  _env: Env,
  _userId: string,
  _fn: (accessToken: string) => Promise<T>
): Promise<T> {
  throw new Error("not_implemented: withAccessToken lands with task T07");
}

export async function refreshExpiringTokens(_env: Env): Promise<number> {
  throw new Error("not_implemented: refreshExpiringTokens lands with task T07");
}
