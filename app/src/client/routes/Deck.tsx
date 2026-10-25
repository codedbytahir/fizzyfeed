import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck as DeckData, YearizeStatus } from "@shared/types";
import { apiFetch, formatCount, useApi } from "../lib/api";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";
import CardSurface from "../components/CardSurface";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";
import StatCounter from "../components/StatCounter";
import StatusLine from "../components/StatusLine";
import Yearline from "../components/Yearline";

/** Chapter slot 6 while the alter ego is missing (spec 04 §1). */
function PersonaPlaceholder() {
  return (
    <article className="card">
      <div className="card__face card__face--ghost">
        <p className="card__overline">chapter 06 — alter ego</p>
        <div className="card__body">
          <h3 className="card__headline">naming you…</h3>
          <p className="card__caption">
            this slot waits for your alter ego — the deck is complete either way.
          </p>
          <Link className="linkbtn" to="/app/persona">
            name my alter ego
          </Link>
        </div>
        <footer className="card__footer">
          <span className="card__dot card__dot--ghost" aria-hidden="true" />
          <span className="card__brand card__brand--ghost">{BRAND_NAME}</span>
        </footer>
      </div>
    </article>
  );
}

/** Step 3 — the deck (T13): honest grid, backfill progress, share links. */
export default function Deck() {
  const { state } = useMe();
  const navigate = useNavigate();
  const deck = useApi<DeckData>("/api/deck");
  const reload = deck.reload;

  const [status, setStatus] = useState<YearizeStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  // 401 → back to the connect screen
  useEffect(() => {
    if (state.status === "anon") navigate("/", { replace: true });
  }, [state, navigate]);

  // poll yearize status every 3s until the 12-month backfill completes
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await apiFetch<YearizeStatus>("/api/yearize/status");
        if (!alive) return;
        setStatus(next);
        if (next.backfillDone) return; // indexing finished — stop polling
      } catch {
        // status is auxiliary; the deck response decides what renders
      }
      if (alive) timer = window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // refetch the deck once the backfill flips to done
  useEffect(() => {
    if (status?.backfillDone) reload();
  }, [status?.backfillDone, reload]);

  const showNote = (message: string) => {
    setNote(message);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 2600);
  };
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const backfilling = status !== null && !status.backfillDone;

  let body: ReactNode;
  if (backfilling) {
    body = (
      <Loading
        label="reading your year…"
        counter={
          <>
            <StatCounter value={status.postsIndexed} /> posts indexed
          </>
        }
        hint="we page through 12 months of buffer history — the deck opens the moment it's done."
      />
    );
  } else if (deck.loading) {
    body = <Loading label="laying out your deck…" />;
  } else if (deck.error) {
    // anon visitors are mid-redirect to "/" — don't flash an error panel at them
    body = state.status === "anon" ? null : <ErrorState error={deck.error} onRetry={reload} />;
  } else if (deck.data?.empty) {
    body = (
      <EmptyState
        title="not enough year yet"
        body="connect your buffer and post a little more — your deck opens up as the year fills in."
        action={
          <Link className="btn btn--ghost" to="/">
            back to the start
          </Link>
        }
      />
    );
  } else if (deck.data) {
    body = (
      <>
        <StatusLine message={note} />
        <div className="deck-grid">
          {deck.data.cards.map((card) => (
            <CardSurface key={card.n} card={card} onNote={showNote} />
          ))}
          {!deck.data.persona && <PersonaPlaceholder />}
        </div>
        <div className="deck-foot">
          <Link className="linkbtn" to="/app/greatest-hits">
            greatest hits — your real top posts, opt-in
          </Link>
          <span className="deck-foot__mono">
            {formatCount(deck.data.stats.totals.posts)} posts · {deck.data.stats.year}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="route">
      <header className="deck-head">
        <p className="overline">step 03 — the deck</p>
        <div className="deck-head__row">
          <div>
            <h1 className="headline headline--lg">
              {deck.data && !deck.data.empty ? `${deck.data.year}, drawn` : "your deck"}
            </h1>
            <p className="sub">no fake numbers — every card comes from your posts.</p>
          </div>
          <div className="deck-actions">
            <Link className="btn btn--ghost" to="/app/persona">
              name my alter ego
            </Link>
            <Link className="btn btn--primary" to="/app/recap">
              queue the recap
            </Link>
          </div>
        </div>
        {deck.data && !deck.data.empty && (
          <div className="yearline-wrap">
            <Yearline daily={deck.data.stats.daily} year={deck.data.stats.year} />
            <p className="yearline-caption">
              {formatCount(deck.data.stats.totals.activeDays)} active days · every one real
            </p>
          </div>
        )}
      </header>
      {body}
    </div>
  );
}
