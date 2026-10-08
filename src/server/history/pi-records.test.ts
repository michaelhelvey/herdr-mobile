import { describe, expect, test } from "bun:test";

import { ImageStore } from "./images.ts";
import { PiTranscript } from "./pi-records.ts";

const CWD = "/Users/me/app";

function build(...entries: unknown[]): PiTranscript {
  const transcript = new PiTranscript();

  [{ type: "session", id: "s1", cwd: CWD }, ...entries].forEach((entry) => transcript.add(entry));

  return transcript;
}

function message(id: string, parentId: string | null, body: Record<string, unknown>) {
  return { type: "message", id, parentId, message: body };
}

function user(id: string, parentId: string | null, text: string) {
  return message(id, parentId, { role: "user", content: [{ type: "text", text }] });
}

describe("PiTranscript", () => {
  test("joins a tool result and its patch to the tool call", () => {
    const transcript = build(
      user("u1", null, "add subtract"),
      message("a1", "u1", {
        role: "assistant",
        provider: "t4",
        model: "gpt-5.6-sol",
        content: [
          { type: "text", text: "On it." },
          { type: "toolCall", id: "c1", name: "edit", arguments: { path: `${CWD}/math.ts` } },
        ],
      }),
      message("r1", "a1", {
        role: "toolResult",
        toolCallId: "c1",
        content: [{ type: "text", text: "Edited math.ts" }],
        details: { patch: "@@ -1,1 +1,2 @@\n a\n+b" },
        isError: false,
      }),
    );

    expect(transcript.items.map((item) => item.type)).toEqual(["user", "assistant", "tool"]);

    const tool = transcript.items[2];

    expect(tool?.type === "tool" && tool.name).toBe("Edit");
    expect(tool?.type === "tool" && tool.summary).toBe("math.ts");
    expect(tool?.type === "tool" && tool.output).toBe("Edited math.ts");
    expect(tool?.type === "tool" && tool.diff?.added).toBe(1);
    expect(transcript.model).toBe("gpt-5.6-sol");
  });

  test("shows a write as all added lines, but does not say that the file is new", () => {
    const transcript = build(
      message("a1", null, {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "write",
            arguments: { path: `${CWD}/notes.md`, content: "one\ntwo\n" },
          },
        ],
      }),
      message("r1", "a1", { role: "toolResult", toolCallId: "c1", content: "ok", isError: false }),
    );

    const tool = transcript.items[0];

    expect(tool?.type === "tool" && tool.diff?.action).toBe("update");
    expect(tool?.type === "tool" && tool.diff?.added).toBe(2);
  });

  test("keeps the output of a failed tool but shows no diff", () => {
    const transcript = build(
      message("a1", null, {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "x.ts" } }],
      }),
      message("r1", "a1", {
        role: "toolResult",
        toolCallId: "c1",
        content: [{ type: "text", text: "old text not found" }],
        details: { patch: "@@ -1 +1 @@\n-a\n+b" },
        isError: true,
      }),
    );

    const tool = transcript.items[0];

    expect(tool?.type === "tool" && tool.isError).toBe(true);
    expect(tool?.type === "tool" && tool.diff).toBeNull();
  });

  test("shows only the branch of the last entry, and changes the key", () => {
    const transcript = build(user("u1", null, "first"), user("u2", "u1", "old branch"), {
      type: "model_change",
      id: "m1",
      parentId: "u2",
      provider: "t4",
      modelId: "t4/old",
    });

    expect(transcript.key).toBe("s1");
    expect(transcript.model).toBe("old");

    transcript.add(user("u3", "u1", "new branch"));

    expect(transcript.key).not.toBe("s1");
    expect(transcript.items.map((item) => item.type === "user" && item.text)).toEqual([
      "first",
      "new branch",
    ]);
    expect(transcript.model).toBeNull();
  });

  test("keeps the thinking level and shows interrupted turns", () => {
    const transcript = build(
      { type: "thinking_level_change", id: "t1", parentId: null, thinkingLevel: "high" },
      message("a1", "t1", { role: "assistant", content: [], stopReason: "aborted" }),
    );

    expect(transcript.effort).toBe("high");
    expect(transcript.items).toEqual([{ type: "notice", id: "a1:stop", text: "Interrupted" }]);
  });

  test("keeps a pasted image and shows a user shell command as a tool", () => {
    const images = new ImageStore();
    const transcript = new PiTranscript(images);

    transcript.add({ type: "session", id: "s1", cwd: CWD });
    transcript.add(
      message("u1", null, {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: btoa("png"), mimeType: "image/png" },
        ],
      }),
    );
    transcript.add(
      message("b1", "u1", { role: "bashExecution", command: "false", output: "", exitCode: 1 }),
    );

    expect(transcript.items[0]).toEqual({
      type: "user",
      id: "u1",
      text: "look",
      images: ["pi:u1-1"],
    });
    expect(images.get("pi:u1-1")?.mediaType).toBe("image/png");
    expect(transcript.items[1]?.type === "tool" && transcript.items[1].isError).toBe(true);
  });
});
