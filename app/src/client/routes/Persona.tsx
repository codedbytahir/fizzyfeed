import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Deck as DeckData, Persona as PersonaData } from "@shared/types";
import { apiFetch, toFailure, useApi } from "../lib/api";
import Chip from "../components/Chip";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Loading from "../components/Loading";

const MAX_REGENERATIONS = 3;

/** Step 4 — the alter ego (spec 05 §4): cached first name, ≤3 regenerations. */
export default function Persona() {
  const deck = useApi<DeckData>("/api/deck");
  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [left, setLeft] = useState(MAX_REGENERATIONS);
  const [exhausted, setExhausted] = useState(false);

  // adopt an existing persona from the deck, then reveal gently
  useEffect(() => {
    const existing = deck.data?.persona;
    if (existing) setPersona(existing);
  }, [deck.data]);

  useEffect(() => {
    if (!persona) return;
    setRevealed(false);
    const t = window.setTimeout(() => setRevealed(true), 30);
    return () => window.clearTimeout(t);
  }, [persona]);

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
    <div className="route route--narrow">
      <header className="deck-head">
        <p className="overline">step 04 — the alter ego</p>
        <p className="sub">
          the model reads your real stats — rhythm, streaks, topics — and names the poster behind
          them. no flattery, just a mirror.
        </p>
      </header>

      {persona ? (
        <div className={revealed ? "persona-stage reveal-in is-in" : "persona-stage reveal-in"}>
          <h1 className="persona-name">{persona.name}</h1>
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
                ? "no regenerations left — the name stands."
                : `${left} of ${MAX_REGENERATIONS} regenerations left`}
            </span>
          </div>
        </div>
      ) : (
        <div className="persona-stage">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void generate(false)}
            disabled={busy}
          >
            {busy ? "reading your year…" : "name my year"}
          </button>
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
