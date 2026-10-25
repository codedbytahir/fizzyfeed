import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { GreatestHit } from "@shared/types";
import { apiFetch, postJson, toFailure, useApi } from "../lib/api";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";
import HitList from "../components/HitList";
import StatusLine from "../components/StatusLine";
import { Button } from "../components/Button";

/** {enabled, since} | {enabled:false} — PAT is never returned to the client (spec 07 §3). */
type GhStatus = { enabled: true; since: number } | { enabled: false };

const TOKEN_PAGE = "https://buffer.com/app/settings/developers";

function isGone(f: { code: string }): boolean {
  return f.code.includes("410") || f.code.includes("gone") || f.code.includes("expired");
}

function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Optional chapter (spec 07 §2): absent is a fine state; deck is complete without it. */
export default function GreatestHits() {
  const status = useApi<GhStatus>("/api/greatest-hits/status");

  const [token, setToken] = useState("");
  const [enableBusy, setEnableBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [hits, setHits] = useState<GreatestHit[] | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (hits === null) return;
    setRevealed(false);
    const t = window.setTimeout(() => setRevealed(true), 30);
    return () => window.clearTimeout(t);
  }, [hits]);

  const refresh = async () => {
    setRefreshBusy(true);
    setNote(null);
    try {
      const res = await postJson<{ top: GreatestHit[] }>("/api/greatest-hits/refresh", {});
      setHits(res.top);
    } catch (err: unknown) {
      const f = toFailure(err);
      if (isGone(f)) {
        setHits(null);
        setNote("your token expired — enable it again anytime.");
        status.reload();
      } else {
        setNote(f.message);
      }
    } finally {
      setRefreshBusy(false);
    }
  };

  const enable = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setEnableError("paste a token first — buffer's developer settings has them.");
      return;
    }
    setEnableBusy(true);
    setEnableError(null);
    try {
      await postJson<void>("/api/greatest-hits/enable", { token: trimmed });
      setToken("");
      setNote("token active — pulling your top posts.");
      status.reload();
      await refresh();
    } catch (err: unknown) {
      setEnableError(toFailure(err).message);
    } finally {
      setEnableBusy(false);
    }
  };

  const revoke = async () => {
    setRevokeBusy(true);
    try {
      await apiFetch<void>("/api/greatest-hits/revoke", { method: "POST" });
      setHits(null);
      setNote("token revoked — your deck carries on without it.");
      status.reload();
    } catch {
      setNote("revoke didn't confirm — try once more.");
    } finally {
      setRevokeBusy(false);
    }
  };

  if (status.loading) {
    return (
      <div className="route route--narrow">
        <Loading label="checking the optional chapter…" />
      </div>
    );
  }
  if (status.error) {
    return (
      <div className="route route--narrow">
        <ErrorState error={status.error} onRetry={status.reload} />
        <p>
          <Link className="linkbtn" to="/app">
            ← your deck
          </Link>
        </p>
      </div>
    );
  }

  const enabled = status.data?.enabled === true ? status.data : null;

  return (
    <div className="route route--narrow">
      <header className="deck-head">
        <p className="overline">optional chapter</p>
        <h1 className="headline headline--lg">greatest hits</h1>
        {enabled ? (
          <p className="sub">
            token active since {formatDate(enabled.since)} — used only to read metrics, encrypted,
            one-click revoke. labels are exactly what buffer calls them.
          </p>
        ) : (
          <p className="sub">
            want your real top posts? paste a buffer personal access token — used only to read
            metrics, encrypted, one-click revoke.
          </p>
        )}
      </header>

      <StatusLine message={note} />

      {enabled ? (
        <>
          <div className="deck-actions">
            <Button onClick={() => void refresh()} disabled={refreshBusy || revokeBusy}>
              {refreshBusy ? "pulling…" : hits ? "refresh top posts" : "pull top posts"}
            </Button>
            <Button variant="quiet" onClick={() => void revoke()} disabled={revokeBusy || refreshBusy}>
              {revokeBusy ? "revoking…" : "revoke"}
            </Button>
          </div>
          {hits === null && (
            <p className="sub">no pull yet — one click and your nine best posts line up.</p>
          )}
          {hits && (
            <div className={revealed ? "reveal-in is-in" : "reveal-in"}>
              <HitList hits={hits} />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="sub">
            optional — your deck is complete without this chapter. it's here for the curious.
          </p>
          <form className="gh-form" onSubmit={(e) => void enable(e)}>
            <input
              type="password"
              className="input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="buffer personal access token"
              placeholder="paste your token — it stays server-side"
              autoComplete="off"
            />
            <Button type="submit" disabled={enableBusy}>
              {enableBusy ? "checking…" : "enable"}
            </Button>
          </form>
          {enableError && (
            <p className="inline-note" role="alert">
              {enableError}
            </p>
          )}
          <p className="charcount-hint">
            grab a token from{" "}
            <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">
              buffer's developer settings
            </a>
            . it never leaves the server unencrypted.
          </p>
        </>
      )}

      <p>
        <Link className="linkbtn" to="/app">
          ← your deck
        </Link>
      </p>
    </div>
  );
}
