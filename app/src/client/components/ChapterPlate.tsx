import type { CardData } from "@shared/types";
import { GLYPH_PLATES, WAVE_PLATE, type PlateArt } from "./chapterPlates";

/**
 * The chapter art, printed as a clean dot-matrix stamp (Task 26).
 *
 * The dots are baked offline by scripts/bake_chapter_plates.py from the same
 * chapter illustrations the landing's deck-fan prints — but quantized into a
 * denoised dot lattice so a 512px composition survives a 108-132px plate
 * (the live dither turned the recap stack into mud and printed the engine's
 * registration marks as stray bars). Colors resolve through tokens at render
 * (AGENTS.md §1.3): each plate tints from its sheet's own hue into ink.
 *
 * The wide recap sheet carries a bespoke composition — the year climbing to
 * a spark — and falls back to the chapter glyph on narrow sheets.
 */
const SHEET_TOKEN: Record<CardData["kind"], string> = {
  kickoff: "--sheet-pear",
  rhythm: "--sheet-sugar",
  streaks: "--sheet-mint",
  mix: "--sheet-sand",
  peaks: "--sheet-blue",
  persona: "--sheet-kraft",
  recap: "--sheet-coral",
};

/** "x,y;r" triples (baked, cell units) -> circles. */
function parse(plate: PlateArt): Array<[number, number, number]> {
  return plate.dots.split(";").map((dot) => {
    const [x, y, r] = dot.split(",");
    return [Number(x), Number(y), Number(r)];
  });
}

function Dots({ plate }: { plate: PlateArt }) {
  const dots = parse(plate);
  return (
    <>
      {dots.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </>
  );
}

function PlateSvg({
  kind,
  plate,
  horizontal,
  className,
}: {
  kind: CardData["kind"];
  plate: PlateArt;
  horizontal?: boolean;
  className: string;
}) {
  const gid = `plate-grad-${kind}${horizontal ? "-h" : ""}`;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${plate.w} ${plate.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gid}
          x1={horizontal ? "0" : "0"}
          y1="0"
          x2={horizontal ? "1" : "0"}
          y2={horizontal ? "0" : "1"}
        >
          <stop offset="0" style={{ stopColor: `var(${SHEET_TOKEN[kind]})` }} />
          <stop offset="1" style={{ stopColor: "var(--color-ink)" }} />
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`}>
        <Dots plate={plate} />
      </g>
    </svg>
  );
}

/** One printed chapter plate: paper stock, sheet-tinted dot stamp. */
export default function ChapterPlate({ kind }: { kind: CardData["kind"] }) {
  if (kind !== "recap") {
    return (
      <div className="card__art" aria-hidden="true">
        <PlateSvg
          kind={kind}
          plate={GLYPH_PLATES[kind]}
          className="card__art-svg"
        />
      </div>
    );
  }
  return (
    <div className="card__art card__art--wave" aria-hidden="true">
      <PlateSvg
        kind={kind}
        plate={WAVE_PLATE}
        horizontal
        className="card__art-svg card__art-svg--wave"
      />
      <PlateSvg
        kind={kind}
        plate={GLYPH_PLATES[kind]}
        className="card__art-svg card__art-svg--glyph"
      />
    </div>
  );
}
