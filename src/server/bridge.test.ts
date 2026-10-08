import { describe, expect, test } from "bun:test";

import type { AppState } from "../shared/messages.ts";
import { Bridge } from "./bridge.ts";
import type { HerdrClient, HerdrSubscription, SubscriptionHandlers } from "./herdr.ts";

interface FakeAgent {
  pane_id: string;
  workspace_id: string;
  agent_status: string;
}

/** A Herdr server in memory. Tests change `agents` and then send an event. */
class FakeHerdr implements HerdrClient {
  agents: FakeAgent[] = [];
  down = false;
  kindless = false;
  open: { subscriptions: HerdrSubscription[]; handlers: SubscriptionHandlers }[] = [];

  request(method: string): Promise<unknown> {
    if (this.down) {
      return Promise.reject(new Error("connect ENOENT"));
    }

    expect(method).toBe("session.snapshot");

    return Promise.resolve({
      type: "session_snapshot",
      snapshot: {
        version: "0.9.3",
        workspaces: [
          { workspace_id: "w2", label: "second", number: 2 },
          { workspace_id: "w1", label: "first", number: 1 },
        ],
        agents: this.agents.map((agent) => ({
          ...agent,
          agent: this.kindless ? null : "claude",
          cwd: "/tmp",
        })),
      },
    });
  }

  subscribe(subscriptions: HerdrSubscription[], handlers: SubscriptionHandlers) {
    const entry = { subscriptions, handlers };

    this.open.push(entry);

    return {
      close: () => {
        this.open = this.open.filter((other) => other !== entry);
        handlers.onClose();
      },
    };
  }

  /** Sends an event on all open subscriptions. */
  emit() {
    this.open.forEach(({ handlers }) => handlers.onEvent({ event: "pane_closed" }));
  }

  /** Stops all subscriptions with an error, as when the Herdr server stops. */
  crash() {
    const open = this.open;

    this.open = [];
    open.forEach(({ handlers }) => handlers.onClose(new Error("herdr closed the connection")));
  }

  statusPanes(): string[] {
    return this.open.flatMap(({ subscriptions }) =>
      subscriptions.flatMap((sub) =>
        sub.type === "pane.agent_status_changed" ? [sub.pane_id] : [],
      ),
    );
  }
}

function setup() {
  const herdr = new FakeHerdr();
  const states: AppState[] = [];

  const bridge = new Bridge({
    client: herdr,
    onState: (state) => states.push(state),
    pollMs: 60_000,
    debounceMs: 0,
    retryMs: 60_000,
    log: () => undefined,
  });

  return { herdr, states, bridge };
}

function agentIds(state: AppState | undefined): Record<string, string[]> {
  return Object.fromEntries(
    (state?.workspaces ?? []).map((workspace) => [
      workspace.id,
      workspace.agents.map((agent) => agent.paneId),
    ]),
  );
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("Bridge", () => {
  test("puts agents in their workspaces and sorts workspaces by number", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [
      { pane_id: "w2:p1", workspace_id: "w2", agent_status: "working" },
      { pane_id: "w1:p3", workspace_id: "w1", agent_status: "blocked" },
    ];
    await bridge.start();

    expect(states.at(-1)?.workspaces.map((workspace) => workspace.label)).toEqual([
      "first",
      "second",
    ]);
    expect(agentIds(states.at(-1))).toEqual({ w1: ["w1:p3"], w2: ["w2:p1"] });
    bridge.stop();
  });

  test("an event removes a closed agent and adds a new agent", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "idle" }];
    await bridge.start();

    herdr.agents = [{ pane_id: "w1:p2", workspace_id: "w1", agent_status: "working" }];
    herdr.emit();
    await settle();

    expect(agentIds(states.at(-1))).toEqual({ w1: ["w1:p2"], w2: [] });
    expect(herdr.statusPanes()).toEqual(["w1:p2"]);
    expect(herdr.open).toHaveLength(1);
    bridge.stop();
  });

  test("keeps an agent whose kind Herdr does not know yet", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "unknown" }];
    herdr.kindless = true;
    await bridge.start();

    expect(states.at(-1)?.workspaces[0]?.agents[0]?.kind).toBe("agent");
    bridge.stop();
  });

  test("does not send a state that did not change", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "idle" }];
    await bridge.start();
    herdr.emit();
    await settle();

    expect(states).toHaveLength(1);
    bridge.stop();
  });

  test("reports a Herdr failure and recovers when Herdr comes back", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "idle" }];
    await bridge.start();

    herdr.down = true;
    herdr.crash();
    await bridge.refresh();
    await bridge.refresh();
    await bridge.refresh();

    expect(states.at(-1)?.herdr).toEqual({ ok: false, error: "connect ENOENT" });
    expect(herdr.open).toHaveLength(0);

    herdr.down = false;
    await bridge.refresh();

    expect(states.at(-1)?.herdr).toEqual({ ok: true, version: "0.9.3" });
    expect(herdr.statusPanes()).toEqual(["w1:p1"]);
    bridge.stop();
  });

  test("keeps the last good state when one refresh fails", async () => {
    const { herdr, states, bridge } = setup();

    herdr.agents = [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "idle" }];
    await bridge.start();

    herdr.down = true;
    await bridge.refresh();
    herdr.down = false;
    await bridge.refresh();

    expect(states.map((state) => state.herdr.ok)).toEqual([true]);
    expect(agentIds(bridge.state)).toEqual({ w1: ["w1:p1"], w2: [] });
    bridge.stop();
  });
});
