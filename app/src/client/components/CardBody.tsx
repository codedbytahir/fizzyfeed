import type { CardData } from "@shared/types";
import { formatCount } from "../lib/api";

function assertNever(value: never): never {
  throw new Error(`unknown card kind: ${String(value)}`);
}

function barHeights(spark: number[]): number[] {
  const max = spark.reduce((m, v) => Math.max(m, v), 1);
  return spark.map((v) => Math.round(12 + (v / max) * 88));
}

/**
 * Per-kind card interior (spec 04 §2 anchors). Exhaustive switch over the
 * closed CardData union — a new kind fails to compile until rendered.
 */
export default function CardBody({ card }: { card: CardData }) {
  switch (card.kind) {
    case "kickoff":
      return (
        <div className="card__body">
          <h3 className="card__headline">it started here</h3>
          <p className="card__moment card__moment--md">{card.date}</p>
          <p className="card__caption">“{card.excerpt}”</p>
        </div>
      );
    case "rhythm":
      return (
        <div className="card__body">
          <h3 className="card__headline">a weekly pulse</h3>
          <div className="card__moment card__moment--bars">
            <div className="rhythm-bars" aria-hidden="true">
              {barHeights(card.spark).map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <p className="card__dataline">
              {formatCount(card.postsPerWeek)} posts a week · {card.bestDow} · {card.favoriteHour}
            </p>
          </div>
          <p className="card__caption">your rhythm, drawn from every timestamp of the year.</p>
        </div>
      );
    case "streaks":
      return (
        <div className="card__body">
          <h3 className="card__headline">the long run</h3>
          <p className="card__moment">
            {formatCount(card.longest)}
            <span className="card__moment-unit">days in a row</span>
          </p>
          <p className="card__caption">
            with a busiest week of {formatCount(card.busiestWeekPosts)} posts — momentum you can
            point at.
          </p>
        </div>
      );
    case "mix":
      return (
        <div className="card__body">
          <h3 className="card__headline">where you showed up</h3>
          <div className="card__moment card__moment--bars">
            <div className="mix-bar" aria-hidden="true">
              {card.channels.map((c, i) => (
                <span key={`${c.service}-${i}`} style={{ width: `${Math.max(2, c.pct)}%` }} />
              ))}
            </div>
            <p className="card__dataline">
              {card.channels.map((c) => `${c.service} ${formatCount(c.pct)}%`).join(" · ")}
            </p>
          </div>
          <p className="card__caption">
            {card.topTopics.length > 0
              ? `top topics: ${card.topTopics.join(" · ")}`
              : "your channels, in honest proportion."}
          </p>
        </div>
      );
    case "peaks":
      return (
        <div className="card__body">
          <h3 className="card__headline">the high point</h3>
          <p className="card__moment">
            {formatCount(card.bestMonthPosts)}
            <span className="card__moment-unit">posts in {card.bestMonth}</span>
          </p>
          <p className="card__caption">your biggest month — the year crested here.</p>
        </div>
      );
    case "persona":
      return (
        <div className="card__body">
          <h3 className="card__headline card__headline--name">{card.name}</h3>
          <p className="card__caption">{card.origin}</p>
        </div>
      );
    case "recap": {
      const rows: { label: string; value: number }[] = [
        { label: "posts", value: card.totals.posts },
        { label: "words", value: card.totals.words },
        { label: "channels", value: card.totals.channels },
        { label: "active days", value: card.totals.activeDays },
      ];
      return (
        <div className="card__body">
          <h3 className="card__headline">the year, in four numbers</h3>
          <dl className="totals-grid card__moment card__moment--grid">
            {rows.map((row) => (
              <div key={row.label} className="totals-cell">
                <dt>{row.label}</dt>
                <dd>{formatCount(row.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="card__caption">queue your recap post — one click, every channel.</p>
        </div>
      );
    }
    default:
      return assertNever(card);
  }
}
