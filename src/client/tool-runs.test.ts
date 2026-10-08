import { describe, expect, test } from "bun:test";

import type { ChatItem, FileDiff } from "../shared/history.ts";
import { groupToolRuns } from "./tool-runs.ts";

const DIFF: FileDiff = {
  path: "a.ts",
  action: "edit",
  added: 1,
  removed: 0,
  hunks: [],
  truncated: false,
};

function tool(id: string, diff: FileDiff | null = null): ChatItem {
  return { type: "tool", id, name: "Bash", summary: id, output: null, isError: false, diff };
}

describe("groupToolRuns", () => {
  test("joins tool calls in a row but keeps file changes and text apart", () => {
    const rows = groupToolRuns([
      tool("t1"),
      tool("t2"),
      tool("e1", DIFF),
      tool("t3"),
      { type: "assistant", id: "a1", text: "done" },
    ]);

    expect(
      rows.map((row) => (row.kind === "tools" ? row.tools.map((t) => t.id) : row.item.id)),
    ).toEqual([["t1", "t2"], "e1", ["t3"], "a1"]);
  });
});
