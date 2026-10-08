// Makes the icon files in `public/` and the README logo from `assets/logo.png`. Run it with
// `bun run icons`. It needs ImageMagick 7 (`brew install imagemagick`).
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const SOURCE = join(ROOT, "assets", "logo.png");

/**
 * The rounded tile in `assets/logo.png`, in pixels. The area outside the tile is black. Measure
 * these values again if you replace the logo.
 */
const TILE = { x: 33, y: 28, width: 1183, height: 1172, radius: 287 };

/**
 * The distance from each edge of the tile to the full-bleed crop. Phones cut their own
 * corner shape. Their cut removes the black corners that stay in this crop.
 */
const BLEED_INSET = 45;

/** Gives the ImageMagick arguments that cut the tile out, with transparent corners, in a square. */
function cutoutArgs(): string[] {
  const { x, y, width, height, radius } = TILE;
  const side = Math.max(width, height);

  return [
    SOURCE,
    "-crop",
    `${width}x${height}+${x}+${y}`,
    "+repage",
    "-alpha",
    "set",
    "(",
    "-size",
    `${width}x${height}`,
    "xc:none",
    "-fill",
    "white",
    "-draw",
    `roundrectangle 2,2 ${width - 3},${height - 3} ${radius - 2},${radius - 2}`,
    ")",
    "-compose",
    "DstIn",
    "-composite",
    "-compose",
    "Over",
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${side}x${side}`,
  ];
}

/** Gives the ImageMagick arguments that crop a full square from the inner part of the tile. */
function bleedArgs(): string[] {
  const { x, y, width, height } = TILE;
  const innerWidth = width - 2 * BLEED_INSET;
  const innerHeight = height - 2 * BLEED_INSET;
  const side = Math.min(innerWidth, innerHeight);
  const left = x + BLEED_INSET + Math.floor((innerWidth - side) / 2);
  const top = y + BLEED_INSET + Math.floor((innerHeight - side) / 2);

  return [SOURCE, "-crop", `${side}x${side}+${left}+${top}`, "+repage", "-alpha", "off"];
}

/** The files to write: the path from the repo root, the size in pixels, and the crop. */
const FILES = [
  { path: "public/icon-512.png", size: 512, args: cutoutArgs },
  { path: "public/icon-192.png", size: 192, args: cutoutArgs },
  { path: "public/favicon.png", size: 64, args: cutoutArgs },
  { path: "public/icon-maskable-512.png", size: 512, args: bleedArgs },
  { path: "public/apple-touch-icon.png", size: 180, args: bleedArgs },
  { path: "docs/logo.png", size: 480, args: cutoutArgs },
];

if (import.meta.main) {
  for (const file of FILES) {
    const process = Bun.spawn(
      [
        "magick",
        ...file.args(),
        "-filter",
        "Lanczos",
        "-resize",
        `${file.size}x${file.size}`,
        "-strip",
        "-define",
        "png:compression-level=9",
        join(ROOT, file.path),
      ],
      { stderr: "inherit" },
    );

    if ((await process.exited) !== 0) {
      throw new Error(`magick failed for ${file.path}`);
    }

    console.log(`wrote ${file.path}`);
  }
}
