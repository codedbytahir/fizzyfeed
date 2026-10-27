import { useEffect, useRef, useState } from "react";
import type { RecapChannelResult, SharePreview } from "@shared/types";
import { newQueueId, queueShareCard, toFailure, useApi, type ApiFailure } from "../lib/api";
import ChannelPicker from "./ChannelPicker";
import { pad2 } from "./CardSurface";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import Loading from "./Loading";
import RecapResults from "./RecapResults";

const LIMIT = 500;

function withReturnTo(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}returnTo=/app`;
}

/**
 * Modal share flow for one deck card: the card PNG plus a preview-composed
 * draft you can edit, pick channels for, and queue with explicit consent.
 * Focus moves into the dialog on open, Tab is trapped inside, and Escape /
 * overlay click close it — the caller (routes/Deck.tsx) keeps the trigger
 * ref and restores focus on close.
 */
export default function ShareDialog({ cardN, onClose }: { cardN: number; onClose: () => void }) {
  const preview = useApi<SharePreview>(`/api/share/preview?card=${cardN}`);
  const panelRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<RecapChannelResult[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const hydratedRef = useRef(false);

  // focus lands on the panel itself; the keydown trap keeps Tab inside
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // lock background scroll while the modal is open (critic r1 minor)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // hydrate once from the server-composed draft; edits then live in state only
  useEffect(() => {
    if (preview.data && !hydratedRef.current) {
      hydratedRef.current = true;
      setText(preview.data.text.slice(0, LIMIT));
      setChecked(new Set(preview.data.channels.map((c) => c.id)));
    }
  }, [preview.data]);

  const order = new Map((preview.data?.channels ?? []).map((c, i) => [c.id, i] as const));
  const merge = (next: RecapChannelResult[]): RecapChannelResult[] => {
    const map = new Map((results ?? []).map((r) => [r.channelId, r] as const));
    for (const r of next) map.set(r.channelId, r);
    return [...map.values()].sort(
      (a, b) => (order.get(a.channelId) ?? 99) - (order.get(b.channelId) ?? 99)
    );
  };

  // every submit is a distinct intent, so it mints a fresh idempotency key:
  // a retry after partial failure targets ONLY the failed channels (no
  // double-post by construction), and the fresh key still guards network-level
  // retries of this exact attempt — reusing the old key would replay the
  // stored failure for 24h instead of retrying (critic r1, major-2).
  const submit = async (channelIds: string[]) => {
    if (text === null || channelIds.length === 0 || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const res = await queueShareCard({
        card: cardN,
        text,
        channelIds,
        consent,
        queueId: newQueueId(),
      });
      setResults(merge(res.results));
    } catch (err: unknown) {
      setFailure(toFailure(err));
    } finally {
      setPending(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const data = preview.data;
  const ready = data !== null && text !== null;
  const channels = data?.channels ?? [];
  const needsUpgrade = (data?.needsWriteScope ?? false) || failure?.code === "upgrade_required";
  const upgradeHref = withReturnTo(failure?.upgradeUrl ?? "/api/auth/buffer/upgrade");
  const allQueued = results !== null && results.every((r) => r.ok);
  const textLen = text?.length ?? 0;

  return (
    <div
      className="share-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`share card ${pad2(cardN)}`}
        aria-describedby="share-dialog-desc"
        tabIndex={-1}
      >
        <p id="share-dialog-desc" className="sr-only">
          edit the card text, choose channels, then queue the card with your consent
        </p>
        <div className="share-dialog__head">
          <p className="overline">share a card</p>
          <button type="button" className="linkbtn" onClick={onClose}>
            close
          </button>
        </div>

        <img
          className="share-dialog__img"
          src={`/api/cards/${cardN}.png`}
          alt={`card ${pad2(cardN)} preview`}
          width={1080}
          height={1350}
        />

        {preview.loading && <Loading label="composing your card…" />}

        {preview.error && !preview.data && (
          <ErrorState error={preview.error} onRetry={preview.reload} />
        )}

        {ready && data && (
          <>
            {channels.length === 0 ? (
              <EmptyState
                title="no channels connected"
                body="this card queues everywhere you publish — connect a channel on buffer first."
              />
            ) : (
              <>
                <label className="field-label" htmlFor="share-text">
                  card text
                </label>
                <textarea
                  id="share-text"
                  className="textarea textarea--dialog"
                  value={text ?? ""}
                  maxLength={LIMIT}
                  rows={5}
                  aria-label="card text"
                  aria-describedby="share-charcount"
                  onChange={(e) => setText(e.target.value.slice(0, LIMIT))}
                />
                <div className="charcount-row">
                  <span
                    id="share-charcount"
                    className={textLen > LIMIT - 20 ? "charcount charcount--warn" : "charcount"}
                  >
                    {textLen} / {LIMIT}
                  </span>
                </div>

                <ChannelPicker channels={channels} checked={checked} onChange={toggle} />

                <label className="channel share-dialog__consent">
                  <input
                    type="checkbox"
                    className="channel__input"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span className="channel__box" aria-hidden="true" />
                  <span className="channel__name">queue this card to my channels</span>
                </label>

                {needsUpgrade && (
                  <div className="notice">
                    <p>
                      this needs write access — you'll approve it on buffer's screen. your edited
                      text is kept right here, nothing is lost.
                    </p>
                  </div>
                )}
                {failure && failure.code !== "upgrade_required" && (
                  <p className="inline-note" role="alert">
                    {failure.message}
                  </p>
                )}

                <div className="recap-actions share-dialog__actions">
                  {needsUpgrade ? (
                    <a className="btn btn--primary" href={upgradeHref}>
                      upgrade on buffer
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={
                        pending || !consent || checked.size === 0 || textLen === 0 || textLen > LIMIT
                      }
                      onClick={() => void submit([...checked])}
                    >
                      {pending ? "queuing…" : "queue card"}
                    </button>
                  )}
                  <span className="recap-consent">
                    the box above is the consent — this click sends it.
                  </span>
                </div>

                {results && (
                  <div className="recap-done">
                    {allQueued && (
                      <h2 className="headline headline--sm">queued — check your buffer dashboard.</h2>
                    )}
                    <RecapResults
                      results={results}
                      channels={channels}
                      busy={pending}
                      onRetry={(id) => void submit([id])}
                    />
                    <a
                      className="linkbtn"
                      href="https://buffer.com/app"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      open buffer dashboard
                    </a>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
