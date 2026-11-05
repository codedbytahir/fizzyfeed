import { useEffect, useRef } from "react";
import type { CardData } from "@shared/types";
import "../lib/halftone.js";

/**
 * The chapter image, printed as a halftone dot field — the landing's
 * deck-fan art hung on each dashboard card (same engine, same image, same
 * gradient pairs). Colors resolve from the sheet tokens at mount so client
 * drift from tokens.css is impossible (AGENTS.md §1.3); the engine's
 * app-patched parser accepts any CSS color.
 */
const PLATES: Record<CardData["kind"], { src: string; sheet: string }> = {
  kickoff: { src: "/img/chapters/ch-01-kickoff.webp", sheet: "--sheet-pear" },
  rhythm: { src: "/img/chapters/ch-02-rhythm.webp", sheet: "--sheet-sugar" },
  streaks: { src: "/img/chapters/ch-03-streaks.webp", sheet: "--sheet-mint" },
  mix: { src: "/img/chapters/ch-04-the-mix.webp", sheet: "--sheet-sand" },
  peaks: { src: "/img/chapters/ch-05-peaks.webp", sheet: "--sheet-blue" },
  persona: { src: "/img/chapters/ch-06-alter-ego.webp", sheet: "--sheet-kraft" },
  recap: { src: "/img/chapters/ch-07-the-recap.webp", sheet: "--sheet-coral" },
};

/** Resolve a custom property (possibly a var() chain) to a real CSS color. */
function tokenColor(name: string): string {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

/** One halftone plate: paper stock, registration marks in accent-deep. */
export default function HalftoneArt({ kind }: { kind: CardData["kind"] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const dots = typeof window !== "undefined" ? window.HalftoneDots : undefined;
    if (!box || !dots) return;
    const plate = PLATES[kind];
    const dispose = dots.attach(box, {
      src: plate.src,
      gradient: [tokenColor(plate.sheet), tokenColor("--color-ink")],
      accent: tokenColor("--color-accent-deep"),
    });
    return () => dispose();
  }, [kind]);

  return <div ref={boxRef} className="card__art" aria-hidden="true" />;
}
