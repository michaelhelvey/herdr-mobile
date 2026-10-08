import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { DialogView, HarnessControls, ModelChange } from "../../shared/harness.ts";
import type { History } from "../../shared/history.ts";
import { claudeControls } from "./claude-commands.ts";
import { ClaudeTui, parseDialog } from "./claude-tui.ts";
import { array, isRecord, record } from "../../shared/parse.ts";
import type { HerdrClient } from "../herdr.ts";
import { ClaudeTranscript } from "./claude-records.ts";
import type { ImageStore } from "./images.ts";
import type { HistoryProvider } from "./types.ts";

/** The most items that the bridge sends in a first load. */
const MAX_ITEMS = 200;

/**
 * The number of items before `since` that the bridge sends again. A tool result changes its tool
 * call, which can be a few items back.
 */
const RESEND = 12;

/** The time that the bridge keeps the session file of a pane before it looks again. */
const LOCATE_TTL_MS = 5000;

const SESSION_ID = /^[0-9a-f-]{36}$/;

/** Gives the folder name that Claude Code uses for the sessions of a working directory. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Reads a growing JSONL file. Each call parses only the lines that are new since the last call. */
class SessionFile {
  #offset = 0;
  #transcript: ClaudeTranscript;

  constructor(
    readonly path: string,
    private readonly images: ImageStore,
    private readonly uploadDir: string | null,
  ) {
    this.#transcript = new ClaudeTranscript(images, uploadDir);
  }

  async read(): Promise<ClaudeTranscript> {
    const { size } = await stat(this.path);

    if (size < this.#offset) {
      this.#offset = 0;
      this.#transcript = new ClaudeTranscript(this.images, this.uploadDir);
    }

    if (size === this.#offset) {
      return this.#transcript;
    }

    const handle = await open(this.path, "r");

    try {
      const bytes = new Uint8Array(size - this.#offset);

      await handle.read(bytes, 0, bytes.length, this.#offset);

      const end = bytes.lastIndexOf(10);

      if (end === -1) {
        return this.#transcript;
      }

      const chunk = new TextDecoder().decode(bytes.subarray(0, end));

      this.#offset += end + 1;

      for (const line of chunk.split("\n")) {
        if (line.trim()) {
          try {
            this.#transcript.add(JSON.parse(line));
          } catch {
            // A line that is not valid JSON is not a record. Claude Code can write it later again.
          }
        }
      }

      return this.#transcript;
    } finally {
      await handle.close();
    }
  }
}

/**
 * Reads the history of Claude Code. Herdr gives the processes in the pane. Claude Code writes
 * `~/.claude/sessions/<pid>.json` with the session ID of each process, and the session is in
 * `~/.claude/projects/<cwd slug>/<session id>.jsonl`.
 */
export class ClaudeHistory implements HistoryProvider {
  #files = new Map<string, SessionFile>();
  #located = new Map<string, { path: string | null; at: number }>();

  constructor(
    private readonly client: HerdrClient,
    private readonly images: ImageStore,
    private readonly uploadDir: string | null = null,
    private readonly home = join(homedir(), ".claude"),
  ) {}

  async load(paneId: string, since: number | null): Promise<History | null> {
    const path = await this.#locate(paneId);

    if (!path) {
      return null;
    }

    let file = this.#files.get(path);

    if (!file) {
      file = new SessionFile(path, this.images, this.uploadDir);
      this.#files.set(path, file);
    }

    const { items, model, effort } = await file.read();
    const total = items.length;

    const start =
      since === null || since > total
        ? Math.max(0, total - MAX_ITEMS)
        : Math.max(0, since - RESEND);

    return {
      key: basename(path, ".jsonl"),
      total,
      start,
      items: items.slice(start),
      model,
      effort,
    };
  }

  controls(cwd: string | null): Promise<HarnessControls> {
    return claudeControls(cwd);
  }

  async dialog(paneId: string): Promise<DialogView | null> {
    return parseDialog(await new ClaudeTui(this.client, paneId).screen());
  }

  choose(paneId: string, index: number, labels: string[]): Promise<void> {
    return new ClaudeTui(this.client, paneId).choose(index, labels);
  }

  setModel(paneId: string, change: ModelChange): Promise<void> {
    return new ClaudeTui(this.client, paneId).setModel(change);
  }

  async #locate(paneId: string): Promise<string | null> {
    const cached = this.#located.get(paneId);

    if (cached && Date.now() - cached.at < LOCATE_TTL_MS) {
      return cached.path;
    }

    const path = await this.#findSession(paneId);

    this.#located.set(paneId, { path, at: Date.now() });

    return path;
  }

  async #findSession(paneId: string): Promise<string | null> {
    const result = record(
      await this.client.request("pane.process_info", { pane_id: paneId }),
      "result",
    );

    const info = record(result.process_info, "result.process_info");

    const pids = array(info.foreground_processes, "foreground_processes").flatMap((process) =>
      isRecord(process) && typeof process.pid === "number" ? [process.pid] : [],
    );

    for (const pid of pids) {
      const session = await readFile(join(this.home, "sessions", `${pid}.json`), "utf8").then(
        (raw): unknown => JSON.parse(raw),
        () => null,
      );

      if (!isRecord(session) || typeof session.sessionId !== "string") {
        continue;
      }

      if (!SESSION_ID.test(session.sessionId)) {
        continue;
      }

      const file = `${session.sessionId}.jsonl`;
      const projects = join(this.home, "projects");

      if (typeof session.cwd === "string") {
        const direct = join(projects, projectSlug(session.cwd), file);

        if (await exists(direct)) {
          return direct;
        }
      }

      for (const folder of await readdir(projects).catch(() => [])) {
        const candidate = join(projects, folder, file);

        if (await exists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }
}
