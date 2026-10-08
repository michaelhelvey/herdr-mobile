import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Gives the path of the file that keeps the pairing token. */
export function defaultTokenPath(): string {
  return join(homedir(), ".config", "herdr-bridge", "token");
}

/** Makes a new random token. It is safe to use in a URL. */
export function createToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

/**
 * Gives the pairing token. `HERDR_BRIDGE_TOKEN` overrides the file. If the file does not exist,
 * this function writes a new token to it, so that a paired phone stays paired after a restart.
 */
export async function loadToken(path: string, env = process.env): Promise<string> {
  const fromEnv = env.HERDR_BRIDGE_TOKEN?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  try {
    const saved = (await readFile(path, "utf8")).trim();

    if (saved) {
      return saved;
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const token = createToken();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);

  return token;
}

/** Tells if the value is the token. The time of the check does not depend on the value. */
export function tokenMatches(token: string, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const expected = Buffer.from(token);
  const actual = Buffer.from(value);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
