/**
 * YearStats aggregate tests (spec 03 §3/§5): fixtures A/B/C, property test,
 * purity, and the statsHash8 fingerprint.
 */
import { describe, expect, it } from "vitest";
import {
  computeYearStats,
  daysInYear,
  statsHash8,
  STOPWORDS,
} from "../src/worker/lib/yearize";
import type { YearStats } from "../src/shared/types";
import { fixA, row, mulberry32, JAN1_2025 } from "./fixtures/a";
import { fixB } from "./fixtures/b";
import { fixC } from "./fixtures/c";

const JUL13_2025 = Date.UTC(2025, 6, 13) / 1000;

describe("computeYearStats — fixture A (141-day streak)", () => {
  const stats = computeYearStats(fixA, 2025);

  it("finds the exact 141-day streak starting Jul 13 2025", () => {
    expect(stats.streaks.longest).toBe(141);
    expect(stats.streaks.longestStart).toBe(JUL13_2025);
  });

  it("emits one daily slot per calendar day of 2025 (365)", () => {
    expect(stats.daily).toHaveLength(365);
    expect(stats.daily[0]?.date).toBe("2025-01-01");
    expect(stats.daily[364]?.date).toBe("2025-12-31");
  });

  it("daily counts sum to totals.posts and match activeDays", () => {
    const dailySum = stats.daily.reduce((sum, d) => sum + d.count, 0);
    expect(dailySum).toBe(stats.totals.posts);
    expect(stats.totals.posts).toBe(200); // 141 streak + 59 scattered
    expect(stats.totals.activeDays).toBe(200);
    expect(stats.totals.channels).toBe(2);
  });

  it("busiest 7-day window sits inside the streak", () => {
    expect(stats.streaks.busiestWeekPosts).toBe(7);
    expect(stats.peaks.bestWeekPosts).toBe(stats.streaks.busiestWeekPosts);
  });

  it("monthly buckets sum to totals.posts", () => {
    const monthlySum = stats.peaks.monthly.reduce((sum, n) => sum + n, 0);
    expect(monthlySum).toBe(stats.totals.posts);
  });

  it("rhythm histograms are length-correct and postsPerWeek is honest", () => {
    expect(stats.rhythm.dowHistogram).toHaveLength(7);
    expect(stats.rhythm.hourHistogram).toHaveLength(24);
    expect(stats.rhythm.postsPerWeek).toBe(3.8); // round(200/52*10)/10
    const dowSum = stats.rhythm.dowHistogram.reduce((a, b) => a + b, 0);
    expect(dowSum).toBe(200);
  });
});

describe("computeYearStats — fixture B (lopsided channel mix)", () => {
  const stats = computeYearStats(fixB, 2025);

  it("sorts channels by count desc", () => {
    expect(stats.mix.channels.map((c) => c.service)).toEqual([
      "twitter",
      "instagram",
      "linkedin",
    ]);
    expect(stats.mix.channels.map((c) => c.count)).toEqual([160, 30, 10]);
  });

  it("percentages use largest-remainder rounding and sum to 100", () => {
    const pcts = stats.mix.channels.map((c) => c.pct);
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.1);
    expect(pcts[0]).toBeCloseTo(80, 5);
    expect(pcts[1]).toBeCloseTo(15, 5);
    expect(pcts[2]).toBeCloseTo(5, 5);
  });

  it("topTopics are recurring non-stopword keywords, capped at 5", () => {
    expect(stats.mix.topTopics.length).toBeGreaterThan(0);
    expect(stats.mix.topTopics.length).toBeLessThanOrEqual(5);
    expect(stats.mix.topTopics).toEqual(["release", "coffee", "launch", "review", "team"]);
    for (const topic of stats.mix.topTopics) {
      expect(STOPWORDS).not.toContain(topic);
      expect(topic.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("computeYearStats — fixture C (empty account)", () => {
  const stats = computeYearStats(fixC, 2025);

  it("keeps honest zeros and null firstPost", () => {
    expect(stats.totals).toEqual({ posts: 0, words: 0, channels: 0, activeDays: 0 });
    expect(stats.firstPost).toBeNull();
    expect(stats.mix.channels).toEqual([]);
    expect(stats.mix.topTopics).toEqual([]);
    expect(stats.streaks.longest).toBe(0);
    expect(stats.streaks.busiestWeekPosts).toBe(0);
    expect(stats.peaks.bestMonthPosts).toBe(0);
  });

  it("keeps zeroed histograms and full-length daily slots", () => {
    expect(stats.rhythm.dowHistogram).toEqual(new Array(7).fill(0));
    expect(stats.rhythm.hourHistogram).toEqual(new Array(24).fill(0));
    expect(stats.peaks.monthly).toEqual(new Array(12).fill(0));
    expect(stats.daily).toHaveLength(365);
    expect(stats.daily.every((d) => d.count === 0)).toBe(true);
  });

  it("serializes without NaN or undefined", () => {
    const json = JSON.stringify(stats);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("undefined");
  });
});

describe("computeYearStats — property", () => {
  it("sum(monthly) === totals.posts and sum(daily) === totals.posts for 40 random seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed);
      const count = 1 + Math.floor(rnd() * 300);
      const posts = Array.from({ length: count }, () =>
        row({
          created_at:
            JAN1_2025 +
            Math.floor(rnd() * 365) * 86400 +
            Math.floor(rnd() * 86400),
          text: `random post about topic ${Math.floor(rnd() * 5)}`,
        })
      );
      const stats = computeYearStats(posts, 2025);
      const monthlySum = stats.peaks.monthly.reduce((a, b) => a + b, 0);
      const dailySum = stats.daily.reduce((a, d) => a + d.count, 0);
      expect(monthlySum).toBe(stats.totals.posts);
      expect(dailySum).toBe(stats.totals.posts);
      expect(stats.daily).toHaveLength(365);
    }
  });

  it("knows leap years (2024 → 366 daily slots)", () => {
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2025)).toBe(365);
    const leap = computeYearStats(
      [row({ created_at: Date.UTC(2024, 1, 29) / 1000 })],
      2024
    );
    expect(leap.daily).toHaveLength(366);
    expect(leap.daily[59]?.date).toBe("2024-02-29");
  });
});

describe("computeYearStats — purity", () => {
  it("is deterministic: identical input → identical output", () => {
    expect(JSON.stringify(computeYearStats(fixA, 2025))).toBe(
      JSON.stringify(computeYearStats(fixA, 2025))
    );
  });

  it("never mutates its input", () => {
    const before = JSON.stringify(fixA);
    computeYearStats(fixA, 2025);
    expect(JSON.stringify(fixA)).toBe(before);
  });
});

describe("statsHash8", () => {
  const stats: YearStats = computeYearStats(fixA, 2025);

  it("returns 8 lowercase hex chars, stable across calls", () => {
    const h1 = statsHash8(stats);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect(statsHash8(stats)).toBe(h1);
  });

  it("changes whenever any stat changes", () => {
    const base = statsHash8(stats);
    const totals: YearStats = {
      ...stats,
      totals: { ...stats.totals, words: stats.totals.words + 1 },
    };
    const daily: YearStats = {
      ...stats,
      daily: stats.daily.map((d, i) => (i === 0 ? { ...d, count: d.count + 1 } : d)),
    };
    const firstPost: YearStats = stats.firstPost
      ? { ...stats, firstPost: { ...stats.firstPost, at: stats.firstPost.at + 1 } }
      : stats;
    expect(statsHash8(totals)).not.toBe(base);
    expect(statsHash8(daily)).not.toBe(base);
    expect(statsHash8(firstPost)).not.toBe(base);
  });
});
