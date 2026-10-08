import { describe, expect, test } from "bun:test";

import { mergeScreen } from "./merge.ts";

function lines(...values: string[]): string {
  return values.join("\n");
}

describe("mergeScreen", () => {
  test("keeps the lines that scrolled off the screen", () => {
    const older = lines("a", "b", "c", "d", "e", "f", "─────────────", "❯ ");
    const newer = lines("c", "d", "e", "f", "g", "h", "─────────────", "❯ ");

    expect(mergeScreen(older, newer)).toBe(
      lines("a", "b", "c", "d", "e", "f", "g", "h", "─────────────", "❯ "),
    );
  });

  test("takes the new bottom of the screen, because the TUI draws the bottom again", () => {
    const older = lines("a", "b", "c", "d", "e", "⏺ thinking…");
    const newer = lines("b", "c", "d", "e", "⏺ done");

    expect(mergeScreen(older, newer)).toBe(lines("a", "b", "c", "d", "e", "⏺ done"));
  });

  test("uses only the newer read when the screens do not overlap", () => {
    expect(mergeScreen(lines("a", "b", "c", "d"), lines("w", "x", "y", "z"))).toBe(
      lines("w", "x", "y", "z"),
    );
  });

  test("does not match on blank lines and rules that are the same everywhere", () => {
    const older = lines("old 1", "", "─────────────", "old 2", "old 3", "old 4", "old 5");
    const newer = lines("", "─────────────", "new 1", "new 2", "new 3", "new 4");

    expect(mergeScreen(older, newer)).toBe(newer);
  });
});
