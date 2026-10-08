import type { AgentView, AppState, WorkspaceView } from "../../shared/messages.ts";
import { countAgents } from "../../shared/messages.ts";
import { agentTitle, shortPath, STATUS_LABELS } from "../format.ts";
import { navigate } from "../router.ts";
import { ChevronRight } from "./icons.tsx";

/** The home screen: the agents that need the user, then all workspaces and their agents. */
export function ListView({ state }: { state: AppState }) {
  if (!state.herdr.ok) {
    return (
      <div class="banner">
        <strong>Cannot reach Herdr.</strong>
        <code>{state.herdr.error}</code>
      </div>
    );
  }

  const blocked = state.workspaces.flatMap((workspace) =>
    workspace.agents.filter((agent) => agent.status === "blocked"),
  );

  return (
    <>
      <p class="summary">
        {countAgents(state)} agents · {state.workspaces.length} workspaces · v{state.herdr.version}
      </p>
      {blocked.length > 0 && (
        <section class="workspace needs-you">
          <h2>Needs you</h2>
          <ul class="agents">
            {blocked.map((agent) => (
              <AgentRow key={agent.paneId} agent={agent} />
            ))}
          </ul>
        </section>
      )}
      {state.workspaces.map((workspace) => (
        <Workspace key={workspace.id} workspace={workspace} />
      ))}
    </>
  );
}

function Workspace({ workspace }: { workspace: WorkspaceView }) {
  return (
    <section class="workspace">
      <h2>{workspace.label}</h2>
      {workspace.agents.length === 0 ? (
        <p class="empty">No agents</p>
      ) : (
        <ul class="agents">
          {workspace.agents.map((agent) => (
            <AgentRow key={agent.paneId} agent={agent} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentRow({ agent }: { agent: AgentView }) {
  return (
    <li>
      <button
        type="button"
        class={`agent status-${agent.status}`}
        onClick={() => navigate({ name: "agent", paneId: agent.paneId })}
      >
        <span class="status-dot" aria-hidden="true" />
        <span class="agent-body">
          <span class="agent-title">{agentTitle(agent)}</span>
          <span class="agent-meta">
            {agent.kind} · {shortPath(agent.cwd)}
          </span>
        </span>
        <span class="status-label">{STATUS_LABELS[agent.status]}</span>
        <span class="row-chevron">
          <ChevronRight />
        </span>
      </button>
    </li>
  );
}
