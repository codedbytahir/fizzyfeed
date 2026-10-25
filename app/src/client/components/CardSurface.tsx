import { useState } from "react";
import type { CardData, CardGradient } from "@shared/types";
import { BRAND_NAME } from "@shared/brand";
import CardBody from "./CardBody";

/**
 * The seven fixed card gradients (T13 mapping) — token references only,
 * never raw hex (AGENTS.md §1.3). Text stays white on every face,
 * including fizz, per brand law.
 */
const GRADIENTS = {
  bolt: "linear-gradient(135deg, var(--electric-500) 0%, var(--volt-500) 100%)",
  aurora: "linear-gradient(135deg, var(--violet-500) 0%, var(--electric-500) 100%)",
  fizz: "linear-gradient(135deg, var(--spark-500) 0%, var(--volt-500) 100%)",
  grape: "linear-gradient(135deg, var(--violet-600) 0%, var(--electric-700) 100%)",
  sunset: "linear-gradient(135deg, var(--violet-400) 0%, var(--spark-500) 100%)",
  nebula: "linear-gradient(135deg, var(--electric-700) 0%, var(--violet-500) 100%)",
  coral: "linear-gradient(135deg, var(--electric-500) 0%, var(--spark-500) 100%)",
} as const satisfies Record<CardGradient, string>;

const KIND_LABELS = {
  kickoff: "kickoff",
  rhythm: "rhythm",
  streaks: "streaks",
  mix: "the mix",
  peaks: "peaks",
  persona: "alter ego",
  recap: "the recap",
} as const satisfies Record<CardData["kind"], string>;

export function chapterOverline(card: Pick<CardData, "n" | "kind">): string {
  return `chapter ${String(card.n).padStart(2, "0")} — ${KIND_LABELS[card.kind]}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ShareRow({ n, onNote }: { n: number; onNote?: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/api/cards/${n}.png`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onNote?.(`card ${pad2(n)} link copied`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNote?.(`copy blocked by the browser — the link is ${url}`);
    }
  };
  return (
    <div className="card__actions">
      <button type="button" className="linkbtn" onClick={() => void copy()}>
        {copied ? "copied" : "copy link"}
      </button>
      <a className="linkbtn" href={`/api/cards/${n}.png`} download={`card-${pad2(n)}.png`}>
        download
      </a>
    </div>
  );
}

/** One story card: fixed gradient face + honest share row (spec 04 §3). */
export default function CardSurface({
  card,
  onNote,
}: {
  card: CardData;
  onNote?: (message: string) => void;
}) {
  return (
    <article className="card">
      <div className="card__face" style={{ background: GRADIENTS[card.gradient] }}>
        <p className="card__overline">{chapterOverline(card)}</p>
        <CardBody card={card} />
        <footer className="card__footer">
          <span className="card__dot" aria-hidden="true" />
          <span className="card__brand">{BRAND_NAME}</span>
        </footer>
      </div>
      <ShareRow n={card.n} onNote={onNote} />
    </article>
  );
}
