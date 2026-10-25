/**
 * Font loader for the satori → PNG pipeline (spec 04 §2): subset woffs staged
 * under public/fonts are served from the ASSETS binding at /fonts/… and loaded
 * once per isolate (module-level promise cache — rendering is CPU-bound, so
 * the first card of an isolate pays the fetch, the rest reuse it).
 */

export interface SatoriFont {
  name: string;
  data: ArrayBuffer;
  weight: number;
  style: "normal";
}

interface FontSpec {
  name: string;
  file: string;
  weight: number;
}

const FONT_SPECS: FontSpec[] = [
  { name: "Space Grotesk", file: "space-grotesk-latin-500-normal.woff", weight: 500 },
  { name: "Space Grotesk", file: "space-grotesk-latin-700-normal.woff", weight: 700 },
  { name: "Inter", file: "inter-latin-400-normal.woff", weight: 400 },
  { name: "Inter", file: "inter-latin-600-normal.woff", weight: 600 },
  { name: "JetBrains Mono", file: "jetbrains-mono-latin-500-normal.woff", weight: 500 },
];

let fontsPromise: Promise<SatoriFont[]> | null = null;

async function fetchFont(assets: Fetcher, spec: FontSpec): Promise<SatoriFont> {
  const res = await assets.fetch(new Request(`https://assets.local/fonts/${spec.file}`));
  if (!res.ok) {
    throw new Error(`font fetch failed: ${spec.file} (status ${res.status})`);
  }
  return { name: spec.name, data: await res.arrayBuffer(), weight: spec.weight, style: "normal" };
}

async function loadAll(assets: Fetcher): Promise<SatoriFont[]> {
  return Promise.all(FONT_SPECS.map((spec) => fetchFont(assets, spec)));
}

/** Load (and memoize) the brand font set: Space Grotesk 500/700, Inter 400/600, JetBrains Mono 500. */
export function loadFonts(assets: Fetcher): Promise<SatoriFont[]> {
  if (!fontsPromise) {
    fontsPromise = loadAll(assets).catch((err: unknown) => {
      fontsPromise = null; // allow a retry on the next request after a transient failure
      throw err;
    });
  }
  return fontsPromise;
}

// ── fingerprint ──────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit → 8 lowercase hex chars. Fingerprints the stats JSON for card
 * KV cache keys (`card:{userId}:{year}:card{n}-{hash8(statsJson)}`) so stale
 * PNGs self-invalidate when aggregates change (spec 04 §2). Deliberately NOT
 * lib/yearize's statsHash8 — this one is for the render/cache layer.
 */
export function hash8(input: string): string {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
