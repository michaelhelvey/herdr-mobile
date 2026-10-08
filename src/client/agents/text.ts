/** A line that is only a horizontal rule, as TUIs draw around an input box. */
export const RULE_LINE = /^\s*[─━═-]{10,}\s*$/;

/**
 * Splits screen text into lines. It removes control characters and spaces at the end of lines,
 * changes runs of blank lines into one blank line, and removes blank lines at the start and end.
 */
export function cleanLines(text: string): string[] {
  const lines: string[] = [];

  for (const raw of text.split("\n")) {
    // eslint-disable-next-line no-control-regex -- the screen text can contain control characters.
    const line = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trimEnd();

    if (line === "" && (lines.length === 0 || lines.at(-1) === "")) {
      continue;
    }

    lines.push(line);
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Removes the input box and the status lines under it. Many TUIs draw the input box between two
 * rule lines at the bottom of the screen. If there are not two rule lines, it changes nothing.
 */
export function cutInputBox(lines: string[]): string[] {
  const rules = lines.flatMap((line, index) => (RULE_LINE.test(line) ? [index] : []));
  const top = rules.at(-2);

  return top === undefined ? lines : trimBlank(lines.slice(0, top));
}

/** Removes blank lines at the start and the end. */
export function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") {
    start++;
  }

  while (end > start && lines[end - 1]?.trim() === "") {
    end--;
  }

  return lines.slice(start, end);
}

/** Removes the indent that all non-blank lines have. */
export function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);

  const common = indents.length === 0 ? 0 : Math.min(...indents);

  return lines.map((line) => line.slice(common));
}

/** Gives the last `count` lines that are not blank, joined. Use it to show a dialog. */
export function lastLines(lines: string[], count: number): string {
  return trimBlank(lines.slice(-count)).join("\n");
}
