import { array, isRecord, number, optionalString, ParseError, record, string } from "./parse.ts";

/** One line of a diff. A line number is `null` on the side that does not have the line. */
export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** One hunk of a diff: lines that changed and the lines around them. */
export interface DiffHunk {
  lines: DiffLine[];
}

/** The change that a tool made to one file. */
export interface FileDiff {
  path: string;
  /** `create` makes a new file. `edit` and `update` change a file. */
  action: "create" | "edit" | "update";
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** The bridge removed lines to keep the message small. */
  truncated: boolean;
}

/** One item of a conversation, in the order that it happened. */
export type ChatItem =
  | {
      type: "user";
      id: string;
      text: string;
      /** The IDs of the images in the message. The PWA gets each from `/api/image/<id>`. */
      images: string[];
    }
  | { type: "assistant"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      /** The tool name, for example `Bash` or `Edit`. */
      name: string;
      /** One line that tells what the tool did, for example the command or the file. */
      summary: string;
      /** The result of the tool, or `null` if it did not complete yet. */
      output: string | null;
      isError: boolean;
      diff: FileDiff | null;
    }
  | { type: "notice"; id: string; text: string }
  | {
      type: "output";
      id: string;
      /** The output of a slash command. */
      text: string;
      /** The text is Markdown. Else it is plain text. */
      markdown: boolean;
    };

/**
 * A part of the conversation of one agent, from the session files of the agent harness. The
 * bridge sends only the items from `start`, so that a poll does not send the full conversation
 * again. Items before `start` that the PWA has already do not change.
 */
export interface History {
  /** Identifies the session. When it changes, the PWA must drop the items that it has. */
  key: string;
  /** The number of items in the full conversation. */
  total: number;
  /** The index of the first item in `items`. */
  start: number;
  items: ChatItem[];
  /** The model of the most recent answer, for example `claude-opus-5-5`, or `null`. */
  model: string | null;
  /** The effort level of the most recent answer, or `null`. */
  effort: string | null;
}

/** The items that the PWA keeps for one agent. */
export interface HistoryState {
  key: string;
  /** The index of `items[0]` in the full conversation. */
  base: number;
  items: ChatItem[];
  model: string | null;
  effort: string | null;
}

/** Adds a part of the history to the items that the PWA has. */
export function applyHistory(current: HistoryState | null, next: History): HistoryState {
  if (!current || current.key !== next.key || next.start < current.base) {
    return {
      key: next.key,
      base: next.start,
      items: next.items,
      model: next.model,
      effort: next.effort,
    };
  }

  const keep = Math.min(current.items.length, next.start - current.base);

  return {
    key: next.key,
    base: current.base,
    items: [...current.items.slice(0, keep), ...next.items],
    model: next.model,
    effort: next.effort,
  };
}

function parseDiff(value: unknown): FileDiff | null {
  if (value === null || value === undefined) {
    return null;
  }

  const diff = record(value, "diff");
  const action = diff.action;

  if (action !== "create" && action !== "edit" && action !== "update") {
    throw new ParseError("diff.action: expected create, edit, or update");
  }

  return {
    path: string(diff.path, "diff.path"),
    action,
    added: number(diff.added, "diff.added"),
    removed: number(diff.removed, "diff.removed"),
    truncated: diff.truncated === true,
    hunks: array(diff.hunks, "diff.hunks").map((hunk) => ({
      lines: array(record(hunk, "hunk").lines, "hunk.lines").map((raw) => {
        const line = record(raw, "line");
        const kind = line.kind;

        if (kind !== "context" && kind !== "add" && kind !== "del") {
          throw new ParseError("line.kind: expected context, add, or del");
        }

        return {
          kind,
          text: string(line.text, "line.text"),
          oldNo: typeof line.oldNo === "number" ? line.oldNo : null,
          newNo: typeof line.newNo === "number" ? line.newNo : null,
        };
      }),
    })),
  };
}

function parseItem(value: unknown, path: string): ChatItem {
  const item = record(value, path);
  const id = string(item.id, `${path}.id`);

  switch (item.type) {
    case "user":
      return {
        type: "user",
        id,
        text: string(item.text, `${path}.text`),
        images: array(item.images ?? [], `${path}.images`).map((image, index) =>
          string(image, `${path}.images[${index}]`),
        ),
      };

    case "output":
      return {
        type: "output",
        id,
        text: string(item.text, `${path}.text`),
        markdown: item.markdown === true,
      };

    case "assistant":
    case "notice":
      return { type: item.type, id, text: string(item.text, `${path}.text`) };

    case "tool":
      return {
        type: "tool",
        id,
        name: string(item.name, `${path}.name`),
        summary: string(item.summary, `${path}.summary`),
        output: optionalString(item.output, `${path}.output`),
        isError: item.isError === true,
        diff: parseDiff(item.diff),
      };

    default:
      throw new ParseError(`${path}.type: expected user, assistant, tool, or notice`);
  }
}

/** Parses the result of a `history` call. */
export function parseHistory(value: unknown): History {
  if (!isRecord(value)) {
    throw new ParseError("history: expected an object");
  }

  return {
    key: string(value.key, "history.key"),
    total: number(value.total, "history.total"),
    start: number(value.start, "history.start"),
    items: array(value.items, "history.items").map((item, index) =>
      parseItem(item, `history.items[${index}]`),
    ),
    model: optionalString(value.model, "history.model"),
    effort: optionalString(value.effort, "history.effort"),
  };
}
