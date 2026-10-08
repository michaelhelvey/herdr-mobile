import type { AgentStatus, AgentView } from "../shared/messages.ts";

/** The text that the PWA shows for each status. */
export const STATUS_LABELS: Record<AgentStatus, string> = {
  working: "Working",
  blocked: "Needs you",
  done: "Done",
  idle: "Idle",
  unknown: "Unknown",
};

/** Gives the last part of a path, with the home directory shown as `~`. */
export function shortPath(path: string | null): string {
  if (!path) {
    return "";
  }

  const parts = path.split("/").filter(Boolean);

  if (parts.length <= 2 && parts[0] === "Users") {
    return "~";
  }

  return parts.at(-1) ?? "/";
}

/** Gives the main text of an agent row. If the agent did not set a title, it uses the kind. */
export function agentTitle(agent: AgentView): string {
  return agent.title?.trim() || agent.kind;
}
