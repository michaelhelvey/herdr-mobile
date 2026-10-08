import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { imageExtension, removeOldUploads, saveUpload } from "./uploads.ts";

describe("imageExtension", () => {
  test("accepts the image types that agents read and refuses others", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(imageExtension("image/svg+xml")).toBeNull();
    expect(imageExtension("text/html")).toBeNull();
    expect(imageExtension(null)).toBeNull();
  });
});

describe("saveUpload", () => {
  test("writes a private file and removes it when it is old", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "herdr-uploads-")), "uploads");
    const path = await saveUpload(dir, new Uint8Array([1, 2, 3]), "png");

    expect(path.startsWith(dir)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await utimes(path, old, old);
    await removeOldUploads(dir);

    expect(await readdir(dir)).toEqual([]);
  });
});
