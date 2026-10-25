import { useCallback, useEffect, useState } from "react";

/**
 * Tiny typed fetch layer (spec 01 §5): every /api failure is
 * { error: { code, message } } — apiFetch parses it and throws a flat
 * ApiFailure so routes never touch res.ok / try-catch-json plumbing.
 */
export interface ApiFailure {
  code: string;
  message: string;
  /** present on 403 upgrade_required (recap write scope) — where to consent */
  upgradeUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toFailure(err: unknown): ApiFailure {
  if (isRecord(err) && typeof err.code === "string" && typeof err.message === "string") {
    const failure: ApiFailure = { code: err.code, message: err.message };
    if (typeof err.upgradeUrl === "string") failure.upgradeUrl = err.upgradeUrl;
    return failure;
  }
  return { code: "unknown", message: "something went wrong — try again." };
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw toFailure(undefined);
  }
  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const payload = isRecord(body) && isRecord(body.error) ? body.error : null;
    const failure: ApiFailure = {
      code: typeof payload?.code === "string" ? payload.code : `http_${res.status}`,
      message:
        typeof payload?.message === "string"
          ? payload.message
          : "request failed — something went wrong on the way to the server.",
    };
    if (payload && typeof payload.upgradeUrl === "string") failure.upgradeUrl = payload.upgradeUrl;
    throw failure;
  }
  return body as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** client-generated idempotency key (spec 06 §3) */
export function newQueueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── useApi: get-once hook with manual reload ────────────────────────────────

export interface ApiState<T> {
  data: T | null;
  error: ApiFailure | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(url: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch<T>(url)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(toFailure(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

const GROUPED = new Intl.NumberFormat("en-US");
export function formatCount(n: number): string {
  return GROUPED.format(n);
}
