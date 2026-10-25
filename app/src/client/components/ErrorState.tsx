import type { ReactNode } from "react";
import type { ApiFailure } from "../lib/api";
import { Button } from "./Button";

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
