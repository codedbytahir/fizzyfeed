import type { ReactNode } from "react";

/** Decorative fanned-cards glyph in plain ink (the deck motif). */
function DeckGlyph() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" focusable="false" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <rect x="11" y="9" width="14" height="20" rx="3" transform="rotate(-12 18 19)" />
        <rect x="23" y="9" width="14" height="20" rx="3" transform="rotate(12 30 19)" />
        <rect x="17" y="15" width="14" height="20" rx="3" />
        <path d="M21 30.5h6" />
      </g>
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
