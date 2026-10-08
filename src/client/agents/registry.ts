import { claudeAdapter } from "./claude.ts";
import { genericAdapter } from "./generic.ts";
import { opencodeAdapter } from "./opencode.ts";
import type { AgentAdapter } from "./types.ts";

/**
 * The adapters for agent kinds, by the Herdr agent kind. Pi draws user and agent messages the same
 * in plain text, so it uses the generic adapter.
 */
const ADAPTERS: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
  pi: genericAdapter,
};

/** Gives the adapter for an agent kind. A kind that has no adapter gets the generic adapter. */
export function adapterFor(kind: string): AgentAdapter {
  return ADAPTERS[kind] ?? genericAdapter;
}
