import { type ModelChange, modelLabel } from "../shared/harness.ts";
import type { AppState, ModelChangeView } from "../shared/messages.ts";

/** The time that the queue shows a change that is done or that failed. */
const KEEP_MS = 60_000;

interface Entry {
  change: ModelChange;
  status: ModelChangeView["status"];
  error: string | null;
  at: number;
}

/** Changes the model of an agent. */
export type ApplyModel = (paneId: string, change: ModelChange) => Promise<void>;

/**
 * Gives the text that the PWA shows for a change, for example `Sonnet · high`. A model with a
 * provider, for example `openai/gpt-6`, shows without the provider.
 */
export function changeLabel(change: ModelChange): string {
  const model = /^[a-z]+$/.test(change.model)
    ? `${change.model.charAt(0).toUpperCase()}${change.model.slice(1)}`
    : modelLabel(change.model);

  return change.effort ? `${model} · ${change.effort}` : model;
}

/**
 * Keeps the model changes that the user asked for, one for each agent. A change waits until the
 * agent is ready for input, because the change uses the TUI of the agent.
 */
export class ModelQueue {
  #entries = new Map<string, Entry>();

  constructor(
    private readonly apply: ApplyModel,
    private readonly onChange: () => void,
    private readonly now = () => Date.now(),
  ) {}

  /** Adds a change. It replaces a change for the same agent that did not start yet. */
  enqueue(paneId: string, change: ModelChange): void {
    if (this.#entries.get(paneId)?.status === "applying") {
      throw new Error("a model change for this agent is already running");
    }

    this.#entries.set(paneId, { change, status: "queued", error: null, at: this.now() });
    this.onChange();
  }

  /** Starts the changes whose agent is ready, and removes old results. */
  tick(state: AppState): void {
    const agents = new Map(
      state.workspaces
        .flatMap((workspace) => workspace.agents)
        .map((agent) => [agent.paneId, agent]),
    );

    for (const [paneId, entry] of this.#entries) {
      const agent = agents.get(paneId);

      if (
        entry.status !== "queued" &&
        entry.status !== "applying" &&
        this.now() - entry.at > KEEP_MS
      ) {
        this.#entries.delete(paneId);
        this.onChange();
      } else if (!agent && entry.status === "queued") {
        this.#entries.delete(paneId);
        this.onChange();
      } else if (
        entry.status === "queued" &&
        (agent?.status === "idle" || agent?.status === "done")
      ) {
        void this.#run(paneId, entry);
      }
    }
  }

  async #run(paneId: string, entry: Entry): Promise<void> {
    entry.status = "applying";
    this.onChange();

    try {
      await this.apply(paneId, entry.change);
      entry.status = "done";
    } catch (error) {
      entry.status = "failed";
      entry.error = error instanceof Error ? error.message : String(error);
    }

    entry.at = this.now();
    this.onChange();
  }

  /** Adds the changes to the agents of the state. */
  decorate(state: AppState): AppState {
    if (this.#entries.size === 0) {
      return state;
    }

    return {
      ...state,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        agents: workspace.agents.map((agent) => {
          const entry = this.#entries.get(agent.paneId);

          return entry
            ? {
                ...agent,
                modelChange: {
                  label: changeLabel(entry.change),
                  status: entry.status,
                  error: entry.error,
                },
              }
            : agent;
        }),
      })),
    };
  }
}
