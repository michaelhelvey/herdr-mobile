import type { ChatItem } from "../../shared/history.ts";
import { isRecord } from "../../shared/parse.ts";
import { extractUploads } from "./claude-records.ts";
import type { ImageStore } from "./images.ts";
import type { RecordSink } from "./jsonl.ts";
import {
  capitalize,
  clip,
  MAX_OUTPUT,
  relative,
  stripAnsi,
  summarizeToolInput,
  text,
  toolOutput,
} from "./tool-text.ts";
import { diffForNewFile, parseUnifiedDiff } from "./unified-diff.ts";

type ToolItem = Extract<ChatItem, { type: "tool" }>;

type Entry = Record<string, unknown>;

/** The arguments of a tool call, which the tool result needs to make a diff. */
interface CallInfo {
  item: ToolItem;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Changes the entries of a pi session file into chat items. Give it the lines of the file in
 * order. Each entry has a `parentId`, so the file is a tree. The conversation is the path from the
 * last entry to the root. When an entry starts a new branch, it makes the items again from that
 * path, and `key` changes, so that the PWA drops the items of the old branch.
 */
export class PiTranscript implements RecordSink {
  items: ChatItem[] = [];
  model: string | null = null;
  effort: string | null = null;
  #sessionId = "pi";
  #cwd: string | null = null;
  #branch = 0;
  #leaf: string | null = null;
  #entries = new Map<string, Entry>();
  #calls = new Map<string, CallInfo>();

  constructor(
    private readonly images?: ImageStore,
    private readonly uploadDir: string | null = null,
  ) {}

  /** Identifies the session and the branch. */
  get key(): string {
    return this.#branch === 0 ? this.#sessionId : `${this.#sessionId}:${this.#branch}`;
  }

  add(entry: unknown): void {
    if (!isRecord(entry)) {
      return;
    }

    if (entry.type === "session") {
      this.#sessionId = text(entry.id) ?? this.#sessionId;
      this.#cwd = text(entry.cwd);

      return;
    }

    const id = text(entry.id);

    if (!id) {
      return;
    }

    this.#entries.set(id, entry);

    const parent = text(entry.parentId);

    if (this.#leaf !== null && parent !== this.#leaf) {
      this.#rebuild(id);
    } else {
      this.#apply(entry);
    }

    this.#leaf = id;
  }

  #rebuild(leaf: string): void {
    const path: Entry[] = [];
    const seen = new Set<string>();
    let current = this.#entries.get(leaf);

    while (current) {
      const id = text(current.id);

      if (!id || seen.has(id)) {
        break;
      }

      seen.add(id);
      path.push(current);

      const parent = text(current.parentId);

      current = parent ? this.#entries.get(parent) : undefined;
    }

    this.items = [];
    this.#calls.clear();
    this.model = null;
    this.effort = null;
    this.#branch++;

    for (const entry of path.reverse()) {
      this.#apply(entry);
    }
  }

  #apply(entry: Entry): void {
    const id = text(entry.id) ?? `item-${this.items.length}`;

    switch (entry.type) {
      case "model_change": {
        const provider = text(entry.provider);
        const model = text(entry.modelId);

        this.model = model && provider ? model.replace(`${provider}/`, "") : model;

        return;
      }

      case "thinking_level_change":
        this.effort = text(entry.thinkingLevel);

        return;

      case "compaction":
        this.items.push({ type: "notice", id, text: "Conversation compacted" });

        return;

      case "branch_summary":
        this.items.push({ type: "notice", id, text: "Moved to another branch" });

        return;

      case "custom_message":
        if (entry.display === true) {
          this.#addOutput(id, entry.content);
        }

        return;

      case "message":
        if (isRecord(entry.message)) {
          this.#addMessage(id, entry.message);
        }

        return;
    }
  }

  #addOutput(id: string, content: unknown): void {
    const body = toolOutput(content).trim();

    if (body) {
      this.items.push({ type: "output", id, text: body, markdown: true });
    }
  }

  #addMessage(id: string, message: Entry): void {
    switch (message.role) {
      case "user":
        this.#addUser(id, message.content);
        break;

      case "assistant":
        this.#addAssistant(id, message);
        break;

      case "toolResult":
        this.#addResult(message);
        break;

      case "bashExecution":
        this.items.push({
          type: "tool",
          id,
          name: "Bash",
          summary: text(message.command) ?? "",
          output: clip(stripAnsi(text(message.output) ?? ""), MAX_OUTPUT),
          isError: typeof message.exitCode === "number" && message.exitCode !== 0,
          diff: null,
        });
        break;

      case "custom":
        if (message.display === true) {
          this.#addOutput(id, message.content);
        }

        break;
    }
  }

  #addUser(id: string, content: unknown): void {
    const texts: string[] = [];
    const images: string[] = [];

    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      content.forEach((part, index) => {
        if (!isRecord(part)) {
          return;
        }

        if (part.type === "text" && typeof part.text === "string") {
          texts.push(part.text);
        } else if (part.type === "image" && typeof part.data === "string") {
          const imageId = `pi:${id}-${index}`;

          this.images?.put(imageId, text(part.mimeType) ?? "image/png", part.data);
          images.push(imageId);
        }
      });
    }

    const uploads = extractUploads(texts.join("\n"), this.uploadDir);
    const all = [...images, ...uploads.images];
    const body = uploads.text.trim();

    if (body || all.length > 0) {
      this.items.push({ type: "user", id, text: body, images: all });
    }
  }

  #addAssistant(id: string, message: Entry): void {
    const model = text(message.model);
    const provider = text(message.provider);

    if (model) {
      this.model = provider ? model.replace(`${provider}/`, "") : model;
    }

    const content = Array.isArray(message.content) ? message.content : [];

    content.forEach((part, index) => {
      if (!isRecord(part)) {
        return;
      }

      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        this.items.push({ type: "assistant", id: `${id}:${index}`, text: part.text.trim() });
      } else if (part.type === "toolCall" && typeof part.id === "string") {
        const name = text(part.name) ?? "tool";
        const args = isRecord(part.arguments) ? part.arguments : {};

        const item: ToolItem = {
          type: "tool",
          id: part.id,
          name: capitalize(name),
          summary: summarizeToolInput(name, args, this.#cwd),
          output: null,
          isError: false,
          diff: null,
        };

        this.#calls.set(part.id, { item, name, args });
        this.items.push(item);
      }
    });

    const error = text(message.errorMessage);

    if (message.stopReason === "aborted") {
      this.items.push({ type: "notice", id: `${id}:stop`, text: "Interrupted" });
    } else if (message.stopReason === "error" && error) {
      this.items.push({ type: "notice", id: `${id}:stop`, text: clip(error, 300) });
    }
  }

  #addResult(message: Entry): void {
    const callId = text(message.toolCallId);
    const call = callId ? this.#calls.get(callId) : undefined;

    if (!call) {
      return;
    }

    const { item, name, args } = call;

    item.output = clip(stripAnsi(toolOutput(message.content)), MAX_OUTPUT);
    item.isError = message.isError === true;

    if (item.isError) {
      return;
    }

    const path = text(args.path);
    const details = isRecord(message.details) ? message.details : {};
    const shown = path ? relative(path, this.#cwd) : null;

    if (name === "edit" && shown && typeof details.patch === "string") {
      item.diff = parseUnifiedDiff(details.patch, shown);
    } else if (name === "write" && shown && typeof args.content === "string") {
      const diff = diffForNewFile(shown, args.content);

      // pi does not tell if the file was new, so the card does not say "New".
      item.diff = diff && { ...diff, action: "update" };
    }
  }
}
