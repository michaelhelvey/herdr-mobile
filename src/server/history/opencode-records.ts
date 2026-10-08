import type { ChatItem, FileDiff } from "../../shared/history.ts";
import { isRecord } from "../../shared/parse.ts";
import { extractUploads } from "./claude-records.ts";
import type { ImageStore } from "./images.ts";
import {
  capitalize,
  clip,
  firstLine,
  MAX_OUTPUT,
  relative,
  stripAnsi,
  summarizeToolInput,
  text,
  toolOutput,
} from "./tool-text.ts";
import { diffForNewFile, parseUnifiedDiff } from "./unified-diff.ts";

type ToolItem = Extract<ChatItem, { type: "tool" }>;

/** The model of an OpenCode message: `model: { id, providerID, variant }`. */
export interface OpencodeModel {
  id: string;
  /** The reasoning variant, or `null` for the default variant. */
  variant: string | null;
}

/** The chat items of one row of `session_message`, and the model of the row if it has one. */
export interface RowItems {
  items: ChatItem[];
  model: OpencodeModel | null;
}

/** What the bridge needs to change one row into chat items. */
export interface RowContext {
  /** The directory of the session. Tool paths in it become relative. */
  cwd: string | null;
  images?: ImageStore;
  uploadDir?: string | null;
}

function parseModel(value: unknown): OpencodeModel | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const variant = text(value.variant);

  return { id: value.id, variant: variant && variant !== "default" ? variant : null };
}

/** The files of a patch: `*** Update File: a.ts`, `*** Add File: b.md`, `*** Delete File: c`. */
function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].flatMap((match) =>
    match[1] ? [match[1].trim()] : [],
  );
}

function summarize(name: string, input: unknown, cwd: string | null): string {
  const args = isRecord(input) ? input : {};

  if (name === "patch" && typeof args.patchText === "string") {
    return patchFiles(args.patchText)
      .map((file) => relative(file, cwd))
      .join(", ");
  }

  if (name === "question" && Array.isArray(args.questions)) {
    const first: unknown = args.questions[0];

    return isRecord(first) ? (text(first.question) ?? "") : "";
  }

  return summarizeToolInput(name, input, cwd);
}

/** Makes the diffs of an `edit`, `write`, or `patch` tool from `metadata.files`. */
function fileDiffs(
  name: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  cwd: string | null,
): FileDiff[] {
  const files = Array.isArray(metadata.files) ? metadata.files : [];

  const diffs = files.flatMap((raw): FileDiff[] => {
    if (!isRecord(raw) || typeof raw.file !== "string" || typeof raw.patch !== "string") {
      return [];
    }

    const diff = parseUnifiedDiff(raw.patch, relative(raw.file, cwd));

    if (!diff) {
      return [];
    }

    return [raw.status === "added" ? { ...diff, action: "create" } : diff];
  });

  if (diffs.length === 0 && name === "write") {
    const path = text(input.path) ?? text(input.filePath);
    const content = text(input.content);
    const diff = path && content !== null ? diffForNewFile(relative(path, cwd), content) : null;

    // The write tool does not always keep its metadata, so the bridge does not know if the
    // file was new. The card does not say "New".
    return diff ? [{ ...diff, action: "update" }] : [];
  }

  return diffs;
}

/** Changes one tool part of an assistant message into one or more items. */
function toolItems(part: Record<string, unknown>, cwd: string | null): ToolItem[] {
  const id = text(part.id) ?? "tool";
  const name = text(part.name) ?? "tool";
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : {};
  const metadata = isRecord(state.metadata) ? state.metadata : {};
  const error = isRecord(state.error) ? text(state.error.message) : null;

  let output: string | null = null;
  let isError = false;

  if (state.status === "completed") {
    output = toolOutput(state.content);
  } else if (state.status === "error") {
    output = error ?? (toolOutput(state.content) || "Failed");
    isError = true;
  }

  if (name === "shell" && typeof metadata.exit === "number" && metadata.exit !== 0) {
    isError = true;
  }

  const base: ToolItem = {
    type: "tool",
    id,
    name: capitalize(name),
    summary: summarize(name, input, cwd),
    output: output === null ? null : clip(stripAnsi(output), MAX_OUTPUT),
    isError,
    diff: null,
  };

  const diffs = isError ? [] : fileDiffs(name, input, metadata, cwd);

  if (diffs.length === 0) {
    return [base];
  }

  return diffs.map((diff, index) => ({
    ...base,
    id: index === 0 ? id : `${id}:${index}`,
    summary: diff.path,
    diff,
  }));
}

function userItems(id: string, data: Record<string, unknown>, context: RowContext): ChatItem[] {
  const images: string[] = [];
  const files = Array.isArray(data.files) ? data.files : [];

  files.forEach((file, index) => {
    if (!isRecord(file) || typeof file.data !== "string") {
      return;
    }

    const mime = text(file.mime) ?? "";
    const source = isRecord(file.source) ? file.source : {};

    if (mime.startsWith("image/") && source.type === "inline") {
      const imageId = `opencode:${id}-${index}`;

      context.images?.put(imageId, mime, file.data);
      images.push(imageId);
    }
  });

  const uploads = extractUploads(text(data.text) ?? "", context.uploadDir ?? null);
  const all = [...images, ...uploads.images];
  const body = uploads.text.trim();

  return body || all.length > 0 ? [{ type: "user", id, text: body, images: all }] : [];
}

function assistantItems(id: string, data: Record<string, unknown>, cwd: string | null): ChatItem[] {
  const items: ChatItem[] = [];
  const content = Array.isArray(data.content) ? data.content : [];

  content.forEach((part, index) => {
    if (!isRecord(part)) {
      return;
    }

    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      items.push({ type: "assistant", id: `${id}:${index}`, text: part.text.trim() });
    } else if (part.type === "tool") {
      items.push(...toolItems(part, cwd));
    }
  });

  const error = isRecord(data.error) ? data.error : null;

  if (error && error.type !== "aborted") {
    const message = text(error.message) ?? "The answer failed";

    items.push({ type: "notice", id: `${id}:error`, text: clip(message, 300) });
  }

  return items;
}

/** Changes one row of the `session_message` table of OpenCode into chat items. */
export function rowItems(id: string, type: string, data: unknown, context: RowContext): RowItems {
  if (!isRecord(data)) {
    return { items: [], model: null };
  }

  switch (type) {
    case "user":
      return { items: userItems(id, data, context), model: null };

    case "assistant":
      return { items: assistantItems(id, data, context.cwd), model: parseModel(data.model) };

    case "model-switched":
      return { items: [], model: parseModel(data.model) };

    case "shell": {
      const exit = typeof data.exit === "number" ? data.exit : null;
      const done = data.status !== "running";

      return {
        items: [
          {
            type: "tool",
            id,
            name: "Shell",
            summary: firstLine(text(data.command) ?? ""),
            output: done ? clip(stripAnsi(text(data.output) ?? ""), MAX_OUTPUT) : null,
            isError: data.status === "timeout" || data.status === "killed" || (exit ?? 0) !== 0,
            diff: null,
          },
        ],
        model: null,
      };
    }

    case "compaction":
      return data.status === "completed"
        ? { items: [{ type: "notice", id, text: "Conversation compacted" }], model: null }
        : { items: [], model: null };

    case "agent-switched": {
      const agent = text(data.agent);

      return {
        items: agent ? [{ type: "notice", id, text: `Agent: ${agent}` }] : [],
        model: null,
      };
    }

    case "idle":
      return data.outcome === "interrupted"
        ? { items: [{ type: "notice", id, text: "Interrupted" }], model: null }
        : { items: [], model: null };

    case "synthetic": {
      const description = text(data.description);

      return {
        items: description ? [{ type: "notice", id, text: description }] : [],
        model: null,
      };
    }

    default:
      return { items: [], model: null };
  }
}
