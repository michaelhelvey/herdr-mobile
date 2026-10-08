import { describe, expect, test } from "bun:test";

import { type CommandInfo, filterCommands, modelLabel } from "./harness.ts";

function command(name: string, description = ""): CommandInfo {
  return { name, description, source: "builtin" };
}

describe("filterCommands", () => {
  test("puts names that start with the query before names and descriptions that contain it", () => {
    const commands = [command("security-review"), command("review"), command("pr", "Review it")];

    expect(filterCommands(commands, "/rev").map((c) => c.name)).toEqual([
      "review",
      "security-review",
      "pr",
    ]);
  });

  test("gives all commands for a slash alone", () => {
    expect(filterCommands([command("a"), command("b")], "")).toHaveLength(2);
  });
});

describe("modelLabel", () => {
  test("makes a short name from a Claude model ID", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-5-5-20260901")).toBe("Sonnet 5.5");
    expect(modelLabel("gpt-6")).toBe("gpt-6");
  });
});
