/**
 * The yearline spark (BRAND-GUIDELINES §3): the user's real posts-per-day,
 * drawn as one quiet polyline. Honest numbers only (AGENTS.md §1.5).
 */
export default function Yearline({
  daily,
  year,
}: {
  daily: { date: string; count: number }[];
  year: number;
}) {
  if (daily.length < 2) return null;
  const max = daily.reduce((m, d) => Math.max(m, d.count), 1);
  const points = daily
    .map((d, i) => {
      const x = (i / (daily.length - 1)) * 100;
      const y = 38 - (d.count / max) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="yearline"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={`posting rhythm across ${year} — one bar per day`}
    >
      <line className="yearline__base" x1="0" y1="39" x2="100" y2="39" />
      <polyline className="yearline__spark" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
