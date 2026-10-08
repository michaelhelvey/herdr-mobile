import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadToken, tokenMatches } from "./auth.ts";

async function tempTokenPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "herdr-bridge-")), "nested", "token");
}

describe("loadToken", () => {
  test("writes a new private token once and gives the same token after that", async () => {
    const path = await tempTokenPath();
    const first = await loadToken(path, {});
    const second = await loadToken(path, {});

    expect(second).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await readFile(path, "utf8")).trim()).toBe(first);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("uses the environment variable and does not write a file", async () => {
    const path = await tempTokenPath();

    expect(await loadToken(path, { HERDR_BRIDGE_TOKEN: " from-env " })).toBe("from-env");

    const missing = await stat(path).then(
      () => false,
      () => true,
    );

    expect(missing).toBe(true);
  });
});

describe("tokenMatches", () => {
  test("accepts only the exact token", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("abc", undefined)).toBe(false);
  });
});
