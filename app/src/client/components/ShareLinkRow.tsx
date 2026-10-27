import { useEffect, useRef, useState } from "react";
import type { ShareStatus } from "@shared/types";
import { rotateShareLink, toFailure, toggleShareLink, useApi } from "../lib/api";

/** Middle-truncate a long url so the row never overflows at narrow widths. */
function truncateMiddle(url: string, max = 46): string {
  if (url.length <= max) return url;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${url.slice(0, head)}…${url.slice(url.length - tail)}`;
}

/**
 * "public link" row under the deck: one a11y switch, the mirror url when on
 * (copy + two-step in-place rotate confirm — never window.confirm), an honest
 * helper line when off. Toggle/rotate failures surface inline and in a polite
 * live region; the switch state only changes when the server confirms.
 */
export default function ShareLinkRow() {
  const status = useApi<ShareStatus>("/api/share-link/status");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [live, setLive] = useState("");
  const [liveIsError, setLiveIsError] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const yesRef = useRef<HTMLButtonElement>(null);
  const rotateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // inline confirm takes focus so keyboard users aren't left guessing
  useEffect(() => {
    if (confirming) yesRef.current?.focus();
  }, [confirming]);

  const cancelRotate = () => {
    setConfirming(false);
    rotateRef.current?.focus();
  };

  const say = (message: string, isError = false) => {
    setLive(message);
    setLiveIsError(isError);
  };

  const toggleLink = async () => {
    const current = status.data;
    if (!current || busy) return;
    const turningOn = !current.enabled;
    setBusy(true);
    try {
      await toggleShareLink(turningOn);
      status.reload();
      setConfirming(false);
      say(turningOn ? "public link on — anyone with it can see your cards" : "public link off");
    } catch (err: unknown) {
      const failure = toFailure(err);
      say(failure.message, true);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rotateShareLink();
      status.reload();
      setConfirming(false);
      say("link rotated — the old link stops working");
    } catch (err: unknown) {
      const failure = toFailure(err);
      say(failure.message, true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const url = status.data?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      say("link copied to clipboard");
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      say("copy blocked by the browser — open the link instead", true);
    }
  };

  const enabled = status.data?.enabled ?? false;
  const url = status.data?.url ?? null;

  return (
    <section className="share-link-row" aria-labelledby="share-link-label">
      <div className="share-link-row__info">
        <p className="field-label share-link-row__label" id="share-link-label">
          public link
        </p>

        {status.loading && (
          <div className="share-link-row__bar loading__bar" aria-hidden="true">
            <span />
          </div>
        )}

        {status.error && !status.data && (
          <p className="inline-note share-link-row__note">
            {status.error.message}{" "}
            <button type="button" className="linkbtn" onClick={status.reload}>
              try again
            </button>
          </p>
        )}

        {status.data &&
          (enabled && url ? (
            <div className="share-link-row__linkline">
              <a
                className="share-link-row__url"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={url}
                aria-label={`open your public deck — ${url}`}
              >
                {truncateMiddle(url)}
              </a>
              <button type="button" className="linkbtn" onClick={() => void copy()}>
                {copied ? "copied" : "copy link"}
              </button>
              {confirming ? (
                <span className="share-link-row__confirm" onKeyDown={(e) => e.key === "Escape" && cancelRotate()}>
                  <span className="share-link-row__q">rotate link?</span>
                  <button ref={yesRef} type="button" className="linkbtn" onClick={() => void rotate()}>
                    yes, rotate
                  </button>
                  <button type="button" className="linkbtn" onClick={cancelRotate}>
                    keep
                  </button>
                </span>
              ) : (
                <button
                  ref={rotateRef}
                  type="button"
                  className="linkbtn"
                  aria-label="rotate link — the old link stops working"
                  onClick={() => setConfirming(true)}
                >
                  rotate link
                </button>
              )}
            </div>
          ) : (
            <p className="share-link-row__hint">
              anyone with the link can see your year — no post text, just the cards.
            </p>
          ))}
      </div>

      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="share-link-label"
        disabled={busy || status.loading || !status.data}
        onClick={() => void toggleLink()}
      >
        <span className="switch__knob" aria-hidden="true" />
      </button>

      <p
        className={liveIsError ? "share-link-row__status share-link-row__status--err" : "share-link-row__status"}
        role="status"
        aria-live="polite"
      >
        {live}
      </p>
    </section>
  );
}
