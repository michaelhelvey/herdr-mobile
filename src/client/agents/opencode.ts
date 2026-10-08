import { genericAdapter } from "./generic.ts";
import { cleanLines, dedent, trimBlank } from "./text.ts";
import type { AgentAdapter, Block, BlockRole } from "./types.ts";

const BAR = /^\s*┃ ?/;

const INPUT_BOTTOM = /^\s*╹▀+/;

const SCROLLBAR = /(?:^|\s{2,})[█▀▄▐▌]$/;

const RUN_INFO = /^\s*(?:▣\s*)?\S+ · .+ · \d+(?:\.\d+)?m?s\b/;

/**
 * The adapter for OpenCode. OpenCode is a full-screen TUI, so its messages are only in the
 * `visible` source. User messages have a bar at the left. Agent messages have an indent.
 */
export const opencodeAdapter: AgentAdapter = {
  source: "visible",
  parse(text) {
    let lines = cleanLines(text).map((line) => line.replace(SCROLLBAR, "").trimEnd());
    const bottom = lines.findLastIndex((line) => INPUT_BOTTOM.test(line));

    if (bottom !== -1) {
      let top = bottom;

      while (top > 0 && BAR.test(lines[top - 1] ?? "")) {
        top--;
      }

      lines = lines.slice(0, top);
    }

    const blocks: Block[] = [];
    let role: BlockRole | null = null;
    let current: string[] = [];

    function flush() {
      const body = trimBlank(dedent(current)).join("\n");

      if (role && body !== "") {
        blocks.push({ role, text: body });
      }

      role = null;
      current = [];
    }

    for (const line of lines) {
      const next: BlockRole | null = BAR.test(line)
        ? "user"
        : RUN_INFO.test(line)
          ? "meta"
          : line === ""
            ? role
            : "agent";

      if (next !== role || next === "meta") {
        flush();
        role = next;
      }

      current.push(next === "user" ? line.replace(BAR, "") : line);
    }

    flush();

    return blocks;
  },
  dialog: genericAdapter.dialog,
  interruptKeys: ["esc"],
};
