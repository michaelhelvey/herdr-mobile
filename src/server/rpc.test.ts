import { describe, expect, mock, test } from "bun:test";

import type { AppState } from "../shared/messages.ts";
import type { HerdrClient } from "./herdr.ts";
import { handleRpc } from "./rpc.ts";

const STATE: AppState = {
  herdr: { ok: true, version: "0.9.3" },
  workspaces: [
    {
      id: "w1",
      label: "app",
      agents: [{ paneId: "w1:p2", kind: "claude", title: null, status: "idle", cwd: null }],
    },
  ],
};

function fakeClient(result: unknown = null) {
  const request = mock((_method: string, _params: Record<string, unknown>) =>
    Promise.resolve(result),
  );

  const client: HerdrClient = {
    request,
    subscribe: () => ({ close: () => undefined }),
  };

  return { client, request };
}

describe("handleRpc", () => {
  test("refuses a pane that does not contain an agent and sends nothing to Herdr", async () => {
    const { client, request } = fakeClient();

    const error = await handleRpc(
      { method: "keys", paneId: "w1:p1", keys: ["ctrl+c"] },
      { client, state: STATE },
    ).then(
      () => null,
      (problem: unknown) => problem,
    );

    expect(error).toEqual(new Error("no agent in pane w1:p1"));
    expect(request).not.toHaveBeenCalled();
  });

  test("sends a prompt to the agent", async () => {
    const { client, request } = fakeClient();

    await handleRpc(
      { method: "prompt", paneId: "w1:p2", text: "hi", images: [] },
      { client, state: STATE },
    );

    expect(request).toHaveBeenCalledWith("agent.prompt", { target: "w1:p2", text: "hi" });
  });

  test("gives only the text and the revision of a read", async () => {
    const { client } = fakeClient({
      type: "pane_read",
      read: { pane_id: "w1:p2", text: "⏺ done", revision: 7, truncated: true },
    });

    expect(
      await handleRpc(
        { method: "read", paneId: "w1:p2", source: "recent_unwrapped" },
        { client, state: STATE },
      ),
    ).toEqual({
      text: "⏺ done",
      revision: 7,
    });
  });

  test("never asks Herdr for extra lines, because that scrolls the terminal on the Mac", async () => {
    const { client, request } = fakeClient({ read: { text: "", revision: 0 } });

    await handleRpc(
      { method: "read", paneId: "w1:p2", source: "recent_unwrapped" },
      { client, state: STATE },
    );

    expect(request).toHaveBeenCalledWith("agent.read", {
      target: "w1:p2",
      source: "recent_unwrapped",
    });
  });

  test("gives an empty history for a new session, so that the PWA keeps polling", async () => {
    const { client } = fakeClient();

    const histories = new Map([
      [
        "claude",
        {
          load: () => Promise.resolve(null),
          controls: () => Promise.resolve({ commands: [], models: [], efforts: [] }),
          dialog: () => Promise.resolve(null),
          choose: () => Promise.resolve(),
          setModel: () => Promise.resolve(),
        },
      ],
    ]);

    expect(
      await handleRpc(
        { method: "history", paneId: "w1:p2", since: null },
        { client, state: STATE, providers: histories },
      ),
    ).toEqual({ key: "none", total: 0, start: 0, items: [], model: null, effort: null });
  });

  test("tells the PWA when there is no history for an agent kind", async () => {
    const { client } = fakeClient();

    const error = await handleRpc(
      { method: "history", paneId: "w1:p2", since: null },
      { client, state: STATE, providers: new Map() },
    ).then(
      () => null,
      (problem: unknown) => problem,
    );

    expect(error).toEqual(new Error("no history for claude agents"));
  });

  test("puts the paths of the uploaded images before the text", async () => {
    const { client, request } = fakeClient();
    const id = "0b9c2a4e-6f1d-4c1e-9a7b-3d2f1e0c9b8a.png";

    await handleRpc(
      { method: "prompt", paneId: "w1:p2", text: " what is this? ", images: [id] },
      { client, state: STATE, uploadDir: "/up" },
    );

    expect(request).toHaveBeenCalledWith("agent.prompt", {
      target: "w1:p2",
      text: `/up/${id} what is this?`,
    });
  });
});
