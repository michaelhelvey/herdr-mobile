import type { ChatItem, FileDiff } from "../../shared/history.ts";
import { isRecord } from "../../shared/parse.ts";
import type { ImageStore } from "./images.ts";
import {
  clip,
  firstStringArg,
  MAX_OUTPUT,
  relative,
  stripAnsi,
  text,
  toolOutput,
} from "./tool-text.ts";
import { DiffBuilder, diffForNewFile } from "./unified-diff.ts";

type ToolItem = Extract<ChatItem, { type: "tool" }>;

/** Gives one line that tells what a tool call does. */
export function summarizeTool(name: string, input: unknown, cwd: string | null): string {
  const args = isRecord(input) ? input : {};
  const path = text(args.file_path) ?? text(args.notebook_path) ?? text(args.path);

  switch (name) {
    case "Bash":
      return (text(args.command) ?? "").split("\n")[0]?.trim() ?? "";

    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return path ? relative(path, cwd) : name;

    case "Grep":
    case "Glob":
      return text(args.pattern) ?? name;

    case "WebFetch":
      return text(args.url) ?? name;

    case "WebSearch":
      return text(args.query) ?? name;

    case "Task":
    case "Agent":
      return text(args.description) ?? name;

    default:
      return firstStringArg(input);
  }
}

/** Gives a short name for a tool. MCP tools have long names such as `mcp__server__tool`. */
export function toolLabel(name: string): string {
  const parts = name.split("__");

  return name.startsWith("mcp__") && parts.length >= 3 ? (parts.at(-1) ?? name) : name;
}

/** Makes a diff from the `toolUseResult` of an Edit or Write tool call. */
export function diffFromResult(result: unknown, cwd: string | null): FileDiff | null {
  if (!isRecord(result) || typeof result.filePath !== "string") {
    return null;
  }

  const path = relative(result.filePath, cwd);

  if (result.type === "create" && typeof result.content === "string") {
    return diffForNewFile(path, result.content);
  }

  const builder = new DiffBuilder();

  for (const raw of Array.isArray(result.structuredPatch) ? result.structuredPatch : []) {
    if (!isRecord(raw) || !Array.isArray(raw.lines)) {
      continue;
    }

    let oldNo = typeof raw.oldStart === "number" ? raw.oldStart : 1;
    let newNo = typeof raw.newStart === "number" ? raw.newStart : 1;

    builder.hunk();

    for (const line of raw.lines) {
      if (typeof line !== "string" || line.startsWith("\\")) {
        continue;
      }

      const body = line.slice(1);

      if (line.startsWith("+")) {
        builder.push({ kind: "add", text: body, oldNo: null, newNo: newNo++ });
      } else if (line.startsWith("-")) {
        builder.push({ kind: "del", text: body, oldNo: oldNo++, newNo: null });
      } else {
        builder.push({ kind: "context", text: body, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }

  return builder.build(path, typeof result.oldString === "string" ? "edit" : "update");
}

/** Claude Code puts these marks in the text where the user pasted an image. */
const IMAGE_MARK = /\[Image #\d+\]/g;

/** The prefix of an image ID that is a file in the upload folder of the bridge. */
export const UPLOAD_IMAGE_PREFIX = "upload:";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds the paths of bridge uploads in the text of a user message. When the user sends a message
 * while Claude Code works, Claude Code does not change the pasted path into an image, so the path
 * stays in the text. Gives the text without the paths, and an image ID for each path.
 */
export function extractUploads(
  text: string,
  uploadDir: string | null,
): { text: string; images: string[] } {
  if (!uploadDir) {
    return { text, images: [] };
  }

  const images: string[] = [];

  const pattern = new RegExp(
    `${escapeRegExp(uploadDir)}/([0-9a-f-]{36}\\.(?:png|jpg|gif|webp))`,
    "g",
  );

  const rest = text.replace(pattern, (_match, name: string) => {
    images.push(`${UPLOAD_IMAGE_PREFIX}${name}`);

    return "";
  });

  return { text: images.length > 0 ? rest.replace(/^\s+/, "") : text, images };
}

/** Gives the text of a user message, or a notice for messages that Claude Code makes itself. */
function userItem(
  id: string,
  raw: string,
  pasted: string[] = [],
  uploadDir: string | null = null,
): ChatItem | null {
  const uploads = extractUploads(raw, uploadDir);
  const images = [...pasted, ...uploads.images];
  const value = uploads.text.replace(IMAGE_MARK, "").trim();

  if (images.length > 0) {
    return { type: "user", id, text: value, images };
  }

  if (
    value === "" ||
    value.startsWith("<local-command-") ||
    value.startsWith("<system-reminder>")
  ) {
    return null;
  }

  const command = /<command-name>([^<]+)<\/command-name>/.exec(value);

  if (command?.[1]) {
    return { type: "notice", id, text: command[1].trim() };
  }

  if (value.startsWith("[Request interrupted")) {
    return { type: "notice", id, text: "Interrupted" };
  }

  return { type: "user", id, text: value, images: [] };
}

/**
 * Changes the records of a Claude Code session file into chat items. Give it the records in the
 * order of the file. It joins each tool result to its tool call.
 */
export class ClaudeTranscript {
  readonly items: ChatItem[] = [];
  /** The model of the most recent answer. */
  model: string | null = null;
  /** The effort level of the most recent answer. */
  effort: string | null = null;
  #tools = new Map<string, ToolItem>();

  constructor(
    private readonly images?: ImageStore,
    private readonly uploadDir: string | null = null,
  ) {}

  /** Adds one parsed line of the session file. */
  add(entry: unknown): void {
    if (!isRecord(entry) || entry.isSidechain === true) {
      return;
    }

    if (entry.isMeta === true) {
      this.#addMarkdownOutput(entry);

      return;
    }

    const id = typeof entry.uuid === "string" ? entry.uuid : `item-${this.items.length}`;
    const cwd = typeof entry.cwd === "string" ? entry.cwd : null;

    if (entry.type === "attachment" && isRecord(entry.attachment)) {
      const prompt = entry.attachment.type === "queued_command" ? entry.attachment.prompt : null;
      const item = typeof prompt === "string" ? userItem(id, prompt, [], this.uploadDir) : null;

      if (item) {
        this.items.push(item);
      }

      return;
    }

    if (entry.type === "system" && entry.subtype === "local_command") {
      this.#addCommandOutput(id, entry.content);

      return;
    }

    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      this.items.push({ type: "notice", id, text: "Conversation compacted" });

      return;
    }

    const message = isRecord(entry.message) ? entry.message : null;

    if (!message) {
      return;
    }

    if (entry.type === "user") {
      this.#addUser(id, message.content, entry.toolUseResult, cwd);
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      if (typeof message.model === "string" && message.model.startsWith("claude-")) {
        this.model = message.model;
      }

      if (typeof entry.effort === "string") {
        this.effort = entry.effort;
      }

      this.#addAssistant(id, message.content, cwd);
    }
  }

  #addCommandOutput(id: string, content: unknown): void {
    if (typeof content !== "string") {
      return;
    }

    const output = /<local-command-std(?:out|err)>([\s\S]*?)<\/local-command-std(?:out|err)>/.exec(
      content,
    );

    if (output) {
      const text = stripAnsi(output[1] ?? "").trim();

      if (text) {
        this.items.push({ type: "output", id, text, markdown: false });
      }

      return;
    }

    const item = userItem(id, content);

    if (item) {
      this.items.push(item);
    }
  }

  /**
   * Some commands, such as `/context`, write their output again as Markdown for the model, in a
   * meta message after the output. The PWA shows the Markdown, because it reads better on a phone.
   */
  #addMarkdownOutput(entry: Record<string, unknown>): void {
    const last = this.items.at(-1);
    const content = isRecord(entry.message) ? entry.message.content : null;

    // Other meta messages, such as `<local-command-caveat>`, are notes for the model.
    if (
      last?.type === "output" &&
      !last.markdown &&
      typeof content === "string" &&
      !content.trimStart().startsWith("<")
    ) {
      last.text = content.trim();
      last.markdown = true;
    }
  }

  #addUser(id: string, content: unknown, result: unknown, cwd: string | null): void {
    if (typeof content === "string") {
      const item = userItem(id, content, [], this.uploadDir);

      if (item) {
        this.items.push(item);
      }

      return;
    }

    if (!Array.isArray(content)) {
      return;
    }

    const texts: string[] = [];
    const images: string[] = [];

    content.forEach((block, index) => {
      if (!isRecord(block)) {
        return;
      }

      const source = isRecord(block.source) ? block.source : null;

      if (block.type === "image" && source && typeof source.data === "string") {
        const imageId = `${id}-${index}`;
        const mediaType = typeof source.media_type === "string" ? source.media_type : "image/png";

        this.images?.put(imageId, mediaType, source.data);
        images.push(imageId);
      } else if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const tool = this.#tools.get(block.tool_use_id);

        if (tool) {
          tool.output = clip(toolOutput(block.content), MAX_OUTPUT);
          tool.isError = block.is_error === true;
          tool.diff = diffFromResult(result, cwd) ?? tool.diff;
        }
      }
    });

    const item =
      texts.length > 0 || images.length > 0
        ? userItem(id, texts.join("\n"), images, this.uploadDir)
        : null;

    if (item) {
      this.items.push(item);
    }
  }

  #addAssistant(id: string, content: unknown[], cwd: string | null): void {
    content.forEach((block, index) => {
      if (!isRecord(block)) {
        return;
      }

      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        this.items.push({ type: "assistant", id: `${id}:${index}`, text: block.text.trim() });
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const name = typeof block.name === "string" ? block.name : "tool";

        const tool: ToolItem = {
          type: "tool",
          id: block.id,
          name: toolLabel(name),
          summary: summarizeTool(name, block.input, cwd),
          output: null,
          isError: false,
          diff: null,
        };

        this.#tools.set(block.id, tool);
        this.items.push(tool);
      }
    });
  }
}
