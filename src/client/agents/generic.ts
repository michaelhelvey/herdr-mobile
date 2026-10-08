import { cleanLines, cutInputBox, lastLines } from "./text.ts";
import type { AgentAdapter } from "./types.ts";

/**
 * The adapter for an agent kind that has no adapter of its own. It shows the screen text as one
 * terminal block, without the input box.
 */
export const genericAdapter: AgentAdapter = {
  source: "recent_unwrapped",
  parse(text) {
    const lines = cutInputBox(cleanLines(text));

    return lines.length === 0 ? [] : [{ role: "terminal", text: lines.join("\n") }];
  },
  dialog(text) {
    return lastLines(cleanLines(text), 16);
  },
  interruptKeys: ["esc"],
};
