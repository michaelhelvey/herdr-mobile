import { expect, test } from "bun:test";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "public");

async function readPngSize(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

test("every PNG icon in the manifest has the size that the manifest declares", async () => {
  const manifest = (await Bun.file(join(PUBLIC_DIR, "manifest.webmanifest")).json()) as {
    icons: { src: string; sizes: string; type: string }[];
  };

  const pngs = manifest.icons.filter((icon) => icon.type === "image/png");

  expect(pngs.length).toBeGreaterThanOrEqual(3);

  for (const icon of pngs) {
    expect(await readPngSize(join(PUBLIC_DIR, icon.src))).toBe(icon.sizes);
  }
});

test("the manifest has a maskable icon and the Apple touch icon is 180 pixels", async () => {
  const manifest = (await Bun.file(join(PUBLIC_DIR, "manifest.webmanifest")).json()) as {
    icons: { purpose: string }[];
  };

  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  expect(await readPngSize(join(PUBLIC_DIR, "apple-touch-icon.png"))).toBe("180x180");
});
