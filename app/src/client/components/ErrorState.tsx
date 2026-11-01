import { useId, type ReactNode } from "react";
import type { ApiFailure } from "../lib/api";
import { Button } from "./Button";

/** Decorative bolt-in-orbit glyph with a gradient stroke (the spark, stalled). */
function BoltGlyph() {
  const rawId = useId();
  const gradId = `g${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="state-grad-a" />
          <stop offset="100%" className="state-grad-b" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradId})`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="24" cy="24" r="17" opacity="0.55" />
        <path d="M26.5 14.5 17.5 28h6l-2.5 11 9.5-14.5h-6z" />
      </g>
    </svg>
  );
}

/**
 * Every fetch error lands here (T13 shell contract): message from the API,
 * one "try again" action, never alert()/confirm().
 */
export default function ErrorState({
  error,
  onRetry,
  title = "that didn't load",
  children,
}: {
  error: ApiFailure | string;
  onRetry?: () => void;
  title?: string;
  children?: ReactNode;
}) {
  const message = typeof error === "string" ? error : error.message;
  const code = typeof error === "string" ? null : error.code;
  return (
    <section className="state-panel" role="alert">
      <span className="state-panel__icon" aria-hidden="true">
        <BoltGlyph />
      </span>
      {code && <p className="overline">{code.replace(/_/g, " ")}</p>}
      <h2 className="headline headline--sm">{title}</h2>
      <p className="sub">{message}</p>
      {onRetry && (
        <div className="state-panel__action">
          <Button variant="ghost" onClick={onRetry}>
            try again
          </Button>
        </div>
      )}
      {children}
    </section>
  );
}
