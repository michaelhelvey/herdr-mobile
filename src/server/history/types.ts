import type { DialogView, HarnessControls, ModelChange } from "../../shared/harness.ts";
import type { History } from "../../shared/history.ts";

/**
 * Reads the conversation of an agent from the session files of its harness. The screen text that
 * Herdr gives has only the visible part of the TUI. The session files have the full conversation
 * with structured tool calls. To support a new harness, write a provider and add it in `index.ts`.
 */
export interface HistoryProvider {
  /**
   * Gives the history of the agent in the pane, or `null` if there is no session file. `since` is
   * the number of items that the PWA has. Without it, the provider gives the most recent items.
   */
  load: (paneId: string, since: number | null) => Promise<History | null>;
  /** Gives the slash commands and the model picker for an agent that works in `cwd`. */
  controls: (cwd: string | null) => Promise<HarnessControls>;
  /** Reads the question that the agent asks now, or gives `null` if it cannot read it. */
  dialog: (paneId: string) => Promise<DialogView | null>;
  /** Picks an option of the question. `labels` are the options that the user saw. */
  choose: (paneId: string, index: number, labels: string[]) => Promise<void>;
  /** Changes the model and the effort. Call it only when the agent is ready for input. */
  setModel: (paneId: string, change: ModelChange) => Promise<void>;
}
