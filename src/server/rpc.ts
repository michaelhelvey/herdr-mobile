import { join } from "node:path";

import type { History } from "../shared/history.ts";
import type { AppState } from "../shared/messages.ts";
import { record } from "../shared/parse.ts";
import type { ReadResult, RpcCall } from "../shared/rpc.ts";
import type { HerdrClient } from "./herdr.ts";
import type { HistoryProvider } from "./history/types.ts";
import type { ModelQueue } from "./model-queue.ts";

/**
 * Gives the text that the bridge pastes into the agent. Each image is a path to its upload. Claude
 * Code changes a pasted image path into an image attachment, and other agents can read the file.
 */
export function promptText(text: string, images: readonly string[], uploadDir: string): string {
  const paths = images.map((id) => join(uploadDir, id));

  return [...paths, text.trim()].filter(Boolean).join(" ");
}

/** What `handleRpc` needs to do a call. */
export interface RpcContext {
  client: HerdrClient;
  state: AppState;
  /** The providers of the agent harnesses, by the Herdr agent kind. */
  providers?: ReadonlyMap<string, HistoryProvider>;
  uploadDir?: string;
  models?: ModelQueue;
}

/**
 * Does one call from the PWA. The target must be an agent in the current state, so that the PWA
 * cannot control a pane that does not contain an agent.
 *
 * A read never asks for `lines`. To get more rows than it keeps, Herdr scrolls the TUI of the
 * agent on the Mac, and the user sees the terminal move. The PWA joins screens instead.
 */
export async function handleRpc(call: RpcCall, context: RpcContext): Promise<unknown> {
  const { client, state, uploadDir = "", models } = context;
  const providers = context.providers ?? new Map<string, HistoryProvider>();

  const agent = state.workspaces
    .flatMap((workspace) => workspace.agents)
    .find((candidate) => candidate.paneId === call.paneId);

  if (!agent) {
    throw new Error(`no agent in pane ${call.paneId}`);
  }

  const provider = providers.get(agent.kind);

  function needProvider(what: string): HistoryProvider {
    if (!provider) {
      throw new Error(`no ${what} for ${agent?.kind ?? "these"} agents`);
    }

    return provider;
  }

  switch (call.method) {
    case "read": {
      const result = record(
        await client.request("agent.read", {
          target: call.paneId,
          source: call.source,
        }),
        "result",
      );

      const read = record(result.read, "result.read");

      const answer: ReadResult = {
        text: typeof read.text === "string" ? read.text : "",
        revision: typeof read.revision === "number" ? read.revision : 0,
      };

      return answer;
    }

    case "history": {
      // A new session has no file until the first message. The PWA polls again later.
      const empty: History = {
        key: "none",
        total: 0,
        start: 0,
        items: [],
        model: null,
        effort: null,
      };

      return (await needProvider("history").load(call.paneId, call.since)) ?? empty;
    }

    case "controls":
      return needProvider("controls").controls(agent.cwd);

    case "dialog":
      return provider ? provider.dialog(call.paneId) : null;

    case "choose":
      if (agent.status !== "blocked") {
        throw new Error("the agent does not ask a question now");
      }

      await needProvider("questions").choose(call.paneId, call.index, call.labels);

      return null;

    case "setModel": {
      const controls = await needProvider("model changes").controls(agent.cwd);

      if (!controls.models.some((model) => model.alias === call.change.model)) {
        throw new Error(`no model ${call.change.model}`);
      }

      if (call.change.effort !== null && !controls.efforts.includes(call.change.effort)) {
        throw new Error(`no effort level ${call.change.effort}`);
      }

      if (!models) {
        throw new Error("the bridge cannot change models");
      }

      models.enqueue(call.paneId, call.change);

      return null;
    }

    case "prompt":
      await client.request("agent.prompt", {
        target: call.paneId,
        text: promptText(call.text, call.images, uploadDir),
      });

      return null;

    case "keys":
      await client.request("agent.send_keys", { target: call.paneId, keys: call.keys });

      return null;
  }
}
