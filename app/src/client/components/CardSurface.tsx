import { useState } from "react";
import type { CardData, CardGradient } from "@shared/types";
import { BRAND_NAME } from "@shared/brand";
import CardBody from "./CardBody";
import HalftoneArt from "./HalftoneArt";
import { IconCopy, IconDownload } from "./icons";

/**
 * One solid card-stock sheet per chapter (theme: Hum) — fills reference the
 * deck sheet tokens in tokens.css so client drift is impossible (AGENTS.md
 * §1.3). Sheets never blend: no gradient anywhere on a face. Ink text sits on
 * every sheet except the blue one (fringe/paper text, set in cards.css from
 * data-gradient). The PNG renderer mirrors the same fills in
 * worker/lib/gradients.ts.
 */
const SHEETS = {
  bolt: "var(--sheet-pear)",
  aurora: "var(--sheet-sugar)",
  fizz: "var(--sheet-mint)",
  grape: "var(--sheet-sand)",
  sunset: "var(--sheet-blue)",
  nebula: "var(--sheet-kraft)",
  coral: "var(--sheet-coral)",
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
      onNote?.(`copy blocked by the browser; the link is ${url}`);
    }
  };
  return (
    <>
      <button type="button" className="linkbtn" onClick={() => void copy()}>
        <IconCopy size={13} />
        {copied ? "copied" : "copy link"}
      </button>
      <a className="linkbtn" href={`/api/cards/${n}.png`} download={`card-${pad2(n)}.png`}>
        <IconDownload size={13} />
        download
      </a>
    </>
  );
}

/** One story card: a solid card-stock sheet + honest share row (spec 04 §3). */
export default function CardSurface({
  card,
  onNote,
  onShare,
}: {
  card: CardData;
  onNote?: (message: string) => void;
  /** present → a "share…" action joins the row and hands focus back on close */
  onShare?: (n: number, trigger: HTMLButtonElement) => void;
}) {
  return (
    <article className={card.kind === "recap" ? "card card--wide" : "card"}>
      <div
        className="card__face"
        data-gradient={card.gradient}
        style={{ background: SHEETS[card.gradient] }}
      >
        <p className="card__overline">{chapterOverline(card)}</p>
        <span className="card__index" aria-hidden="true">
          {pad2(card.n)}
        </span>
        <CardBody card={card} />
        <HalftoneArt kind={card.kind} />
        <footer className="card__footer">
          <span className="card__dot" aria-hidden="true" />
          <span className="card__brand">{BRAND_NAME}</span>
        </footer>
      </div>
      <div className="card__actions">
        {onShare && (
          <button
            type="button"
            className="linkbtn"
            aria-label={`share card ${pad2(card.n)}: ${KIND_LABELS[card.kind]}`}
            onClick={(e) => onShare(card.n, e.currentTarget)}
          >
            share…
          </button>
        )}
        <ShareRow n={card.n} onNote={onNote} />
      </div>
    </article>
  );
}
