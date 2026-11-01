import type { ReactNode } from "react";

/**
 * Progress moment (T13 deck spec): three "fizz" dots in brand colors, a thin
 * brand-gradient bar, skeleton lines while lists compose, plus a counting
 * number — premium and quiet, no spinner slop. Decorative layers are
 * aria-hidden; the label + counter stay the live region content.
 */
export default function Loading({
  label,
  counter,
  hint,
}: {
  label: string;
  counter?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__fizz" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="loading__label">{label}</p>
      <div className="loading__skel" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="loading__bar" aria-hidden="true">
        <span />
      </div>
      {counter != null && <p className="loading__counter">{counter}</p>}
      {hint && <p className="loading__hint">{hint}</p>}
    </div>
  );
}
