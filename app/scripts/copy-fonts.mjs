// Copies the .woff subsets satori needs (satori can't read woff2) from
// @fontsource packages into public/fonts/ — committed so deploys are deterministic.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url)) + "/..";
const outDir = join(appRoot, "public/fonts");
mkdirSync(outDir, { recursive: true });

const picks = [
  ["@fontsource/space-grotesk", ["space-grotesk-latin-500-normal.woff", "space-grotesk-latin-700-normal.woff"]],
  ["@fontsource/inter", ["inter-latin-400-normal.woff", "inter-latin-600-normal.woff"]],
  ["@fontsource/jetbrains-mono", ["jetbrains-mono-latin-500-normal.woff"]],
];

let copied = 0;
for (const [pkg, files] of picks) {
  for (const file of files) {
    const src = join(appRoot, "node_modules", pkg, "files", file);
    try {
      copyFileSync(src, join(outDir, file));
      copied++;
    } catch (err) {
      console.error(`copy-fonts: missing ${src} (${err.message})`);
      process.exitCode = 1;
    }
  }
}
console.log(`copy-fonts: ${copied} font files in ${outDir}`);
