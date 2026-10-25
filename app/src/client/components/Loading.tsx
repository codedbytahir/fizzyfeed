import type { ReactNode } from "react";

/**
 * Progress moment (T13 deck spec): a thin brand-gradient bar plus a counting
 * number — premium and quiet, no spinner slop.
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
      <div className="loading__bar" aria-hidden="true">
        <span />
      </div>
      <p className="loading__label">{label}</p>
      {counter != null && <p className="loading__counter">{counter}</p>}
      {hint && <p className="loading__hint">{hint}</p>}
    </div>
  );
}
