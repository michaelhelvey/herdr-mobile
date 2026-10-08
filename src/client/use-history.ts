import { useEffect, useState } from "preact/hooks";

import type { AgentStatus } from "../shared/messages.ts";
import { applyHistory, type HistoryState, parseHistory } from "../shared/history.ts";
import { call } from "./connection.ts";

/** `unsupported` means that the bridge cannot read the session files of this agent kind. */
export type HistoryMode = "loading" | "ready" | "unsupported";

/** The conversation of one agent from its session files. */
export interface AgentHistory {
  mode: HistoryMode;
  state: HistoryState | null;
  reload: () => void;
}

/** Gives the time to wait before the next history poll for an agent status. */
export function historyDelay(status: AgentStatus): number {
  return status === "working" ? 1000 : 4000;
}

/**
 * Polls the history of an agent. Each poll asks only for the items after the items that the PWA
 * has. If the bridge has no history for the agent kind, the mode becomes `unsupported`.
 */
export function useHistory(paneId: string, status: AgentStatus, connected: boolean): AgentHistory {
  const [state, setState] = useState<HistoryState | null>(null);
  const [mode, setMode] = useState<HistoryMode>("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!connected || mode === "unsupported") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let known: HistoryState | null = state;

    async function poll() {
      try {
        const since = known ? known.base + known.items.length : null;
        const next = parseHistory(await call({ method: "history", paneId, since }));

        if (cancelled) {
          return;
        }

        known = applyHistory(known, next);
        setState(known);
        setMode("ready");
      } catch (problem) {
        const message = problem instanceof Error ? problem.message : String(problem);

        if (message.startsWith("no history")) {
          if (!cancelled) {
            setMode("unsupported");
          }

          return;
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void poll(), historyDelay(status));
      }
    }

    void poll();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
    // `state` is only the start value of each poll loop. A new loop must not start when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, status, connected, mode, nonce]);

  return { mode, state, reload: () => setNonce((value) => value + 1) };
}
