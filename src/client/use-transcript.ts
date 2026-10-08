import { useEffect, useMemo, useState } from "preact/hooks";

import type { AgentStatus } from "../shared/messages.ts";
import { parseReadResult } from "../shared/rpc.ts";
import { adapterFor } from "./agents/registry.ts";
import type { Block } from "./agents/types.ts";
import { call } from "./connection.ts";
import { mergeScreen } from "./merge.ts";

/** The time between two reads while the agent is busy or waits for the user. */
const FAST_POLL_MS = 1200;

/** The time between two reads while the agent is ready for input. */
const SLOW_POLL_MS = 5000;

/** The transcript of one agent, as the detail screen shows it. */
export interface Transcript {
  /** `null` until the first read completes. */
  blocks: Block[] | null;
  /** The text of the dialog when the agent is `blocked`, else `null`. */
  dialog: string | null;
  error: string | null;
  /** Reads the screen again now, for example after the PWA sends a prompt. */
  reload: () => void;
}

/** Gives the time to wait before the next read for an agent status. */
export function pollDelay(status: AgentStatus): number {
  return status === "working" || status === "blocked" ? FAST_POLL_MS : SLOW_POLL_MS;
}

/**
 * Reads the screen of an agent at an interval. Each read gets only the rows that Herdr keeps, and
 * `mergeScreen` joins them, so the transcript keeps the lines that scroll off while it is open. It
 * changes the text into blocks with the adapter for the agent kind. It reads again at once when
 * the status changes or the connection opens again.
 */
export function useTranscript(
  paneId: string,
  kind: string,
  status: AgentStatus,
  connected: boolean,
  enabled = true,
): Transcript {
  const adapter = adapterFor(kind);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!connected || !enabled) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const result = parseReadResult(
          await call({ method: "read", paneId, source: adapter.source }),
        );

        if (!cancelled) {
          setText((older) => (older === null ? result.text : mergeScreen(older, result.text)));
          setError(null);
        }
      } catch (problem) {
        if (!cancelled) {
          setError(problem instanceof Error ? problem.message : String(problem));
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void load(), pollDelay(status));
      }
    }

    void load();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [paneId, adapter.source, status, connected, enabled, nonce]);

  const blocks = useMemo(() => (text === null ? null : adapter.parse(text)), [adapter, text]);

  const dialog = useMemo(
    () => (status === "blocked" && text !== null ? adapter.dialog(text) : null),
    [adapter, status, text],
  );

  return { blocks, dialog, error, reload: () => setNonce((value) => value + 1) };
}
