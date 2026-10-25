import type { GreatestHit } from "@shared/types";
import { formatCount } from "../lib/api";
import Chip from "./Chip";

/**
 * Top-9 list (spec 07 §2): mono rank, real excerpt, channel chip, and the
 * metric labeled EXACTLY as the API names it — never renamed, never inflated.
 */
export default function HitList({ hits }: { hits: GreatestHit[] }) {
  return (
    <div className="hit-list">
      {hits.map((hit, i) => (
        <div key={hit.postId} className="gh-row">
          <span className="gh-rank">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <p className="gh-excerpt">{hit.excerpt}</p>
            <Chip>{hit.channel}</Chip>
          </div>
          <span className="gh-metric">
            {formatCount(hit.metric.value)} {hit.metric.name}
          </span>
        </div>
      ))}
    </div>
  );
}
