import { describe, expect, test } from "bun:test";

import { chooseKeys, parseOpencodeDialog } from "./opencode-tui.ts";

async function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`fixtures/${name}`, import.meta.url)).text();
}

describe("parseOpencodeDialog", () => {
  test("reads the question form from the real screen, without the custom answer", async () => {
    const dialog = parseOpencodeDialog(await fixture("opencode-question.txt"));

    expect(dialog?.kind).toBe("question");
    expect(dialog?.question).toBe("Do you prefer tabs or spaces?");
    expect(dialog?.options.map((option) => option.label)).toEqual(["Tabs", "Spaces"]);
  });

  test("asks to run the command of a real permission request", async () => {
    const dialog = parseOpencodeDialog(await fixture("opencode-permission.txt"));

    expect(dialog?.kind).toBe("permission");
    expect(dialog?.question).toBe("Run echo permission-test?");
    expect(dialog?.options.map((option) => option.label)).toEqual([
      "Allow once",
      "Always allow",
      "Reject",
    ]);
  });

  test("finds no dialog when the user prompt box is the last box", async () => {
    const screen = await fixture("opencode-question.txt");
    const before = screen.slice(0, screen.indexOf("→ Asked"));

    expect(parseOpencodeDialog(before)).toBeNull();
  });
});

describe("chooseKeys", () => {
  test("presses the digit of a question option", async () => {
    const dialog = parseOpencodeDialog(await fixture("opencode-question.txt"));

    expect(dialog && chooseKeys(dialog, 1)).toEqual(["2"]);
  });

  test("moves right to a permission option, and rejects with esc", async () => {
    const dialog = parseOpencodeDialog(await fixture("opencode-permission.txt"));

    expect(dialog && chooseKeys(dialog, 0)).toEqual(["enter"]);
    expect(dialog && chooseKeys(dialog, 1)).toEqual(["right", "enter"]);
    expect(dialog && chooseKeys(dialog, 2)).toEqual(["esc"]);
  });
});
