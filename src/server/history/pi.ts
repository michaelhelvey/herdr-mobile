import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type CommandInfo,
  type DialogView,
  type HarnessControls,
  type ModelChange,
  modelLabel,
  type ModelOption,
} from "../../shared/harness.ts";
import type { History } from "../../shared/history.ts";
import { isRecord } from "../../shared/parse.ts";
import type { HerdrClient } from "../herdr.ts";
import { agentSession } from "./agent-session.ts";
import { commands, skills } from "./claude-commands.ts";
import type { ImageStore } from "./images.ts";
import { JsonlTail } from "./jsonl.ts";
import { PiTranscript } from "./pi-records.ts";
import type { HistoryProvider } from "./types.ts";
import { historyWindow } from "./window.ts";

/** Commands that pi has itself. The list has only commands that do not open a TUI menu. */
const BUILTIN: [string, string][] = [
  ["compact", "Make the conversation shorter to free context"],
  ["new", "Start a new session"],
  ["session", "Show information about this session"],
  ["copy", "Copy the last answer"],
  ["export", "Export the session to an HTML file"],
  ["reload", "Load the extensions, skills, and prompts again"],
];

/** The thinking levels that `/thinking` takes. */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** The time between the two commands of a model change, so that pi reads them one at a time. */
const COMMAND_GAP_MS = 600;

async function enabledModels(file: string): Promise<string[] | null> {
  const settings = await readFile(file, "utf8").then(
    (raw): unknown => JSON.parse(raw),
    () => null,
  );

  if (!isRecord(settings) || !Array.isArray(settings.enabledModels)) {
    return null;
  }

  return settings.enabledModels.filter(
    (model): model is string => typeof model === "string" && !/[*?]/.test(model),
  );
}

/**
 * Gives the models that the user cycles through in pi: `enabledModels` of the project settings,
 * else of the user settings. Patterns with wildcards are not models, so the list does not have
 * them.
 */
export async function piModels(cwd: string | null, home: string): Promise<ModelOption[]> {
  const project = cwd ? await enabledModels(join(cwd, ".pi", "settings.json")) : null;
  const models = project ?? (await enabledModels(join(home, "settings.json"))) ?? [];

  return models.map((alias) => ({ alias, label: modelLabel(alias) }));
}

/**
 * Gives the slash commands of pi for an agent that works in `cwd`: the commands of pi, then the
 * prompt templates and the skills (`/skill:name`) of the project and of the user.
 */
export async function piControls(
  cwd: string | null,
  home = join(homedir(), ".pi", "agent"),
): Promise<HarnessControls> {
  const project = cwd ? join(cwd, ".pi") : null;

  const lists = await Promise.all([
    project ? commands(join(project, "prompts")) : [],
    commands(join(home, "prompts")),
    project ? skills(join(project, "skills")) : [],
    skills(join(home, "skills")),
  ]);

  const seen = new Set<string>();
  const custom: CommandInfo[] = [];

  for (const command of lists.flat()) {
    const name = command.source === "skill" ? `skill:${command.name}` : command.name;

    if (!seen.has(name)) {
      seen.add(name);
      custom.push({ ...command, name });
    }
  }

  const builtins: CommandInfo[] = BUILTIN.map(([name, description]) => ({
    name,
    description,
    source: "builtin",
  }));

  return {
    commands: [...builtins, ...custom.sort((a, b) => a.name.localeCompare(b.name))],
    models: await piModels(cwd, home),
    efforts: THINKING_LEVELS,
    defaults: false,
  };
}

/**
 * Reads the history of pi. The Herdr integration of pi reports the path of the session file of
 * each pane, and Herdr gives it in `agent.get`. pi writes the file at the first message.
 */
export class PiHistory implements HistoryProvider {
  #files = new Map<string, JsonlTail<PiTranscript>>();

  constructor(
    private readonly client: HerdrClient,
    private readonly images: ImageStore,
    private readonly uploadDir: string | null = null,
  ) {}

  async load(paneId: string, since: number | null): Promise<History | null> {
    const session = await agentSession(this.client, paneId);

    if (session?.kind !== "path" || !session.value.endsWith(".jsonl")) {
      return null;
    }

    let file = this.#files.get(session.value);

    if (!file) {
      file = new JsonlTail(session.value, () => new PiTranscript(this.images, this.uploadDir));
      this.#files.set(session.value, file);
    }

    const transcript = await file.read().catch(() => null);

    return transcript && historyWindow(transcript, since);
  }

  controls(cwd: string | null): Promise<HarnessControls> {
    return piControls(cwd);
  }

  dialog(): Promise<DialogView | null> {
    return Promise.resolve(null);
  }

  choose(): Promise<void> {
    return Promise.reject(new Error("the bridge cannot answer questions of pi agents"));
  }

  /** Sends `/thinking <level>`, then `/model <provider/id>`. pi does both without a menu. */
  async setModel(paneId: string, change: ModelChange): Promise<void> {
    if (change.effort) {
      await this.client.request("agent.prompt", {
        target: paneId,
        text: `/thinking ${change.effort}`,
      });
      await Bun.sleep(COMMAND_GAP_MS);
    }

    await this.client.request("agent.prompt", { target: paneId, text: `/model ${change.model}` });
  }
}
