import { isRecord } from "../../shared/parse.ts";

/** The longest tool output that the bridge sends, in characters. */
export const MAX_OUTPUT = 4000;

/** Gives the value if it is a string, else `null`. */
export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Cuts the text after `max` characters and adds a mark. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

/** Gives the path relative to `cwd` when the path is in `cwd`. */
export function relative(path: string, cwd: string | null): string {
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}

/** Gives the text of tool result content: a string, or an array of `{ text }` parts. */
export function toolOutput(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

/** Removes the color codes of a terminal from the text. */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex -- the codes start with the escape character.
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

/** Gives the first line of the text, without spaces at the start and the end. */
export function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? "";
}

/**
 * Gives the first string value of the tool input, on one line. Use it for a tool that the bridge
 * does not know.
 */
export function firstStringArg(input: unknown): string {
  const args = isRecord(input) ? input : {};
  const first = Object.values(args).find((value) => typeof value === "string");

  return typeof first === "string" ? clip(firstLine(first), 160) : "";
}

/** Gives a tool name with a capital first letter, for example `Bash` for `bash`. */
export function capitalize(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Gives one line that tells what a tool call does, for the tools of pi and OpenCode. These tools
 * have lower-case names and take `path` or `filePath`, `command`, `pattern`, and so on.
 */
export function summarizeToolInput(name: string, input: unknown, cwd: string | null): string {
  const args = isRecord(input) ? input : {};
  const path = text(args.path) ?? text(args.filePath) ?? text(args.file_path);

  switch (name) {
    case "bash":
    case "shell":
      return firstLine(text(args.command) ?? "");

    case "read":
    case "edit":
    case "write":
    case "ls":
    case "list":
      return path ? relative(path, cwd) : (text(args.pattern) ?? "");

    case "grep":
    case "glob":
    case "find":
      return text(args.pattern) ?? text(args.query) ?? "";

    case "webfetch":
      return text(args.url) ?? "";

    case "websearch":
      return text(args.query) ?? "";

    case "subagent":
    case "task":
      return text(args.description) ?? text(args.agent) ?? "";

    case "skill":
      return text(args.name) ?? firstStringArg(input);

    case "codemode":
    case "execute":
      return firstLine(text(args.code) ?? text(args.script) ?? "");

    default:
      return firstStringArg(input);
  }
}
