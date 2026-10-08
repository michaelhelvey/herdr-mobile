import type { DiffHunk, DiffLine, FileDiff } from "../../shared/history.ts";

/** The most diff lines that the bridge sends for one file. */
export const MAX_DIFF_LINES = 800;

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Collects diff lines into hunks. It counts all lines, but it keeps only `MAX_DIFF_LINES` lines,
 * so that a large change does not make a large message.
 */
export class DiffBuilder {
  readonly hunks: DiffHunk[] = [];
  added = 0;
  removed = 0;
  truncated = false;
  #kept = 0;

  /** Starts a new hunk. */
  hunk(): void {
    if (this.hunks.at(-1)?.lines.length !== 0) {
      this.hunks.push({ lines: [] });
    }
  }

  /** Adds one line to the current hunk. */
  push(line: DiffLine): void {
    if (line.kind === "add") {
      this.added++;
    } else if (line.kind === "del") {
      this.removed++;
    }

    if (this.hunks.length === 0) {
      this.hunks.push({ lines: [] });
    }

    if (this.#kept < MAX_DIFF_LINES) {
      this.hunks.at(-1)?.lines.push(line);
      this.#kept++;
    } else {
      this.truncated = true;
    }
  }

  /** Gives the diff, or `null` if it has no lines. */
  build(path: string, action: FileDiff["action"]): FileDiff | null {
    const hunks = this.hunks.filter((hunk) => hunk.lines.length > 0);

    if (hunks.length === 0) {
      return null;
    }

    return {
      path,
      action,
      added: this.added,
      removed: this.removed,
      hunks,
      truncated: this.truncated,
    };
  }
}

/**
 * Makes a diff from the text of a unified diff (`--- a`, `+++ b`, `@@ -1,3 +1,4 @@`). It ignores
 * the header lines. It uses the line counts of each hunk head, so an empty line in a hunk is an
 * empty context line. A diff whose first hunk has no old lines makes a new file.
 */
export function parseUnifiedDiff(text: string, path: string): FileDiff | null {
  const builder = new DiffBuilder();
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let create = false;

  for (const line of text.split("\n")) {
    if (oldLeft <= 0 && newLeft <= 0) {
      const head = HUNK_HEAD.exec(line);

      if (head) {
        oldNo = Number(head[1]);
        newNo = Number(head[3]);
        oldLeft = head[2] === undefined ? 1 : Number(head[2]);
        newLeft = head[4] === undefined ? 1 : Number(head[4]);

        if (builder.hunks.length === 0 && oldLeft === 0) {
          create = true;
        }

        builder.hunk();
      }

      continue;
    }

    if (line.startsWith("\\")) {
      continue;
    }

    const body = line.slice(1);

    if (line.startsWith("+")) {
      builder.push({ kind: "add", text: body, oldNo: null, newNo: newNo++ });
      newLeft--;
    } else if (line.startsWith("-")) {
      builder.push({ kind: "del", text: body, oldNo: oldNo++, newNo: null });
      oldLeft--;
    } else {
      builder.push({ kind: "context", text: body, oldNo: oldNo++, newNo: newNo++ });
      oldLeft--;
      newLeft--;
    }
  }

  return builder.build(path, create ? "create" : "edit");
}

/** Makes a diff that adds all lines of a new file. */
export function diffForNewFile(path: string, content: string): FileDiff | null {
  const builder = new DiffBuilder();

  content
    .replace(/\n$/, "")
    .split("\n")
    .forEach((line, index) =>
      builder.push({ kind: "add", text: line, oldNo: null, newNo: index + 1 }),
    );

  return builder.build(path, "create");
}
