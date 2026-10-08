import { isRecord, record } from "../../shared/parse.ts";
import type { HerdrClient } from "../herdr.ts";

/**
 * The session that the integration of an agent reported to Herdr. `path` is a session file.
 * `id` is a session ID that the harness keeps in its own store.
 */
export interface AgentSessionRef {
  kind: "path" | "id";
  value: string;
}

/** Gives the session that the agent in the pane reported, or `null` if it did not report one. */
export async function agentSession(
  client: HerdrClient,
  paneId: string,
): Promise<AgentSessionRef | null> {
  const result = record(await client.request("agent.get", { target: paneId }), "result");
  const agent = record(result.agent, "result.agent");
  const session = agent.agent_session;

  if (!isRecord(session) || typeof session.value !== "string" || session.value === "") {
    return null;
  }

  if (session.kind !== "path" && session.kind !== "id") {
    return null;
  }

  return { kind: session.kind, value: session.value };
}
