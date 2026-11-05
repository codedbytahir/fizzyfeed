import type { ReactNode } from "react";

/** The real mark's glyph — the three fanned cards in plain ink (logo/svg/mark-glyph-light). */
function DeckGlyph() {
  return (
    <svg width="48" height="37" viewBox="6 64 500 388" fill="none" focusable="false" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="20">
        <rect transform="translate(168,258) rotate(-11)" x="-120" y="-160" width="240" height="320" rx="54" />
        <rect transform="translate(344,258) rotate(11)" x="-120" y="-160" width="240" height="320" rx="54" />
      </g>
      <rect x="136" y="98" width="240" height="320" rx="54" fill="currentColor" />
    </svg>
  );
}

/** Quiet panel for the "deck not open yet" states — never a dead end. */
export default function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="state-panel">
      <span className="state-panel__icon" aria-hidden="true">
        <DeckGlyph />
      </span>
      <h2 className="headline headline--sm">{title}</h2>
      <p className="sub">{body}</p>
      {action && <div className="state-panel__action">{action}</div>}
    </section>
  );
}
