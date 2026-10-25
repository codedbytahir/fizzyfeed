/**
 * Rendering pipeline tests (spec 04 §2): satori + resvg-wasm → PNG.
 * Runs in node — wasm init falls back to the node_modules copy (lib/render).
 * PNGs can't be grepped, so text content is asserted through svgCard's SVG.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadFonts, hash8, type SatoriFont } from "../src/worker/lib/fonts";
import { renderCardPng, renderOgPng, svgCard } from "../src/worker/lib/render";
import { CARD_GRADIENTS } from "../src/worker/lib/gradients";
import type { CardData, CardGradient } from "../src/shared/types";
import { BRAND_NAME } from "../src/shared/brand";

const FONT_BASE = new URL("../public/fonts/", (import.meta as unknown as { url: string }).url);

/** Fake ASSETS binding that serves the staged woffs from disk. */
const fakeAssets = {
  fetch: async (req: Request): Promise<Response> => {
    try {
      // variable specifier: keeps node:fs out of the worker bundle path & tsconfig types
      const fsSpec = "node:fs";
      const { readFileSync } = (await import(/* @vite-ignore */ fsSpec)) as {
        readFileSync: (path: URL) => Uint8Array;
      };
      const file = new URL(new URL(req.url).pathname.replace(/^\/fonts\//, ""), FONT_BASE);
      const bytes = readFileSync(file);
      const body = new Uint8Array(bytes.byteLength); // plain ArrayBuffer-backed copy
      body.set(bytes);
      return new Response(body, { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  },
} as unknown as Fetcher;

const MONTHLY = [2, 1, 3, 2, 3, 2, 1, 4, 3, 5, 2, 2];

function fixtureCards(): CardData[] {
  return [
    {
      n: 1,
      kind: "kickoff",
      date: "march 14",
      excerpt: "first post of the year — hello from the deck renderer",
      gradient: "bolt",
    },
    {
      n: 2,
      kind: "rhythm",
      bestDow: "tuesday",
      favoriteHour: "11pm",
      postsPerWeek: 3.5,
      spark: [2, 5, 9, 4, 3, 6, 1],
      gradient: "aurora",
    },
    { n: 3, kind: "streaks", longest: 12, busiestWeekPosts: 9, gradient: "fizz" },
    {
      n: 4,
      kind: "mix",
      channels: [
        { service: "twitter", pct: 50 },
        { service: "instagram", pct: 30 },
        { service: "linkedin", pct: 20 },
      ],
      topTopics: ["shipping", "demos", "tea"],
      gradient: "grape",
    },
    { n: 5, kind: "peaks", bestMonth: "october", bestMonthPosts: 6, gradient: "sunset" },
    {
      n: 6,
      kind: "persona",
      name: "the midnight archivist",
      origin: "posted 9 posts in a single week and never missed a tuesday",
      gradient: "nebula",
    },
    {
      n: 7,
      kind: "recap",
      totals: { posts: 30, words: 4812, channels: 3, activeDays: 96 },
      gradient: "coral",
    },
  ];
}

const EMPTY_STATE_CARD: CardData = {
  n: 1,
  kind: "kickoff",
  date: "",
  excerpt: "not enough year yet — connect your buffer and post a little more",
  gradient: "bolt",
};

/** Assert PNG signature + IHDR big-endian width/height (bytes 16–24). */
function expectPng(png: Uint8Array, width: number, height: number): void {
  expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(view.getUint32(16)).toBe(width);
  expect(view.getUint32(20)).toBe(height);
}

describe("gradients", () => {
  it("defines all 7 fixed card gradients as two-stop pairs", () => {
    const kinds: CardGradient[] = ["bolt", "aurora", "fizz", "grape", "sunset", "nebula", "coral"];
    expect(Object.keys(CARD_GRADIENTS).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const pair = CARD_GRADIENTS[kind];
      expect(pair).toHaveLength(2);
      for (const stop of pair) {
        expect(stop).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe("hash8", () => {
  it("produces stable 8-hex fingerprints that change with input", () => {
    expect(hash8("a")).toMatch(/^[0-9a-f]{8}$/);
    expect(hash8("a")).toBe(hash8("a"));
    expect(hash8("a")).not.toBe(hash8("b"));
  });
});

describe("renderCardPng", () => {
  let fonts: SatoriFont[];

  beforeAll(async () => {
    fonts = await loadFonts(fakeAssets);
  });

  it(
    "renders all 7 card kinds at 1080x1350",
    async () => {
      for (const card of fixtureCards()) {
        const png = await renderCardPng(card, fonts, { monthly: MONTHLY });
        expectPng(png, 1080, 1350);
      }
    },
    120_000
  );

  it(
    "renders the empty-state kickoff card at 1080x1350",
    async () => {
      const png = await renderCardPng(EMPTY_STATE_CARD, fonts);
      expectPng(png, 1080, 1350);
    },
    120_000
  );

  it(
    "truncates oversized copy instead of breaking layout",
    async () => {
      const card: CardData = {
        ...EMPTY_STATE_CARD,
        excerpt: "x".repeat(400),
      };
      const png = await renderCardPng(card, fonts);
      expectPng(png, 1080, 1350);
    },
    120_000
  );

  it("embeds card copy and the BRAND_NAME wordmark in the svg", async () => {
    const svg = await svgCard(
      {
        n: 1,
        kind: "kickoff",
        date: "march 14",
        excerpt: "the midnight archivist signed the first post",
        gradient: "bolt",
      },
      fonts,
      undefined,
      { embedFont: false } // keep <text> nodes so copy is greppable (satori splits per word)
    );
    for (const word of ["midnight", "archivist", "signed", "first", "post", "march", "14"]) {
      expect(svg).toContain(word);
    }
    expect(svg).toContain(BRAND_NAME); // single word — appears verbatim
    expect(svg).toContain("chapter");
    expect(svg).toContain("kickoff");
  });

  it("renders persona name, origin and trait chips into the svg", async () => {
    const svg = await svgCard(
      {
        n: 6,
        kind: "persona",
        name: "the midnight archivist",
        origin: "posted 9 posts in a single week and never missed a tuesday",
        gradient: "nebula",
      },
      fonts,
      { traits: ["archival", "night owl", "curious"] },
      { embedFont: false }
    );
    for (const word of ["midnight", "archivist", "never", "missed", "tuesday", "night", "owl", "alter", "ego"]) {
      expect(svg).toContain(word);
    }
  });

  it("keeps lowercase headline law for persona and month names", async () => {
    const svg = await svgCard(
      { n: 5, kind: "peaks", bestMonth: "October", bestMonthPosts: 6, gradient: "sunset" },
      fonts,
      { monthly: MONTHLY },
      { embedFont: false }
    );
    expect(svg).toContain("october");
    expect(svg).not.toContain("October");
  });

  it("renders the recap 2x2 totals grid with all four labels", async () => {
    const svg = await svgCard(
      {
        n: 7,
        kind: "recap",
        totals: { posts: 30, words: 4812, channels: 3, activeDays: 96 },
        gradient: "coral",
      },
      fonts,
      undefined,
      { embedFont: false }
    );
    // satori splits text into per-word <text> nodes — assert per word
    for (const label of ["posts", "words", "active", "days", "channels"]) {
      expect(svg).toContain(label);
    }
    for (const num of ["30", "4,812", "3", "96"]) {
      expect(svg).toContain(num);
    }
  });
});

describe("renderOgPng", () => {
  it(
    "renders the 1200x630 landscape OG card",
    async () => {
      const fonts = await loadFonts(fakeAssets);
      const png = await renderOgPng(
        { title: "your year in posts", statLine: "7 cards · one alter ego · one queued recap" },
        fonts
      );
      expectPng(png, 1200, 630);
    },
    120_000
  );
});
