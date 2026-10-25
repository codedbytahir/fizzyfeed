import type { ReactNode } from "react";

/** Small pill label (BRAND-GUIDELINES §5: sentence case, hairline border). */
export default function Chip({
  children,
  onCard = false,
  className,
}: {
  children: ReactNode;
  onCard?: boolean;
  className?: string;
}) {
  const cls = ["chip", onCard ? "chip--oncard" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <span className={cls}>{children}</span>;
}
