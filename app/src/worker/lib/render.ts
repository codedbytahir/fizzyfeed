/**
 * satori → SVG → resvg-wasm → PNG renderer (spec 04 §2).
 *
 * Portrait story cards: 1080×1350 (4:5). ink-950 canvas, gradient card face
 * inset 24px with radius 28, white text only. Landscape OG variant: 1200×630.
 * The brand wordmark comes from BRAND_NAME only (AGENTS.md §1.1).
 *
 * wasm init: in workers the CompiledWasm rule bundles the literal specifier
 * below into a WebAssemblyModule; in node/vitest that import fails and we fall
 * back to reading the wasm from node_modules on disk. Either way init runs
 * exactly once per isolate (memoized promise).
 */
import satori, { type Font as SatoriFontOption } from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import type { CardData, CardGradient, YearStats } from "../../shared/types";
import { BRAND_NAME } from "../../shared/brand";
import {
  BAR_WHITE,
  CARD_GRADIENTS,
  CHIP_BORDER,
  DOT_WHITE,
  INK_950,
  SEGMENT_WHITE,
  TEXT_BODY,
  TEXT_DIM,
  TEXT_SOLID,
} from "./gradients";
import type { SatoriFont } from "./fonts";

// ── canvas metrics (spec 04 §2) ──────────────────────────────────────────────

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const INSET = 24; // ink frame around the gradient face
const MARGIN = 72; // content margin inside the face
const RADIUS_CARD = 28; /* token: radius-card */

const MONO = "JetBrains Mono";
const DISPLAY = "Space Grotesk";
const BODY = "Inter";

// ── satori element tree (object form — no JSX in the worker) ─────────────────

export interface SatoriStyle {
  [key: string]: string | number | string[] | SatoriStyle | undefined;
}

export interface SatoriTree {
  type: string;
  props: { style?: SatoriStyle; children?: string | SatoriTree | SatoriTree[] };
}

/** Extra render-only context: aggregates that stay out of the CardData union. */
export interface CardRenderContext {
  /** 12 monthly counts for the peaks microbars (spec: rendering concern only). */
  monthly?: number[];
  /** Optional override for the rhythm 7-day strip; defaults to card.spark. */
  spark?: number[];
  /** Persona trait chips (Persona.traits — Deck carries it, CardData does not). */
  traits?: string[];
}

function el(type: string, style: SatoriStyle, children?: SatoriTree["props"]["children"]): SatoriTree {
  return { type, props: { style, children } };
}

function txt(style: SatoriStyle, text: string): SatoriTree {
  return el("div", style, text);
}

/** Enforce the lowercase headline law (AGENTS.md §1.5) at render time. */
function lc(s: string): string {
  return s.toLowerCase();
}

/** Text safety valve — truncates copy so long posts can never break layout. */
function clamp(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Tabular-friendly number: integers grouped, floats at one decimal. */
function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ── shared style blocks ──────────────────────────────────────────────────────

const OVERLINE: SatoriStyle = {
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: 26,
  color: TEXT_DIM,
  letterSpacing: "0.04em",
};

const HEADLINE: SatoriStyle = {
  fontFamily: DISPLAY,
  fontWeight: 700,
  fontSize: 64,
  color: TEXT_SOLID,
  letterSpacing: "-0.02em",
};

function statStyle(fontSize: number): SatoriStyle {
  return {
    fontFamily: MONO,
    fontWeight: 500,
    fontSize,
    color: TEXT_SOLID,
    // satori 0.10.x accepts only the string form of font-feature-settings here
    // (an array throws at render time) — the feature requested is "tnum".
    fontFeatureSettings: "tnum",
    lineHeight: 1.1,
    marginTop: 28,
  };
}

const CAPTION: SatoriStyle = {
  fontFamily: BODY,
  fontWeight: 400,
  fontSize: 30,
  color: TEXT_BODY,
  lineHeight: 1.45,
  marginTop: 28,
  maxWidth: 820,
};

const LABEL: SatoriStyle = {
  fontFamily: BODY,
  fontWeight: 600,
  fontSize: 26,
  color: TEXT_DIM,
  marginTop: 14,
};

function footer(): SatoriTree {
  return el("div", { display: "flex", alignItems: "center" }, [
    el("div", { width: 24, height: 24, borderRadius: 24, backgroundColor: DOT_WHITE }),
    txt(
      { fontFamily: DISPLAY, fontWeight: 700, fontSize: 26, color: TEXT_SOLID, marginLeft: 12 },
      BRAND_NAME
    ),
  ]);
}

function midColumn(nodes: SatoriTree[]): SatoriTree {
  return el("div", { display: "flex", flexDirection: "column" }, nodes);
}

/** Minimal-height white bars, bottom-aligned (rhythm spark / peaks microbars). */
function barStrip(values: number[], barWidth: number, gapPx: number, maxHeight: number): SatoriTree {
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const bars = values.map((v, i) =>
    el("div", {
      width: barWidth,
      height: max > 0 ? Math.max(8, Math.round((v / max) * maxHeight)) : 8,
      backgroundColor: BAR_WHITE,
      borderRadius: 6,
      marginRight: i < values.length - 1 ? gapPx : 0,
    })
  );
  return el("div", { display: "flex", alignItems: "flex-end", height: maxHeight }, bars);
}

function cardShell(gradient: CardGradient, overlineText: string, mid: SatoriTree): SatoriTree {
  const [c1, c2] = CARD_GRADIENTS[gradient];
  return el(
    "div",
    { width: CARD_WIDTH, height: CARD_HEIGHT, display: "flex", backgroundColor: INK_950 },
    [
      el(
        "div",
        {
          width: CARD_WIDTH - INSET * 2,
          height: CARD_HEIGHT - INSET * 2,
          borderRadius: RADIUS_CARD,
          backgroundImage: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: MARGIN,
          overflow: "hidden",
        },
        [txt(OVERLINE, overlineText), mid, footer()]
      ),
    ]
  );
}

// ── per-card trees (spec 04 §2 "per-card visual anchors") ────────────────────

function kickoffTree(card: Extract<CardData, { kind: "kickoff" }>): SatoriTree {
  const nodes: SatoriTree[] = [];
  if (card.date) {
    nodes.push(txt(HEADLINE, "it began on"));
    nodes.push(txt(statStyle(120), clamp(lc(card.date), 40)));
  } else {
    // empty-state card (date === "") — no stat moment yet
    nodes.push(txt(HEADLINE, "your year in posts"));
  }
  nodes.push(txt(CAPTION, clamp(card.excerpt, 120)));
  return cardShell("bolt", `chapter 01 — kickoff`, midColumn(nodes));
}

function rhythmTree(card: Extract<CardData, { kind: "rhythm" }>, ctx: CardRenderContext): SatoriTree {
  const spark = ctx.spark && ctx.spark.length > 0 ? ctx.spark : card.spark;
  const values = Array.from({ length: 7 }, (_, i) => spark[i] ?? 0);
  return cardShell(
    "aurora",
    `chapter 02 — rhythm`,
    midColumn([
      txt(HEADLINE, `${lc(card.bestDow)}s, ${lc(card.favoriteHour)}`),
      txt(statStyle(120), fmtNum(card.postsPerWeek)),
      txt(LABEL, "posts per week"),
      el("div", { display: "flex", marginTop: 56 }, [barStrip(values, 72, 16, 120)]),
    ])
  );
}

function streaksTree(card: Extract<CardData, { kind: "streaks" }>): SatoriTree {
  return cardShell(
    "fizz",
    `chapter 03 — streaks`,
    midColumn([
      txt(HEADLINE, "longest streak"),
      txt(statStyle(160), fmtNum(card.longest)),
      txt(CAPTION, "days in a row"),
      txt({ ...CAPTION, marginTop: 12 }, `${fmtNum(card.busiestWeekPosts)} posts in your busiest week`),
    ])
  );
}

function mixTree(card: Extract<CardData, { kind: "mix" }>): SatoriTree {
  const channels = card.channels.slice(0, 4);
  const nodes: SatoriTree[] = [txt(HEADLINE, "the mix")];
  if (channels.length > 0) {
    // proportional single bar: pct-width segments separated by 4px ink-950 gaps
    nodes.push(
      el("div", { display: "flex", height: 56, marginTop: 48 }, [
        ...channels.flatMap((ch, i) => {
          const segment = el("div", {
            width: `${Math.max(0, Math.round(ch.pct))}%`,
            backgroundColor: SEGMENT_WHITE,
          });
          return i < channels.length - 1
            ? [segment, el("div", { width: 4, height: 56, backgroundColor: INK_950 })]
            : [segment];
        }),
      ])
    );
    nodes.push(
      el("div", { display: "flex", marginTop: 20 }, [
        ...channels.map((ch, i) =>
          txt(
            { fontFamily: MONO, fontWeight: 500, fontSize: 26, color: TEXT_DIM, marginRight: i < channels.length - 1 ? 32 : 0 },
            `${lc(ch.service)} ${Math.round(ch.pct)}%`
          )
        ),
      ])
    );
  }
  const topics = card.topTopics.slice(0, 5).map((t) => clamp(t, 24));
  if (topics.length > 0) {
    nodes.push(txt(CAPTION, `talking about: ${topics.join(", ")}`));
  }
  return cardShell("grape", `chapter 04 — the mix`, midColumn(nodes));
}

function peaksTree(card: Extract<CardData, { kind: "peaks" }>, ctx: CardRenderContext): SatoriTree {
  const monthly = Array.from({ length: 12 }, (_, i) => ctx.monthly?.[i] ?? 0);
  return cardShell(
    "sunset",
    `chapter 05 — peaks`,
    midColumn([
      txt(HEADLINE, lc(card.bestMonth)),
      txt(statStyle(120), fmtNum(card.bestMonthPosts)),
      txt(CAPTION, `posts in ${lc(card.bestMonth)}`),
      el("div", { display: "flex", marginTop: 56 }, [barStrip(monthly, 40, 12, 96)]),
    ])
  );
}

function personaTree(card: Extract<CardData, { kind: "persona" }>, ctx: CardRenderContext): SatoriTree {
  const nodes: SatoriTree[] = [
    txt(HEADLINE, lc(clamp(card.name, 28))),
    txt(CAPTION, clamp(card.origin, 140)),
  ];
  const traits = ctx.traits?.slice(0, 3).map((t) => clamp(t, 18)) ?? [];
  if (traits.length > 0) {
    nodes.push(
      el("div", { display: "flex", marginTop: 44 }, [
        ...traits.map((t, i) =>
          txt(
            {
              fontFamily: BODY,
              fontWeight: 400,
              fontSize: 26,
              color: TEXT_SOLID,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: CHIP_BORDER,
              borderRadius: 999,
              padding: "12px 26px",
              marginRight: i < traits.length - 1 ? 16 : 0,
            },
            t
          )
        ),
      ])
    );
  }
  return cardShell("nebula", `chapter 06 — alter ego`, midColumn(nodes));
}

function recapTree(card: Extract<CardData, { kind: "recap" }>): SatoriTree {
  const totals: YearStats["totals"] = card.totals;
  const cells: [string, string][] = [
    [fmtNum(totals.posts), "posts"],
    [fmtNum(totals.words), "words"],
    [fmtNum(totals.activeDays), "active days"],
    [fmtNum(totals.channels), "channels"],
  ];
  const rows = [cells.slice(0, 2), cells.slice(2, 4)].map((rowCells, i) =>
    el("div", { display: "flex", marginTop: i > 0 ? 36 : 0 }, [
      ...rowCells.map(([num, label]) =>
        el("div", { display: "flex", flexDirection: "column", width: "50%" }, [
          txt(
            { fontFamily: MONO, fontWeight: 500, fontSize: 72, color: TEXT_SOLID, fontFeatureSettings: "tnum" },
            num
          ),
          txt(LABEL, label),
        ])
      ),
    ])
  );
  return cardShell(
    "coral",
    `chapter 07 — the recap`,
    midColumn([
      txt(HEADLINE, "the recap"),
      el("div", { display: "flex", flexDirection: "column", marginTop: 48 }, rows),
      txt(CAPTION, "queue your recap post"),
    ])
  );
}

function buildCardTree(card: CardData, ctx: CardRenderContext): SatoriTree {
  switch (card.kind) {
    case "kickoff":
      return kickoffTree(card);
    case "rhythm":
      return rhythmTree(card, ctx);
    case "streaks":
      return streaksTree(card);
    case "mix":
      return mixTree(card);
    case "peaks":
      return peaksTree(card, ctx);
    case "persona":
      return personaTree(card, ctx);
    case "recap":
      return recapTree(card);
  }
}

// ── OG variant (spec 04 §3) ──────────────────────────────────────────────────

function buildOgTree(opts: { title: string; statLine: string }): SatoriTree {
  const [c1, c2] = CARD_GRADIENTS.bolt;
  return el("div", { width: OG_WIDTH, height: OG_HEIGHT, display: "flex", backgroundColor: INK_950 }, [
    el("div", {
      width: 8,
      height: "100%",
      backgroundImage: `linear-gradient(180deg, ${c1} 0%, ${c2} 100%)`,
    }),
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexGrow: 1,
        padding: "64px 72px",
      },
      [
        txt({ ...HEADLINE, fontSize: 72 }, clamp(lc(opts.title), 40)),
        txt({ fontFamily: MONO, fontWeight: 500, fontSize: 32, color: TEXT_DIM }, clamp(opts.statLine, 80)),
        footer(),
      ]
    ),
  ]);
}

// ── wasm init (once per isolate) ─────────────────────────────────────────────

let wasmReady: Promise<void> | null = null;

/** Memoized resvg-wasm init — safe to await before every render. */
export function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initResvg().catch((err: unknown) => {
      wasmReady = null; // allow retry
      throw err;
    });
  }
  return wasmReady;
}

async function initResvg(): Promise<void> {
  try {
    // workers: wrangler's CompiledWasm rule bundles this literal dynamic import
    // into a WebAssemblyModule. Kept literal so the bundler can analyze it.
    // @ts-expect-error the .wasm specifier has no type declarations
    const mod: { default?: unknown } = await import("@resvg/resvg-wasm/index_bg.wasm");
    const raw: unknown = mod.default ?? mod;
    if (raw instanceof WebAssembly.Module) {
      await initWasm(raw);
      return;
    }
    if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
      await initWasm(raw);
      return;
    }
    throw new Error(`unexpected resvg wasm export shape: ${typeof raw}`);
  } catch {
    // node/vitest: resolve the wasm from node_modules on disk instead.
    const fsSpec = "node:fs";
    const { readFileSync } = (await import(/* @vite-ignore */ fsSpec)) as {
      readFileSync: (path: URL) => Uint8Array;
    };
    // workers-types' ImportMeta has no `url`; this module only runs under node here.
    const moduleUrl = (import.meta as unknown as { url: string }).url;
    const candidates = [
      new URL("../../../node_modules/@resvg/resvg-wasm/index_bg.wasm", moduleUrl),
      new URL("../../../../node_modules/@resvg/resvg-wasm/index_bg.wasm", moduleUrl),
    ];
    let bytes: Uint8Array | null = null;
    for (const path of candidates) {
      try {
        bytes = readFileSync(path);
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!bytes) {
      throw new Error("resvg wasm unavailable (bundled import failed and node_modules copy not found)");
    }
    await initWasm(bytes);
  }
}

// ── public render API ────────────────────────────────────────────────────────

function satoriFonts(fonts: SatoriFont[]): SatoriFontOption[] {
  return fonts.map((f) => ({
    name: f.name,
    data: f.data,
    // SatoriFont.weight is `number` by contract; our specs (400/500/600/700)
    // are all valid satori Weight members.
    weight: f.weight as SatoriFontOption["weight"],
    style: f.style,
  }));
}

async function rasterize(svg: string, width: number): Promise<Uint8Array> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

/** SVG of a story card — exported for tests (PNGs can't be grepped; SVGs can). */
export async function svgCard(
  card: CardData,
  fonts: SatoriFont[],
  context?: CardRenderContext,
  /** embedFont:false keeps <text> nodes (word-split) — test-assertion mode only. */
  opts?: { embedFont?: boolean }
): Promise<string> {
  await ensureWasm();
  const tree = buildCardTree(card, context ?? {});
  return satori(tree as unknown as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: satoriFonts(fonts),
    embedFont: opts?.embedFont ?? true,
  });
}

/** 1080×1350 PNG of a story card (spec 04 §2). */
export async function renderCardPng(
  card: CardData,
  fonts: SatoriFont[],
  context?: CardRenderContext
): Promise<Uint8Array> {
  const svg = await svgCard(card, fonts, context);
  return rasterize(svg, CARD_WIDTH);
}

/** 1200×630 name-agnostic OG PNG (spec 04 §3). */
export async function renderOgPng(
  opts: { title: string; statLine: string },
  fonts: SatoriFont[]
): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await satori(buildOgTree(opts) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: satoriFonts(fonts),
  });
  return rasterize(svg, OG_WIDTH);
}
