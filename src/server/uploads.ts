import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The largest upload that the bridge accepts, in bytes. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The time that the bridge keeps an upload. Agents read the file soon after the prompt. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Gives the folder where the bridge keeps uploads. */
export function defaultUploadDir(): string {
  return join(homedir(), ".cache", "herdr-bridge", "uploads");
}

/** Gives the file extension for an image type that agents can read, or `null`. */
export function imageExtension(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  return EXTENSIONS[type] ?? null;
}

/** Writes an upload to a new private file and gives its path. */
export async function saveUpload(
  dir: string,
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const path = join(dir, `${crypto.randomUUID()}.${extension}`);

  await writeFile(path, bytes, { mode: 0o600 });

  return path;
}

/** Removes uploads that are older than one week. */
export async function removeOldUploads(dir: string, now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => []);

  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);

      if (info && now - info.mtimeMs > KEEP_MS) {
        await rm(path, { force: true });
      }
    }),
  );
}
