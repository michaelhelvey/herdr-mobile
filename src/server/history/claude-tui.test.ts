import { describe, expect, test } from "bun:test";

import { effortKeys, effortLevel, moveKeys, parseDialog, parseModelPicker } from "./claude-tui.ts";

async function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/${name}`, import.meta.url)).text();
}

describe("parseModelPicker", () => {
  test("reads the options, the cursor, and the effort from the real picker", async () => {
    const picker = parseModelPicker(await fixture("claude-picker.txt"));

    expect(picker?.options.map((option) => option.label)).toEqual([
      "Default (recommended)",
      "Opus",
      "Fable",
      "Sonnet",
      "Haiku",
    ]);
    expect(picker?.options.findIndex((option) => option.selected)).toBe(1);
    expect(picker?.effort).toBe("medium");
  });

  test("sees the result of the arrow keys", async () => {
    expect(parseModelPicker(await fixture("claude-picker-right.txt"))?.effort).toBe("high");

    const down = parseModelPicker(await fixture("claude-picker-down.txt"));

    expect(down?.options.find((option) => option.selected)?.label).toBe("Fable");
  });

  test("gives null when the picker is not open", () => {
    expect(parseModelPicker("❯ \n  -- INSERT --")).toBeNull();
  });
});

describe("parseDialog", () => {
  test("reads the question and the options of a dialog without numbers", () => {
    const screen = [
      "$ claude",
      "─".repeat(40),
      " Accessing workspace:",
      " /private/tmp/demo",
      " Quick safety check: Is this a project you trust?",
      " ❯ No, exit",
      "   Yes, I trust this folder",
      " Enter to confirm · Esc to cancel",
    ].join("\n");

    expect(parseDialog(screen)).toEqual({
      question:
        "Accessing workspace:\n/private/tmp/demo\nQuick safety check: Is this a project you trust?",
      options: [
        { label: "No, exit", selected: true },
        { label: "Yes, I trust this folder", selected: false },
      ],
    });
  });

  test("reads a numbered permission dialog", () => {
    const screen = [
      "─".repeat(40),
      " Bash command",
      "   rm -rf build",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again for rm commands",
      "   3. No, and tell Claude what to do differently (esc)",
    ].join("\n");

    expect(parseDialog(screen)?.options.map((option) => option.label)).toEqual([
      "Yes",
      "Yes, and don't ask again for rm commands",
      "No, and tell Claude what to do differently (esc)",
    ]);
  });
});

describe("parseDialog with the model confirm", () => {
  test("reads the question that Claude Code asks after a model change", () => {
    const screen = [
      "▔".repeat(40),
      "   Switch model?",
      "   Your next response will be slower and use more tokens",
      "   This conversation is cached for the current model.",
      "   ❯ 1. Yes, switch to Sonnet 5.5",
      "     2. No, go back",
    ].join("\n");

    expect(parseDialog(screen)).toEqual({
      question:
        "Switch model?\nYour next response will be slower and use more tokens\nThis conversation is cached for the current model.",
      options: [
        { label: "Yes, switch to Sonnet 5.5", selected: true },
        { label: "No, go back", selected: false },
      ],
    });
  });

  test("sees no question at the normal input box", () => {
    const rule = "─".repeat(40);

    expect(
      parseDialog([rule, "❯ ", rule, "  -- INSERT -- ⏵⏵ bypass permissions on"].join("\n")),
    ).toBeNull();
  });
});

describe("keys", () => {
  test("moves the cursor and the effort in the right direction", () => {
    expect(moveKeys(1, 3)).toEqual(["down", "down"]);
    expect(moveKeys(2, 0)).toEqual(["up", "up"]);
    expect(effortKeys("medium", "max")).toEqual(["right", "right", "right"]);
    expect(effortKeys("high", "low")).toEqual(["left", "left"]);
    expect(effortLevel("Extra high")).toBe("xhigh");
  });
});
