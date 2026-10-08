import { describe, expect, test } from "bun:test";

import { claudeAdapter, unwrap } from "./claude.ts";
import { opencodeAdapter } from "./opencode.ts";
import { adapterFor } from "./registry.ts";

const RULE = "─".repeat(60);

const CLAUDE_SCREEN = [
  "✻ Overthought for 41s · done 10:26 AM",
  "",
  "❯ shouldn't we use the rules of hooks",
  "",
  "  Ran 5 shell commands",
  "",
  "⏺ Found it: rslint ships the plugins.",
  "",
  "  Ran 2 shell commands",
  "",
  "⏺ Read(src/app.tsx)",
  "  ⎿  Read 40 lines",
  "",
  "⏺ yes. it now turns on:",
  "",
  "  - rules-of-hooks",
  "  - exhaustive-deps",
  "",
  RULE,
  "❯ ",
  RULE,
  "  -- INSERT -- ⏵⏵ bypass permissions on",
].join("\n");

describe("claudeAdapter", () => {
  test("splits the screen into messages, tool calls, and status lines", () => {
    expect(claudeAdapter.parse(CLAUDE_SCREEN)).toEqual([
      { role: "meta", text: "Overthought for 41s · done 10:26 AM" },
      { role: "user", text: "shouldn't we use the rules of hooks" },
      { role: "tool", text: "Ran 5 shell commands" },
      { role: "agent", text: "Found it: rslint ships the plugins." },
      { role: "tool", text: "Ran 2 shell commands" },
      { role: "tool", text: "Read(src/app.tsx)\n⎿  Read 40 lines" },
      { role: "agent", text: "yes. it now turns on:\n\n- rules-of-hooks\n- exhaustive-deps" },
    ]);
  });

  test("shows only the dialog when the agent asks a question", () => {
    const screen = [
      "$ claude",
      RULE,
      " Quick safety check: Is this a project you trust?",
      " ❯ No, exit",
      "   Yes, I trust this folder",
      " Enter to confirm · Esc to cancel",
    ].join("\n");

    expect(claudeAdapter.dialog(screen)).toBe(
      " Quick safety check: Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel",
    );
  });
});

describe("unwrap", () => {
  test("joins a line that the terminal wrapped but keeps list items and short lines", () => {
    const long = "x".repeat(50);

    expect(unwrap([long, "  rest of it", "short", "next", long, "- item"], 52)).toEqual([
      `${long} rest of it`,
      "short",
      "next",
      long,
      "- item",
    ]);
  });
});

describe("opencodeAdapter", () => {
  test("reads the bars as user messages and removes the scrollbar and the input box", () => {
    const pad = " ".repeat(40);

    const screen = [
      `  ┃${pad}█`,
      `  ┃  reply with: hello${pad}█`,
      `  ┃${pad}█`,
      `${pad}  █`,
      `     hello from opencode.${pad}█`,
      "",
      "     Build · GPT-6 Luna · 2.1s · 5.4 tok/s",
      "",
      "  ┃",
      "  ┃  Build · GPT-6 Luna T4 AI Gateway",
      `  ╹${"▀".repeat(40)}`,
      "  ~/dev/app:main     5.8K (1%)",
    ].join("\n");

    expect(opencodeAdapter.parse(screen)).toEqual([
      { role: "user", text: "reply with: hello" },
      { role: "agent", text: "hello from opencode." },
      { role: "meta", text: "Build · GPT-6 Luna · 2.1s · 5.4 tok/s" },
    ]);
  });
});

describe("adapterFor", () => {
  test("shows a kind without an adapter as terminal text without the input box", () => {
    const blocks = adapterFor("some-new-agent").parse(
      ["hello from pi", RULE, "", RULE, "~/dev/app (main)"].join("\n"),
    );

    expect(blocks).toEqual([{ role: "terminal", text: "hello from pi" }]);
  });
});
