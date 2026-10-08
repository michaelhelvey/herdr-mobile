import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CommandInfo, DialogView, HarnessControls } from "../../shared/harness.ts";
import type { ChatItem, History } from "../../shared/history.ts";
import { isRecord } from "../../shared/parse.ts";
import type { HerdrClient } from "../herdr.ts";
import { agentSession } from "./agent-session.ts";
import { commands } from "./claude-commands.ts";
import type { ImageStore } from "./images.ts";
import { type OpencodeModel, rowItems, type RowItems } from "./opencode-records.ts";
import { OpencodeTui } from "./opencode-tui.ts";
import type { HistoryProvider } from "./types.ts";
import { historyWindow } from "./window.ts";

/** The row types that make chat items or change the model. The bridge does not read others. */
const ROW_TYPES = [
  "user",
  "assistant",
  "model-switched",
  "shell",
  "compaction",
  "agent-switched",
  "idle",
  "synthetic",
];

/** When more rows than this changed, the bridge reads all rows in one query. */
const BULK_READ = 24;

const SESSION_ID = /^ses_[A-Za-z0-9]+$/;

/** Commands that OpenCode has itself. The list has only commands that do not open a TUI menu. */
const BUILTIN: [string, string][] = [
  ["compact", "Make the conversation shorter to free context"],
  ["new", "Start a new session"],
  ["undo", "Undo the last message and its file changes"],
  ["redo", "Redo the message that undo removed"],
  ["share", "Share this session"],
  ["copy", "Copy the session transcript"],
];

/** Gives the path of the OpenCode database. `OPENCODE_DB` and `XDG_DATA_HOME` change it. */
export function opencodeDatabasePath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.OPENCODE_DB) {
    return env.OPENCODE_DB;
  }

  const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share");

  return join(data, "opencode", "opencode.db");
}

/**
 * Gives the slash commands of OpenCode for an agent that works in `cwd`: the commands of OpenCode,
 * then the custom commands of the project and of the user.
 */
export async function opencodeControls(
  cwd: string | null,
  config = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode"),
): Promise<HarnessControls> {
  const project = cwd ? join(cwd, ".opencode") : null;

  const lists = await Promise.all([
    project ? commands(join(project, "command")) : [],
    project ? commands(join(project, "commands")) : [],
    commands(join(config, "command")),
    commands(join(config, "commands")),
  ]);

  const seen = new Set(BUILTIN.map(([name]) => name));
  const custom: CommandInfo[] = [];

  for (const command of lists.flat()) {
    if (!seen.has(command.name)) {
      seen.add(command.name);
      custom.push(command);
    }
  }

  const builtins: CommandInfo[] = BUILTIN.map(([name, description]) => ({
    name,
    description,
    source: "builtin",
  }));

  return {
    commands: [...builtins, ...custom.sort((a, b) => a.name.localeCompare(b.name))],
    models: [],
    efforts: [],
    defaults: false,
  };
}

interface CachedRow {
  updated: number;
  result: RowItems;
}

function rowMeta(row: unknown): { id: string; type: string; updated: number }[] {
  if (!isRecord(row)) {
    return [];
  }

  const { id, type, time_updated: updated } = row;

  return typeof id === "string" && typeof type === "string" && typeof updated === "number"
    ? [{ id, type, updated }]
    : [];
}

function parseData(row: unknown): unknown {
  if (!isRecord(row) || typeof row.data !== "string") {
    return null;
  }

  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Reads the history of OpenCode v2. OpenCode keeps all sessions in one SQLite database. The Herdr
 * plugin of OpenCode reports the ID of the session that the TUI in each pane shows, and Herdr
 * gives it in `agent.get`. The bridge opens the database read only. OpenCode uses WAL mode, so
 * the bridge can read while OpenCode writes.
 */
export class OpencodeHistory implements HistoryProvider {
  #db: Database | null = null;
  #rows = new Map<string, Map<string, CachedRow>>();

  constructor(
    private readonly client: HerdrClient,
    private readonly images: ImageStore,
    private readonly uploadDir: string | null = null,
    private readonly path = opencodeDatabasePath(),
  ) {}

  async load(paneId: string, since: number | null): Promise<History | null> {
    const session = await agentSession(this.client, paneId);

    if (session?.kind !== "id" || !SESSION_ID.test(session.value)) {
      return null;
    }

    try {
      return this.#read(session.value, since);
    } catch {
      // The database can be locked for a moment, or OpenCode can make it again. Open it again.
      this.#db?.close();
      this.#db = null;

      return null;
    }
  }

  controls(cwd: string | null): Promise<HarnessControls> {
    return opencodeControls(cwd);
  }

  async dialog(paneId: string): Promise<DialogView | null> {
    const dialog = await new OpencodeTui(this.client, paneId).dialog();

    return dialog && { question: dialog.question, options: dialog.options };
  }

  choose(paneId: string, index: number, labels: string[]): Promise<void> {
    return new OpencodeTui(this.client, paneId).choose(index, labels);
  }

  setModel(): Promise<void> {
    return Promise.reject(new Error("the bridge cannot change the model of OpenCode agents"));
  }

  #database(): Database {
    if (!this.#db) {
      this.#db = new Database(this.path, { readonly: true });
      this.#db.run("PRAGMA busy_timeout = 2000");
    }

    return this.#db;
  }

  #read(sessionId: string, since: number | null): History | null {
    const db = this.#database();
    const found = db.query("SELECT directory FROM session_v2 WHERE id = ?").get(sessionId);

    if (!found) {
      return null;
    }

    const cwd = isRecord(found) && typeof found.directory === "string" ? found.directory : null;

    const placeholders = ROW_TYPES.map(() => "?").join(", ");

    const metas = db
      .query(
        `SELECT id, type, time_updated FROM session_message
         WHERE session_id = ? AND type IN (${placeholders}) ORDER BY seq`,
      )
      .all(sessionId, ...ROW_TYPES)
      .flatMap(rowMeta);

    const cache = this.#rows.get(sessionId) ?? new Map<string, CachedRow>();
    const changed = metas.filter((meta) => cache.get(meta.id)?.updated !== meta.updated);
    const context = { cwd, images: this.images, uploadDir: this.uploadDir };

    if (changed.length > BULK_READ) {
      const all = db
        .query(
          `SELECT id, data FROM session_message
           WHERE session_id = ? AND type IN (${placeholders})`,
        )
        .all(sessionId, ...ROW_TYPES);

      const data = new Map(
        all.flatMap((row) =>
          isRecord(row) && typeof row.id === "string" ? [[row.id, parseData(row)] as const] : [],
        ),
      );

      for (const meta of changed) {
        cache.set(meta.id, {
          updated: meta.updated,
          result: rowItems(meta.id, meta.type, data.get(meta.id), context),
        });
      }
    } else {
      const one = db.query("SELECT data FROM session_message WHERE id = ?");

      for (const meta of changed) {
        cache.set(meta.id, {
          updated: meta.updated,
          result: rowItems(meta.id, meta.type, parseData(one.get(meta.id)), context),
        });
      }
    }

    this.#rows.set(sessionId, cache);

    const items: ChatItem[] = [];
    let model: OpencodeModel | null = null;

    for (const meta of metas) {
      const result = cache.get(meta.id)?.result;

      if (result) {
        items.push(...result.items);
        model = result.model ?? model;
      }
    }

    return historyWindow(
      { key: sessionId, items, model: model?.id ?? null, effort: model?.variant ?? null },
      since,
    );
  }
}
