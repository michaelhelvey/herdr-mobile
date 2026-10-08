import { cleanLines, cutInputBox, lastLines, RULE_LINE, trimBlank } from "./text.ts";
import type { AgentAdapter, Block, BlockRole } from "./types.ts";

const USER = "❯ ";

const AGENT = "⏺ ";

const META = /^[✻✶✳✢·*※] /;

const TOOL_CALL = /^⏺ [A-Z][\w-]*\(/;

const TOOL_SUMMARY = /^ {2}(?:Ran|Read|Searched|Edited|Wrote|Updated|Listed|Fetched) \d+ /;

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s/;

interface Draft {
  role: BlockRole;
  lines: string[];
}

/**
 * Joins the lines that Claude Code wrapped at the width of the terminal, so that the text can wrap
 * again at the width of the phone. A line continues the line before it when the line before it is
 * almost as long as the longest line, and it is not a list item.
 */
export function unwrap(lines: string[], width: number): string[] {
  const out: string[] = [];
  let previousLength = 0;

  for (const line of lines) {
    const previous = out.at(-1);

    const wrapped =
      previous !== undefined &&
      previousLength >= width - 12 &&
      line.trim() !== "" &&
      !LIST_ITEM.test(line);

    if (wrapped) {
      out[out.length - 1] = `${previous} ${line.trim()}`;
    } else {
      out.push(line);
    }

    previousLength = line.length;
  }

  return out;
}

function finish(draft: Draft, width: number): Block {
  const lines = trimBlank(draft.lines);

  const text = (
    draft.role === "agent" || draft.role === "user" ? unwrap(lines, width) : lines
  ).join("\n");

  return { role: draft.role, text };
}

/** The adapter for Claude Code. It shows user messages, agent messages, and tool calls. */
export const claudeAdapter: AgentAdapter = {
  source: "recent_unwrapped",
  parse(text) {
    const all = cleanLines(text);
    const width = Math.max(0, ...all.map((line) => line.length));
    const lines = cutInputBox(all);
    const blocks: Block[] = [];
    let draft: Draft | null = null;

    function start(role: BlockRole, first: string): Draft {
      if (draft) {
        blocks.push(finish(draft, width));
      }

      return { role, lines: [first] };
    }

    for (const line of lines) {
      if (line.startsWith(USER)) {
        draft = start("user", line.slice(USER.length));
      } else if (line.startsWith(AGENT)) {
        draft = start(TOOL_CALL.test(line) ? "tool" : "agent", line.slice(AGENT.length));
      } else if (META.test(line)) {
        draft = start("meta", line.slice(2));
      } else if (line === "") {
        if (draft?.role === "user") {
          blocks.push(finish(draft, width));
          draft = null;
        } else {
          draft?.lines.push("");
        }
      } else if (TOOL_SUMMARY.test(line)) {
        draft = start("tool", line.trim());
      } else if (line.startsWith("  ") && draft) {
        draft.lines.push(line.slice(2));
      } else if (line.startsWith("  ")) {
        draft = start("tool", line.trim());
      } else if (!RULE_LINE.test(line)) {
        draft = start("meta", line);
      }
    }

    if (draft) {
      blocks.push(finish(draft, width));
    }

    return blocks.filter((block) => block.text !== "");
  },
  dialog(text) {
    const lines = cleanLines(text);
    const rules = lines.flatMap((line, index) => (RULE_LINE.test(line) ? [index] : []));
    const top = rules.at(-1);

    return top === undefined ? lastLines(lines, 16) : trimBlank(lines.slice(top + 1)).join("\n");
  },
  interruptKeys: ["esc"],
};
