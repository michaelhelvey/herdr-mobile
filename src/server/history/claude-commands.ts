import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

import type { CommandInfo, HarnessControls } from "../../shared/harness.ts";
import { EFFORT_ORDER } from "./claude-tui.ts";

/**
 * Commands that Claude Code has itself. The list has only commands that do not open a TUI menu,
 * because the PWA does not show the terminal. The model chip changes the model.
 */
const BUILTIN: [string, string][] = [
  ["compact", "Make the conversation shorter to free context"],
  ["clear", "Start a new conversation"],
  ["context", "Show how much context the conversation uses"],
  ["cost", "Show the cost of this session"],
  ["review", "Review a pull request"],
  ["security-review", "Do a security review of the changes"],
  ["init", "Make a CLAUDE.md for this project"],
];

/** The models in the model picker of Claude Code. */
const MODELS = [
  { alias: "opus", label: "Opus" },
  { alias: "fable", label: "Fable" },
  { alias: "sonnet", label: "Sonnet" },
  { alias: "haiku", label: "Haiku" },
];

/** Reads the `key: value` lines of the front matter of a Markdown file. */
export function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};

  for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);

    if (field?.[1] && field[2] !== undefined) {
      fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }

  return fields;
}

function firstLine(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  return (
    body
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? ""
  );
}

/** Reads the skills in `dir`. Each skill is a folder with a `SKILL.md` file. */
export async function skills(dir: string): Promise<CommandInfo[]> {
  const names = await readdir(dir).catch(() => []);

  const found = await Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(dir, name, "SKILL.md"), "utf8").catch(() => null);

      if (text === null) {
        return null;
      }

      const meta = frontMatter(text);

      const command: CommandInfo = {
        name: meta.name || name,
        description: meta.description ?? "",
        source: "skill",
      };

      return command;
    }),
  );

  return found.filter((command) => command !== null);
}

/** Reads the custom commands in `dir`. Each command is a Markdown file. */
export async function commands(dir: string): Promise<CommandInfo[]> {
  const files = await readdir(dir, { recursive: true }).catch(() => []);

  const found = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        const text = await readFile(join(dir, file), "utf8").catch(() => "");

        const command: CommandInfo = {
          name: relative("", file).replace(/\.md$/, "").split("/").join(":"),
          description: frontMatter(text).description ?? firstLine(text),
          source: "command",
        };

        return command;
      }),
  );

  return found;
}

/**
 * Gives the slash commands, models, and effort levels of Claude Code for an agent that works in
 * `cwd`. The commands are the commands of Claude Code, then the skills and the custom commands of
 * the project and of the user, sorted by name. A project command hides a user command with the same
 * name.
 */
export async function claudeControls(
  cwd: string | null,
  home = join(homedir(), ".claude"),
): Promise<HarnessControls> {
  const project = cwd ? join(cwd, ".claude") : null;

  const lists = await Promise.all([
    project ? skills(join(project, "skills")) : [],
    project ? commands(join(project, "commands")) : [],
    skills(join(home, "skills")),
    commands(join(home, "commands")),
  ]);

  const seen = new Set<string>();

  const all: CommandInfo[] = BUILTIN.map(([name, description]) => ({
    name,
    description,
    source: "builtin",
  }));

  for (const command of [...all, ...lists.flat()]) {
    if (!seen.has(command.name)) {
      seen.add(command.name);

      if (command.source !== "builtin") {
        all.push(command);
      }
    }
  }

  const builtins = all.filter((command) => command.source === "builtin");

  const custom = all
    .filter((command) => command.source !== "builtin")
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    commands: [...builtins, ...custom],
    models: MODELS,
    efforts: [...EFFORT_ORDER],
    defaults: true,
  };
}
