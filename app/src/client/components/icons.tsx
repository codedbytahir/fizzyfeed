import type { ReactNode, SVGProps } from "react";

/**
 * The icon set: 24-grid strokes at 1.7, round caps, currentColor — the same
 * hand the buttons' arrow was drawn with. Icons are decorative; the text next
 * to them carries the meaning (aria-hidden everywhere).
 */

interface IconProps {
  size?: number;
}

function make(paths: ReactNode) {
  return function Icon({ size = 16, ...rest }: IconProps & SVGProps<SVGSVGElement>) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

/** deck — the fanned card stack, the mark's own motif */
export const IconCards = make(
  <>
    <rect x="3.6" y="7.6" width="10.4" height="13" rx="2.6" transform="rotate(-9 8.8 14.1)" />
    <rect x="10" y="5.4" width="10.4" height="13" rx="2.6" transform="rotate(9 15.2 11.9)" />
  </>,
);

/** persona — the alter-ego sparkle */
export const IconSpark = make(
  <path d="M12 3.2c.55 3.85 2.4 5.7 6.25 6.25-3.85.55-5.7 2.4-6.25 6.25-.55-3.85-2.4-5.7-6.25-6.25 3.85-.55 5.7-2.4 6.25-6.25zM18.5 15.5c.25 1.75 1.1 2.6 2.85 2.85-1.75.25-2.6 1.1-2.85 2.85-.25-1.75-1.1-2.6-2.85-2.85 1.75-.25 2.6-1.1 2.85-2.85z" />,
);

/** recap — the year loop, queued everywhere at once */
export const IconLoop = make(
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
);

/** greatest hits — the opt-in top posts */
export const IconStar = make(
  <path d="M12 3.8l2.4 5.1 5.6.65-4.15 3.8 1.12 5.55L12 16.2l-4.97 2.7 1.12-5.55-4.15-3.8 5.6-.65z" />,
);

/** queue the recap — one recap, every channel */
export const IconSend = make(
  <>
    <path d="M21.5 2.5 11 13" />
    <path d="M21.5 2.5 14.8 21.6l-3.8-8.6-8.6-3.8z" />
  </>,
);

/** sync my buffer now — full-history refresh */
export const IconSync = make(
  <>
    <path d="M3 12a9 9 0 0 1 15.2-6.5L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.2 6.5L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);

/** copy link */
export const IconCopy = make(
  <>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2.4" />
    <path d="M5.5 14.8H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.8a2 2 0 0 1 2 2v.5" />
  </>,
);

/** download the card */
export const IconDownload = make(
  <>
    <path d="M12 3.8v11.4" />
    <path d="m7.6 11 4.4 4.4L16.4 11" />
    <path d="M4.5 19.7h15" />
  </>,
);

/** connect chips — read-only */
export const IconLock = make(
  <>
    <rect x="5" y="11" width="14" height="9.2" rx="2.2" />
    <path d="M8.2 11V7.8a3.8 3.8 0 0 1 7.6 0V11" />
  </>,
);

/** connect chips — encrypted */
export const IconKey = make(
  <>
    <circle cx="7.8" cy="15.8" r="4.2" />
    <path d="M10.9 12.7 20.5 3.1" />
    <path d="M16.5 4.7l2.8 2.8" />
    <path d="M13.7 7.5l2.3 2.3" />
  </>,
);

/** connect chips — you approve */
export const IconCheck = make(<path d="M4.5 12.6l4.8 4.9L19.5 6.6" />);

/** the leave-the-app arrow (buffer oauth, share links) */
export const IconArrow = make(
  <>
    <path d="M13.2 4.8h6v6" />
    <path d="M19.2 4.8 10.6 13.4" />
    <path d="M11 4.8H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12.2a2 2 0 0 0 2-2v-5" />
  </>,
);
