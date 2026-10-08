import { describe, expect, mock, test } from "bun:test";

import type { AgentStatus, AppState } from "../shared/messages.ts";
import { changeLabel, ModelQueue } from "./model-queue.ts";

function state(status: AgentStatus): AppState {
  return {
    herdr: { ok: true, version: "1" },
    workspaces: [
      {
        id: "w1",
        label: "app",
        agents: [{ paneId: "w1:p1", kind: "claude", title: null, status, cwd: null }],
      },
    ],
  };
}

function label(queue: ModelQueue): unknown {
  return queue.decorate(state("idle")).workspaces[0]?.agents[0]?.modelChange;
}

describe("ModelQueue", () => {
  test("waits until the agent is ready, then applies the change", async () => {
    const apply = mock(() => Promise.resolve());
    const queue = new ModelQueue(apply, () => undefined);

    queue.enqueue("w1:p1", { model: "sonnet", effort: "high", scope: "session" });
    queue.tick(state("working"));

    expect(apply).not.toHaveBeenCalled();
    expect(label(queue)).toEqual({ label: "Sonnet · high", status: "queued", error: null });

    queue.tick(state("done"));
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(label(queue)).toMatchObject({ status: "done" });
  });

  test("keeps the error when the change fails", async () => {
    const queue = new ModelQueue(
      () => Promise.reject(new Error("the model picker did not open")),
      () => undefined,
    );

    queue.enqueue("w1:p1", { model: "opus", effort: null, scope: "default" });
    queue.tick(state("idle"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(label(queue)).toEqual({
      label: "Opus",
      status: "failed",
      error: "the model picker did not open",
    });
  });
});

describe("changeLabel", () => {
  test("names a Claude alias, and drops the provider of a full model ID", () => {
    expect(changeLabel({ model: "opus", effort: "high", scope: "session" })).toBe("Opus · high");
    expect(changeLabel({ model: "t4/gpt-5.6-sol", effort: null, scope: "session" })).toBe(
      "gpt-5.6-sol",
    );
  });
});
