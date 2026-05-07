/**
 * Rasterizes notify-icon.svg and notify-badge.svg to PNGs for Web Notifications API.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "public", "assets", "icons");

const iconSvg = readFileSync(join(outDir, "notify-icon.svg"));
const badgeSvg = readFileSync(join(outDir, "notify-badge.svg"));

await sharp(iconSvg).resize(192, 192).png().toFile(join(outDir, "notify-192.png"));
console.log("Wrote public/assets/icons/notify-192.png");

await sharp(badgeSvg).resize(96, 96).png().toFile(join(outDir, "notify-badge-96.png"));
console.log("Wrote public/assets/icons/notify-badge-96.png");
