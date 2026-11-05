import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck as DeckData, YearizeStatus } from "@shared/types";
import { apiFetch, formatCount, useApi } from "../lib/api";
import { useMe } from "../lib/me";
import { BRAND_NAME } from "@shared/brand";
import CardSurface, { chapterOverline } from "../components/CardSurface";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";
import ShareDialog from "../components/ShareDialog";
import ShareLinkRow from "../components/ShareLinkRow";
import StatCounter from "../components/StatCounter";
import StatusLine from "../components/StatusLine";
import Yearline from "../components/Yearline";

/** Chapter slot 6 while the alter ego is missing (spec 04 §1). */
function PersonaPlaceholder() {
  return (
    <article className="card">
      <div className="card__face card__face--ghost">
        <p className="card__overline">{chapterOverline({ n: 6, kind: "persona" })}</p>
        <div className="card__body">
          <h2 className="card__headline">naming you…</h2>
          <p className="card__caption">
            this slot waits for your alter ego. the deck is complete either way.
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

/** The deck forming: seven ghost slots on the wall while the year renders. */
function DeckSkeleton() {
  return (
    <div className="deck-skeleton" aria-hidden="true">
      {["01", "02", "03", "04", "05", "06", "07"].map((n) => (
        <div key={n} className="skel-card">
          <span className="skel-card__idx">{n}</span>
          <div className="skel-card__lines">
            <span />
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Step 3 — the deck (T13): honest grid, backfill progress, share links. */
export default function Deck() {
  const { state } = useMe();
  const navigate = useNavigate();
  // year = undefined → the API picks the most recent year that has posts;
  // the picker overrides it once the user chooses a specific year
  const [year, setYear] = useState<number | undefined>(undefined);
  const deckUrl = year === undefined ? "/api/deck" : `/api/deck?year=${year}`;
  const deck = useApi<DeckData>(deckUrl);
  const reload = deck.reload;

  useEffect(() => {
    document.title = `${BRAND_NAME} — your deck`;
  }, []);

  const [status, setStatus] = useState<YearizeStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shareCard, setShareCard] = useState<number | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openShare = useCallback((n: number, trigger: HTMLButtonElement) => {
    shareTriggerRef.current = trigger;
    setShareCard(n);
  }, []);

  // the dialog closes → focus returns to the trigger that opened it (modal law)
  const closeShare = useCallback(() => {
    setShareCard(null);
    shareTriggerRef.current?.focus();
    shareTriggerRef.current = null;
  }, []);

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

  // manual sync: fire the yearize run, then keep polling status; the deck
  // refetches when the backfill flips to done (existing effect above)
  const syncNow = useCallback(async () => {
    try {
      await apiFetch("/api/yearize/run", { method: "POST" });
      showNote("sync started: reading your buffer history");
    } catch {
      showNote("sync could not start: try again in a minute");
      return;
    }
    setStatus((prev) => (prev ? { ...prev, backfillDone: false } : { backfillDone: false, lastPolledAt: 0, postsIndexed: 0 }));
  }, []);

  let body: ReactNode;
  if (backfilling) {
    body = (
      <>
        <Loading
          label="reading your year…"
          counter={
            <>
              <StatCounter value={status.postsIndexed} /> posts indexed
            </>
          }
          hint="we page through 12 months of buffer history; the deck opens the moment it’s done."
        />
        <DeckSkeleton />
      </>
    );
  } else if (deck.loading) {
    body = (
      <>
        <Loading label="laying out your deck…" />
        <DeckSkeleton />
      </>
    );
  } else if (deck.error) {
    // anon visitors are mid-redirect to "/" — don't flash an error panel at them
    body = state.status === "anon" ? null : <ErrorState error={deck.error} onRetry={reload} />;
  } else if (deck.data?.empty) {
    body = (
      <EmptyState
        title="nothing to draw yet"
        body="your buffer is connected, but no sent posts have landed in the whole history we read. everything you send through buffer counts automatically from now on. just connected? run a sync to be sure nothing was missed."
        action={
          <>
            <button type="button" className="btn btn--primary" onClick={() => void syncNow()}>
              sync my buffer now
            </button>
            <Link className="btn btn--ghost" to="/">
              back to the start
            </Link>
          </>
        }
      />
    );
  } else if (deck.data) {
    body = (
      <>
        <StatusLine message={note} />
        <div className="deck-grid">
          {deck.data.cards.map((card) => (
            <CardSurface key={card.n} card={card} onNote={showNote} onShare={openShare} />
          ))}
          {!deck.data.persona && <PersonaPlaceholder />}
        </div>
        <ShareLinkRow />
        <div className="deck-foot">
          <Link className="linkbtn" to="/app/greatest-hits">
            greatest hits: your real top posts, opt-in
          </Link>
          <span className="deck-foot__mono">{deck.data.stats.year}</span>
        </div>
      </>
    );
  }

  return (
    <div className="route">
      <header className="deck-head">
        <p className="overline">step 03 · the deck</p>
        <div className="deck-head__row">
          <div>
            <h1 className="headline headline--lg">
              {deck.data && !deck.data.empty ? `${deck.data.year}, drawn` : "your deck"}
            </h1>
            <p className="sub">
              every number here comes from your real posts. share the deck as images, or queue one
              recap to every channel in a click.
            </p>
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
        {deck.data && (deck.data.years?.length ?? 0) > 1 && (
          <nav className="year-picker" aria-label="deck year">
            {deck.data.years?.map((y) => (
              <button
                key={y}
                type="button"
                className={y === deck.data?.year ? "year-picker__btn is-active" : "year-picker__btn"}
                aria-current={y === deck.data?.year ? "true" : undefined}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </nav>
        )}
        {deck.data && !deck.data.empty && (
          <div className="yearline-wrap">
            <div className="yearline-head">
              <p className="yearline-title">the year, daily</p>
              <dl className="yearline-ledger">
                <div>
                  <dt>posts</dt>
                  <dd>
                    <StatCounter value={deck.data.stats.totals.posts} />
                  </dd>
                </div>
                <div>
                  <dt>words</dt>
                  <dd>{formatCount(deck.data.stats.totals.words)}</dd>
                </div>
                <div>
                  <dt>active days</dt>
                  <dd>{formatCount(deck.data.stats.totals.activeDays)}</dd>
                </div>
                <div>
                  <dt>channels</dt>
                  <dd>{deck.data.stats.totals.channels}</dd>
                </div>
              </dl>
            </div>
            <Yearline daily={deck.data.stats.daily} year={deck.data.stats.year} />
            <p className="yearline-caption">
              drawn from every timestamp of the year, hours are utc (your channels are global)
            </p>
          </div>
        )}
      </header>
      {body}
      {shareCard !== null && <ShareDialog cardN={shareCard} onClose={closeShare} />}
    </div>
  );
}
