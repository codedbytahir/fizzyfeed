import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Deck as DeckData, Persona as PersonaData } from "@shared/types";
import { apiFetch, formatCount, toFailure, useApi } from "../lib/api";
import { BRAND_NAME } from "@shared/brand";
import Chip from "../components/Chip";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";

const MAX_REGENERATIONS = 3;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/** The real figures behind the name, from the same YearStats the model reads. */
function Evidence({ deck }: { deck: DeckData }) {
  const { stats } = deck;
  const hour = String(stats.rhythm.favoriteHour).padStart(2, "0");
  return (
    <aside className="evidence">
      <p className="evidence__title">the evidence</p>
      <dl className="evidence__list">
        <div>
          <dt>longest streak</dt>
          <dd>
            {formatCount(stats.streaks.longest)} <small>days</small>
          </dd>
        </div>
        <div>
          <dt>posts a week</dt>
          <dd>{formatCount(stats.rhythm.postsPerWeek)}</dd>
        </div>
        <div>
          <dt>favorite hour</dt>
          <dd>
            {hour}:00 <small>utc</small>
          </dd>
        </div>
        <div>
          <dt>best month</dt>
          <dd>
            {formatCount(stats.peaks.bestMonthPosts)} <small>in {MONTHS[stats.peaks.bestMonth]}</small>
          </dd>
        </div>
      </dl>
      <p className="evidence__note">
        the real numbers the model read. nothing invented, nothing inflated.
      </p>
    </aside>
  );
}

/** Step 4 — the alter ego (spec 05 §4): cached first name, ≤3 regenerations. */
export default function Persona() {
  const deck = useApi<DeckData>("/api/deck");

  useEffect(() => {
    document.title = `${BRAND_NAME} — your alter ego`;
  }, []);

  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [left, setLeft] = useState(MAX_REGENERATIONS);
  const [exhausted, setExhausted] = useState(false);

  // adopt an existing persona from the deck
  useEffect(() => {
    const existing = deck.data?.persona;
    if (existing) setPersona(existing);
  }, [deck.data]);

  const generate = async (regen: boolean) => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiFetch<{ persona: PersonaData }>(
        regen ? "/api/persona/regenerate" : "/api/persona",
        { method: "POST" }
      );
      setPersona(res.persona);
      if (regen) setLeft((n) => Math.max(0, n - 1));
    } catch (err: unknown) {
      const f = toFailure(err);
      setFailure(f.message);
      if (f.code === "http_429" || f.code === "rate_limited" || f.code === "rate_limited_wait") {
        setExhausted(true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (deck.error && !persona) {
    return (
      <div className="route">
        <ErrorState error={deck.error} onRetry={deck.reload} />
        <Link className="linkbtn" to="/app">
          ← your deck
        </Link>
      </div>
    );
  }

  if (deck.data?.empty && !persona) {
    return (
      <div className="route">
        <EmptyState
          title="not enough year yet"
          body="the alter ego names itself from a real year of posts — come back once your deck opens."
          action={
            <Link className="btn btn--ghost" to="/app">
              ← your deck
            </Link>
          }
        />
      </div>
    );
  }

  if (deck.loading && !persona) {
    return (
      <div className="route">
        <Loading label="reading your year…" />
      </div>
    );
  }

  return (
    <div className="route route--spread">
      <header className="deck-head">
        <p className="overline">step 04 · the alter ego</p>
        <h1 className="headline headline--lg">your alter ego</h1>
        <p className="sub">
          the model reads your real stats (rhythm, streaks, topics) and names the poster behind
          them. no flattery, just a mirror.
        </p>
      </header>

      {persona ? (
        <div className="persona-spread">
          <section className="persona-stage">
            <span className="persona-stage__marks" aria-hidden="true">
              <span />
            </span>
            {/* key remounts the cover per persona so @starting-style replays */}
            <p className="persona-name" key={persona.name}>
              {persona.name}
            </p>
            <p className="persona-origin">{persona.origin}</p>
            <div className="traits">
              {persona.traits.map((trait) => (
                <Chip key={trait}>{trait}</Chip>
              ))}
            </div>
            <div className="persona-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void generate(true)}
                disabled={busy || exhausted || left === 0}
              >
                {busy ? "rethinking…" : "regenerate"}
              </button>
              <span className="persona-left" role="status" aria-live="polite">
                {exhausted
                  ? "no regenerations left: the name stands."
                  : `${left} of ${MAX_REGENERATIONS} regenerations left`}
              </span>
            </div>
          </section>
          {deck.data && <Evidence deck={deck.data} />}
        </div>
      ) : (
        <div className="persona-spread">
          <section className="persona-stage persona-stage--await">
            <span className="persona-stage__marks" aria-hidden="true">
              <span />
            </span>
            <h2 className="headline headline--lg">the name is waiting</h2>
            <p className="sub">
              seven chapters hang on the wall; the sixth carries a name the model will read out of
              your real rhythm. no flattery, just a mirror.
            </p>
            <div className="persona-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void generate(false)}
                disabled={busy}
              >
                {busy ? "reading your year…" : "name my year"}
              </button>
            </div>
          </section>
          {deck.data && <Evidence deck={deck.data} />}
        </div>
      )}

      {failure && (
        <p className="inline-note" role="alert">
          {failure}
        </p>
      )}

      <p>
        <Link className="linkbtn" to="/app">
          ← your deck
        </Link>
      </p>
    </div>
  );
}
