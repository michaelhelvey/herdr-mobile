import { type AppState, toAgentStatus, type WorkspaceView } from "../shared/messages.ts";
import { array, number, optionalString, record, string } from "../shared/parse.ts";

/** Makes the PWA state from the `result` of a Herdr `session.snapshot` request. */
export function stateFromSnapshot(result: unknown): AppState {
  const snapshot = record(record(result, "result").snapshot, "result.snapshot");

  const workspaces = array(snapshot.workspaces, "snapshot.workspaces")
    .map((value, index) => {
      const path = `snapshot.workspaces[${index}]`;
      const workspace = record(value, path);

      const view: WorkspaceView = {
        id: string(workspace.workspace_id, `${path}.workspace_id`),
        label: string(workspace.label, `${path}.label`),
        agents: [],
      };

      return { number: number(workspace.number, `${path}.number`), view };
    })
    .sort((a, b) => a.number - b.number)
    .map(({ view }) => view);

  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  array(snapshot.agents, "snapshot.agents").forEach((value, index) => {
    const path = `snapshot.agents[${index}]`;
    const agent = record(value, path);
    const workspaceId = string(agent.workspace_id, `${path}.workspace_id`);

    byId.get(workspaceId)?.agents.push({
      paneId: string(agent.pane_id, `${path}.pane_id`),
      kind: optionalString(agent.agent, `${path}.agent`) ?? "agent",
      title: optionalString(agent.terminal_title_stripped, `${path}.terminal_title_stripped`),
      status: toAgentStatus(agent.agent_status),
      cwd: optionalString(agent.cwd, `${path}.cwd`),
    });
  });

  return {
    herdr: { ok: true, version: string(snapshot.version, "snapshot.version") },
    workspaces,
  };
}

/** Gives the pane IDs of all agents in the state, sorted. */
export function agentPaneIds(state: AppState): string[] {
  return state.workspaces
    .flatMap((workspace) => workspace.agents.map((agent) => agent.paneId))
    .sort();
}
