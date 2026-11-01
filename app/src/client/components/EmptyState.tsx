import { useId, type ReactNode } from "react";

/** Decorative fanned-cards glyph with a gradient stroke (the deck motif). */
function DeckGlyph() {
  const rawId = useId();
  const gradId = `g${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" focusable="false">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="state-grad-a" />
          <stop offset="100%" className="state-grad-b" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradId})`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
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
