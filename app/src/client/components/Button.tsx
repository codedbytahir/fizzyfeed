import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type Variant = "primary" | "ghost" | "quiet";

interface CommonProps {
  variant?: Variant;
  small?: boolean;
  children: ReactNode;
}

function classNameFor(variant: Variant, small: boolean | undefined, extra?: string): string {
  return ["btn", `btn--${variant}`, small ? "btn--small" : "", extra ?? ""]
    .filter(Boolean)
    .join(" ");
}

/** Semantic <button> — never a styled div. */
export function Button({
  variant = "primary",
  small,
  className,
  type = "button",
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classNameFor(variant, small, className)} {...rest}>
      {children}
    </button>
  );
}

/**
 * Anchor styled as a button. href (not router `to`): internal links should
 * use react-router's <Link className="btn btn--*">; this component is for
 * full navigations (oauth endpoints, external urls).
 */
export function ButtonLink({
  variant = "primary",
  small,
  className,
  children,
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classNameFor(variant, small, className)} {...rest}>
      {children}
    </a>
  );
}
