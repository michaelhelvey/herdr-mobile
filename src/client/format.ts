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

/**
 * Removes the parts of a terminal title that a harness adds around the session name. OpenCode
 * shows `OC | <session>`, or `OpenCode` without a session. pi shows `π - <name> - <dir>`, or
 * `π - <dir>` without a name.
 */
function sessionName(kind: string, title: string, cwd: string | null): string {
  if (kind === "opencode") {
    return title === "OpenCode" ? "" : title.replace(/^OC \| /, "");
  }

  if (kind === "pi" && title.startsWith("π - ")) {
    const rest = title.slice("π - ".length);
    const dir = cwd?.split("/").filter(Boolean).at(-1);

    if (dir && rest === dir) {
      return "";
    }

    return dir && rest.endsWith(` - ${dir}`) ? rest.slice(0, -` - ${dir}`.length) : rest;
  }

  return title;
}

/** Gives the main text of an agent row. If the agent did not set a title, it uses the kind. */
export function agentTitle(agent: AgentView): string {
  return sessionName(agent.kind, agent.title?.trim() ?? "", agent.cwd).trim() || agent.kind;
}
