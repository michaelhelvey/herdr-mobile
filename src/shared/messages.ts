import { array, optionalString, ParseError, record, string } from "./parse.ts";

/** The lifecycle status of an agent, as Herdr reports it. */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

/** A model change that the bridge applies to an agent. */
export interface ModelChangeView {
  /** The model and the effort, for example `Sonnet · high`. */
  label: string;
  status: "queued" | "applying" | "done" | "failed";
  error: string | null;
}

/** One agent, as the PWA shows it. */
export interface AgentView {
  /** The Herdr pane ID that contains the agent. Use it as the agent target. */
  paneId: string;
  /** The agent kind, for example `claude`. */
  kind: string;
  /** The title that the agent sets, or `null` if it did not set one. */
  title: string | null;
  status: AgentStatus;
  cwd: string | null;
  /** The model change that the user asked for, if there is one. */
  modelChange?: ModelChangeView;
}

/** One Herdr workspace and the agents in it. */
export interface WorkspaceView {
  id: string;
  label: string;
  agents: AgentView[];
}

/** The connection between the bridge and the Herdr server. */
export type HerdrLink = { ok: true; version: string } | { ok: false; error: string };

/** The full state that the bridge sends to the PWA. */
export interface AppState {
  herdr: HerdrLink;
  workspaces: WorkspaceView[];
}

/** A message from the bridge to the PWA. The bridge sends the full state each time. */
export interface StateMessage {
  type: "state";
  state: AppState;
}

/** Gives the status as an `AgentStatus`. A value that is not known becomes `unknown`. */
export function toAgentStatus(value: unknown): AgentStatus {
  return AGENT_STATUSES.find((status) => status === value) ?? "unknown";
}

/** Parses one message from the bridge. Throws a `ParseError` if the message is not valid. */
export function parseStateMessage(raw: string): StateMessage {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new ParseError("message: not valid JSON");
  }

  const message = record(json, "message");

  if (message.type !== "state") {
    throw new ParseError('message.type: expected "state"');
  }

  return { type: "state", state: parseAppState(message.state) };
}

function parseAppState(value: unknown): AppState {
  const state = record(value, "state");

  return {
    herdr: parseHerdrLink(state.herdr),
    workspaces: array(state.workspaces, "state.workspaces").map((workspace, index) =>
      parseWorkspace(workspace, `state.workspaces[${index}]`),
    ),
  };
}

function parseHerdrLink(value: unknown): HerdrLink {
  const link = record(value, "state.herdr");

  if (link.ok === true) {
    return { ok: true, version: string(link.version, "state.herdr.version") };
  }

  return { ok: false, error: string(link.error, "state.herdr.error") };
}

function parseWorkspace(value: unknown, path: string): WorkspaceView {
  const workspace = record(value, path);

  return {
    id: string(workspace.id, `${path}.id`),
    label: string(workspace.label, `${path}.label`),
    agents: array(workspace.agents, `${path}.agents`).map((agent, index) =>
      parseAgent(agent, `${path}.agents[${index}]`),
    ),
  };
}

function parseAgent(value: unknown, path: string): AgentView {
  const agent = record(value, path);

  return {
    paneId: string(agent.paneId, `${path}.paneId`),
    kind: string(agent.kind, `${path}.kind`),
    title: optionalString(agent.title, `${path}.title`),
    status: toAgentStatus(agent.status),
    cwd: optionalString(agent.cwd, `${path}.cwd`),
    ...(agent.modelChange === undefined
      ? {}
      : { modelChange: parseModelChange(agent.modelChange, `${path}.modelChange`) }),
  };
}

function parseModelChange(value: unknown, path: string): ModelChangeView {
  const change = record(value, path);
  const status = change.status;

  if (status !== "queued" && status !== "applying" && status !== "done" && status !== "failed") {
    throw new ParseError(`${path}.status: not known`);
  }

  return {
    label: string(change.label, `${path}.label`),
    status,
    error: optionalString(change.error, `${path}.error`),
  };
}

/** Gives the number of agents in all workspaces. */
export function countAgents(state: AppState): number {
  return state.workspaces.reduce((total, workspace) => total + workspace.agents.length, 0);
}
