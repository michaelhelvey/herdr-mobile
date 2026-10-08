import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claudeControls, frontMatter } from "./claude-commands.ts";

async function write(path: string, text: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

describe("frontMatter", () => {
  test("reads the fields and removes quotes", () => {
    expect(frontMatter('---\nname: pr\ndescription: "Use when: making a PR"\n---\n# body')).toEqual(
      { name: "pr", description: "Use when: making a PR" },
    );
  });
});

describe("claudeControls", () => {
  test("lists skills and commands of the project and the user, and a project command wins", async () => {
    const root = await mkdtemp(join(tmpdir(), "herdr-commands-"));
    const home = join(root, "home");
    const cwd = join(root, "project");

    await write(join(home, "skills", "jira", "SKILL.md"), "---\ndescription: Works with Jira\n---");
    await write(join(home, "commands", "ship.md"), "---\ndescription: User ship\n---");
    await write(join(cwd, ".claude", "commands", "ship.md"), "# Project ship\nsteps");
    await write(join(cwd, ".claude", "commands", "db", "reset.md"), "Reset the database");

    const { commands } = await claudeControls(cwd, home);
    const custom = commands.filter((command) => command.source !== "builtin");

    expect(commands[0]).toMatchObject({ name: "compact", source: "builtin" });
    expect(custom).toEqual([
      { name: "db:reset", description: "Reset the database", source: "command" },
      { name: "jira", description: "Works with Jira", source: "skill" },
      { name: "ship", description: "Project ship", source: "command" },
    ]);
  });
});
