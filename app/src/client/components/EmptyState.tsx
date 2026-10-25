import type { ReactNode } from "react";

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
      <p className="overline" aria-hidden="true">
        nothing here yet
      </p>
      <h2 className="headline headline--sm">{title}</h2>
      <p className="sub">{body}</p>
      {action && <div className="state-panel__action">{action}</div>}
    </section>
  );
}
