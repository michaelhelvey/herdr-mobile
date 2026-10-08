import { describe, expect, test } from "bun:test";

import { diffForNewFile, MAX_DIFF_LINES, parseUnifiedDiff } from "./unified-diff.ts";

describe("parseUnifiedDiff", () => {
  test("numbers the lines from each hunk head and keeps empty context lines", () => {
    const diff = parseUnifiedDiff(
      [
        "--- a/math.ts",
        "+++ b/math.ts",
        "@@ -3,3 +3,4 @@",
        " }",
        "",
        "-const x = 1;",
        "+const x = 2;",
        "+const y = 3;",
        "@@ -20 +21 @@",
        "-old",
        "+new",
      ].join("\n"),
      "math.ts",
    );

    expect(diff?.action).toBe("edit");
    expect(diff?.added).toBe(3);
    expect(diff?.removed).toBe(2);
    expect(diff?.hunks).toHaveLength(2);
    expect(diff?.hunks[0]?.lines).toEqual([
      { kind: "context", text: "}", oldNo: 3, newNo: 3 },
      { kind: "context", text: "", oldNo: 4, newNo: 4 },
      { kind: "del", text: "const x = 1;", oldNo: 5, newNo: null },
      { kind: "add", text: "const x = 2;", oldNo: null, newNo: 5 },
      { kind: "add", text: "const y = 3;", oldNo: null, newNo: 6 },
    ]);
    expect(diff?.hunks[1]?.lines.map((line) => [line.oldNo, line.newNo])).toEqual([
      [20, null],
      [null, 21],
    ]);
  });

  test("does not read a `---` line inside a hunk as a header", () => {
    const diff = parseUnifiedDiff("@@ -1,1 +1,1 @@\n--- old rule\n+++ new rule", "notes.md");

    expect(diff?.hunks[0]?.lines.map((line) => line.kind)).toEqual(["del", "add"]);
    expect(diff?.hunks[0]?.lines[0]?.text).toBe("-- old rule");
  });

  test("makes a new file when the first hunk has no old lines", () => {
    expect(parseUnifiedDiff("@@ -0,0 +1,2 @@\n+a\n+b", "new.ts")?.action).toBe("create");
  });

  test("gives null for text without hunks", () => {
    expect(parseUnifiedDiff("Index: a.ts\n===", "a.ts")).toBeNull();
  });
});

describe("diffForNewFile", () => {
  test("adds each line once and ignores the last newline", () => {
    const diff = diffForNewFile("a.ts", "one\ntwo\n");

    expect(diff?.added).toBe(2);
    expect(diff?.hunks[0]?.lines.map((line) => line.newNo)).toEqual([1, 2]);
  });

  test("counts all lines of a large file but keeps only the limit", () => {
    const diff = diffForNewFile("big.txt", "x\n".repeat(MAX_DIFF_LINES + 5));

    expect(diff?.added).toBe(MAX_DIFF_LINES + 5);
    expect(diff?.truncated).toBe(true);
    expect(diff?.hunks.flatMap((hunk) => hunk.lines)).toHaveLength(MAX_DIFF_LINES);
  });
});
