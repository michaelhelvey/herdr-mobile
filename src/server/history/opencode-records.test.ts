import { describe, expect, test } from "bun:test";

import { rowItems } from "./opencode-records.ts";

const CWD = "/Users/me/app";

const context = { cwd: CWD };

function tool(name: string, state: Record<string, unknown>) {
  return { type: "tool", id: "t1", name, state };
}

function assistant(...content: unknown[]) {
  return rowItems("m1", "assistant", { content, model: { id: "gpt-6", variant: "high" } }, context);
}

describe("rowItems", () => {
  test("reads the text, the tools, and the model of an assistant row", () => {
    const result = assistant(
      { type: "reasoning", text: "hmm" },
      { type: "text", text: " Done. " },
      tool("read", { status: "completed", input: { filePath: `${CWD}/a.ts` }, content: "1: x" }),
    );

    expect(result.model).toEqual({ id: "gpt-6", variant: "high" });
    expect(result.items).toEqual([
      { type: "assistant", id: "m1:1", text: "Done." },
      {
        type: "tool",
        id: "t1",
        name: "Read",
        summary: "a.ts",
        output: "1: x",
        isError: false,
        diff: null,
      },
    ]);
  });

  test("shows a running tool without output, and a failed tool with its error", () => {
    const [running] = assistant(
      tool("shell", { status: "running", input: { command: "ls" } }),
    ).items;

    const [failed] = assistant(
      tool("shell", { status: "error", input: { command: "x" }, error: { message: "denied" } }),
    ).items;

    expect(running?.type === "tool" && running.output).toBeNull();
    expect(failed?.type === "tool" && [failed.output, failed.isError]).toEqual(["denied", true]);
  });

  test("marks a shell tool that exits with an error", () => {
    const [item] = assistant(
      tool("shell", { status: "completed", input: { command: "false" }, metadata: { exit: 1 } }),
    ).items;

    expect(item?.type === "tool" && item.isError).toBe(true);
  });

  test("gives one diff card for each file of a patch", () => {
    const { items } = assistant(
      tool("patch", {
        status: "completed",
        input: { patchText: "*** Update File: a.ts\n*** Add File: b.md" },
        metadata: {
          files: [
            { file: `${CWD}/a.ts`, patch: "@@ -1 +1 @@\n-a\n+b", status: "modified" },
            { file: `${CWD}/b.md`, patch: "@@ -0,0 +1 @@\n+new", status: "added" },
          ],
        },
      }),
    );

    expect(
      items.map((item) => item.type === "tool" && [item.id, item.diff?.path, item.diff?.action]),
    ).toEqual([
      ["t1", "a.ts", "edit"],
      ["t1:1", "b.md", "create"],
    ]);
  });

  test("treats the default variant as no effort", () => {
    expect(
      rowItems("s", "model-switched", { model: { id: "gpt-6", variant: "default" } }, context)
        .model,
    ).toEqual({ id: "gpt-6", variant: null });
  });

  test("shows a shell row of the user as a tool and an interrupted turn as a notice", () => {
    const shell = rowItems(
      "r1",
      "shell",
      { command: "ls\npwd", status: "completed", exit: 0, output: "a" },
      context,
    );

    const idle = rowItems("r2", "idle", { outcome: "interrupted" }, context);
    const quiet = rowItems("r3", "idle", { outcome: "completed" }, context);

    expect(
      shell.items[0]?.type === "tool" && [shell.items[0].summary, shell.items[0].isError],
    ).toEqual(["ls", false]);
    expect(idle.items).toEqual([{ type: "notice", id: "r2", text: "Interrupted" }]);
    expect(quiet.items).toEqual([]);
  });

  test("ignores a row whose data is not an object", () => {
    expect(rowItems("x", "assistant", null, context)).toEqual({ items: [], model: null });
  });
});
