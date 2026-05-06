/**
 * Rasterizes public/assets/icons/pwa-icon.svg (Logo-aligned mark) to PNGs for manifest & Apple touch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "public", "assets", "icons", "pwa-icon.svg");
const outDir = join(root, "public", "assets", "icons");

const svg = readFileSync(svgPath);

for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(join(outDir, `icon-${size}.png`));
  console.log(`Wrote ${join("public", "assets", "icons", `icon-${size}.png`)}`);
}
