import { describe, expect, test } from "bun:test";

import {
  ClaudeTranscript,
  diffFromResult,
  extractUploads,
  summarizeTool,
} from "./claude-records.ts";

const CWD = "/Users/me/app";

function transcript(...entries: unknown[]) {
  const result = new ClaudeTranscript();

  entries.forEach((entry) => result.add(entry));

  return result.items;
}

describe("ClaudeTranscript", () => {
  test("keeps a user message with blank lines in one piece", () => {
    const items = transcript({
      type: "user",
      uuid: "u1",
      cwd: CWD,
      message: { role: "user", content: "first part\n\nsecond part" },
    });

    expect(items).toEqual([
      { type: "user", id: "u1", text: "first part\n\nsecond part", images: [] },
    ]);
  });

  test("joins a tool result and its diff to the tool call", () => {
    const items = transcript(
      {
        type: "assistant",
        uuid: "a1",
        cwd: CWD,
        message: {
          content: [
            { type: "text", text: "Fixing it." },
            {
              type: "tool_use",
              id: "t1",
              name: "Edit",
              input: { file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        cwd: CWD,
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        toolUseResult: {
          filePath: `${CWD}/src/a.ts`,
          oldString: "x",
          structuredPatch: [
            { oldStart: 3, newStart: 3, lines: [" keep", "-const x = 1;", "+const y = 1;"] },
          ],
        },
      },
    );

    expect(items.map((item) => item.type)).toEqual(["assistant", "tool"]);
    expect(items[1]).toMatchObject({
      name: "Edit",
      summary: "src/a.ts",
      output: "ok",
      diff: {
        path: "src/a.ts",
        action: "edit",
        added: 1,
        removed: 1,
        hunks: [
          {
            lines: [
              { kind: "context", text: "keep", oldNo: 3, newNo: 3 },
              { kind: "del", text: "const x = 1;", oldNo: 4, newNo: null },
              { kind: "add", text: "const y = 1;", oldNo: null, newNo: 4 },
            ],
          },
        ],
      },
    });
  });

  test("shows a message sent while the agent worked, and skips subagents and meta records", () => {
    const items = transcript(
      {
        type: "attachment",
        uuid: "q1",
        attachment: { type: "queued_command", prompt: "also this" },
      },
      { type: "user", uuid: "s1", isSidechain: true, message: { content: "subagent prompt" } },
      { type: "user", uuid: "m1", isMeta: true, message: { content: "caveat" } },
      { type: "user", uuid: "c1", message: { content: "<command-name>/clear</command-name>" } },
    );

    expect(items).toEqual([
      { type: "user", id: "q1", text: "also this", images: [] },
      { type: "notice", id: "c1", text: "/clear" },
    ]);
  });
});

describe("diffFromResult", () => {
  test("shows a new file as added lines", () => {
    expect(
      diffFromResult({ type: "create", filePath: `${CWD}/new.md`, content: "a\nb\n" }, CWD),
    ).toEqual({
      path: "new.md",
      action: "create",
      added: 2,
      removed: 0,
      truncated: false,
      hunks: [
        {
          lines: [
            { kind: "add", text: "a", oldNo: null, newNo: 1 },
            { kind: "add", text: "b", oldNo: null, newNo: 2 },
          ],
        },
      ],
    });
  });
});

describe("summarizeTool", () => {
  test("gives the first line of a command and a path relative to the project", () => {
    expect(summarizeTool("Bash", { command: "bun test\necho done" }, CWD)).toBe("bun test");
    expect(summarizeTool("Read", { file_path: "/etc/hosts" }, CWD)).toBe("/etc/hosts");
  });
});

describe("extractUploads", () => {
  const dir = "/Users/me/.cache/herdr-bridge/uploads";
  const name = "05bcbe10-877a-44fd-bfee-961eb1ff0dbd.jpg";

  test("changes a bridge upload path in a queued message into an image", () => {
    const items = new ClaudeTranscript(undefined, dir);

    items.add({
      type: "attachment",
      uuid: "q1",
      attachment: { type: "queued_command", prompt: `${dir}/${name} how does it look?` },
    });

    expect(items.items).toEqual([
      { type: "user", id: "q1", text: "how does it look?", images: [`upload:${name}`] },
    ]);
  });

  test("keeps other paths in the text", () => {
    expect(extractUploads(`see ${dir}/../secret.jpg and /tmp/${name}`, dir)).toEqual({
      text: `see ${dir}/../secret.jpg and /tmp/${name}`,
      images: [],
    });
  });
});

describe("command output", () => {
  test("shows the Markdown that Claude Code writes after the output of a command", () => {
    const items = new ClaudeTranscript();

    items.add({
      type: "system",
      subtype: "local_command",
      uuid: "c1",
      content: "<command-name>/context</command-name>\n<command-args></command-args>",
    });
    items.add({
      type: "system",
      subtype: "local_command",
      uuid: "c2",
      content: "<local-command-stdout> \u001b[1mContext Usage\u001b[22m ⛁ ⛁</local-command-stdout>",
    });
    items.add({
      type: "user",
      uuid: "m0",
      isMeta: true,
      message: {
        content: "<local-command-caveat>The command below was run directly.</local-command-caveat>",
      },
    });
    items.add({
      type: "user",
      uuid: "m1",
      isMeta: true,
      message: { content: "## Context Usage\n\n| a | b |\n| - | - |" },
    });

    expect(items.items).toEqual([
      { type: "notice", id: "c1", text: "/context" },
      {
        type: "output",
        id: "c2",
        text: "## Context Usage\n\n| a | b |\n| - | - |",
        markdown: true,
      },
    ]);
  });
});
