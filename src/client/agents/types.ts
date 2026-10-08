import type { AllowedKey, ReadSource } from "../../shared/rpc.ts";

/** The role of one part of a transcript. */
export type BlockRole = "user" | "agent" | "tool" | "meta" | "terminal";

/** One part of a transcript, such as one message. */
export interface Block {
  role: BlockRole;
  text: string;
}

/**
 * Tells the PWA how to show one agent kind. Herdr controls all agent kinds with the same API, but
 * each agent draws a different TUI. To support a new kind, write an adapter and add it to
 * `ADAPTERS` in `registry.ts`.
 */
export interface AgentAdapter {
  /** The Herdr read source. Full-screen TUIs keep their content only in `visible`. */
  source: ReadSource;
  /** Changes the screen text into transcript blocks. */
  parse: (text: string) => Block[];
  /** Gives the text of the question or approval dialog when the agent is `blocked`. */
  dialog: (text: string) => string;
  /** The keys that stop the current turn of the agent. */
  interruptKeys: AllowedKey[];
}
