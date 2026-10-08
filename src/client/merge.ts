import { RULE_LINE } from "./agents/text.ts";

/** The number of lines in a row that must match before two screens count as overlapping. */
const KEY_LENGTH = 4;

function isDistinct(line: string): boolean {
  return line.trim() !== "" && !RULE_LINE.test(line);
}

/**
 * Joins the text that the PWA has with a newer read of the bottom of the screen. The newer read
 * starts somewhere inside the older text. The result is the older text up to that place, then the
 * newer read. This keeps the history that scrolled off the screen without a deep read, because a
 * deep read makes Herdr scroll the TUI of the agent.
 *
 * If the newer read does not overlap the older text (for example, the agent cleared the screen),
 * the result is the newer read.
 */
export function mergeScreen(older: string, newer: string): string {
  const old = older.split("\n");
  const next = newer.split("\n");
  const anchor = next.findIndex(isDistinct);

  if (anchor === -1 || older === "") {
    return newer;
  }

  const key = next.slice(anchor, anchor + KEY_LENGTH);

  for (let start = old.length - key.length; start >= 0; start--) {
    if (key.every((line, offset) => old[start + offset] === line)) {
      const cut = start - anchor;

      return cut <= 0 ? newer : [...old.slice(0, cut), ...next].join("\n");
    }
  }

  return newer;
}
