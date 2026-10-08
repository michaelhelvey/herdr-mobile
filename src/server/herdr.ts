import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord, record, string } from "../shared/parse.ts";
import { LineBuffer } from "./lines.ts";

/** An error that the Herdr server sent in a response. */
export class HerdrError extends Error {
  override name = "HerdrError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** One subscription of `events.subscribe`. See `docs/protocol.md`. */
export type HerdrSubscription =
  | { type: "workspace.created" | "workspace.updated" | "workspace.renamed" | "workspace.closed" }
  | { type: "tab.created" | "tab.closed" }
  | { type: "pane.created" | "pane.closed" | "pane.exited" | "pane.updated" }
  | { type: "pane.agent_detected" }
  | { type: "pane.agent_status_changed"; pane_id: string };

/** The functions that a subscription calls. */
export interface SubscriptionHandlers {
  /** Herdr sent an event. */
  onEvent(event: unknown): void;
  /** The subscription stopped. `error` is `undefined` when `close()` stopped it. */
  onClose(error?: Error): void;
}

/** An open subscription. */
export interface SubscriptionHandle {
  close(): void;
}

/** The part of the Herdr socket API that the bridge uses. */
export interface HerdrClient {
  /** Sends one request and gives the `result` of the response. */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** Opens a subscription. The connection stays open until `close()` or an error. */
  subscribe(subscriptions: HerdrSubscription[], handlers: SubscriptionHandlers): SubscriptionHandle;
}

/** Gives the path of the Herdr socket. `HERDR_SOCKET_PATH` overrides the default path. */
export function defaultSocketPath(): string {
  return process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock");
}

/** Gives the `result` of a response line, or throws a `HerdrError` for an error response. */
export function parseResponse(line: string): unknown {
  const response = record(JSON.parse(line), "response");

  if (isRecord(response.error)) {
    throw new HerdrError(
      string(response.error.code, "response.error.code"),
      string(response.error.message, "response.error.message"),
    );
  }

  if (!("result" in response)) {
    throw new HerdrError("bad_response", "response has no result and no error");
  }

  return response.result;
}

/**
 * Makes a client for the Herdr socket. Herdr closes a connection after one response, so each
 * request uses a new connection.
 */
export function createHerdrClient(socketPath: string, timeoutMs = 5000): HerdrClient {
  let nextId = 1;

  function open(onLine: (line: string) => void, onEnd: (error?: Error) => void): Socket {
    const socket = createConnection({ path: socketPath });
    const lines = new LineBuffer();
    let ended = false;

    function end(error?: Error) {
      if (!ended) {
        ended = true;
        onEnd(error);
      }
    }

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => lines.push(chunk).forEach(onLine));
    socket.on("error", (error) => end(error));
    socket.on("close", () => end(new Error("herdr closed the connection")));

    return socket;
  }

  function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `bridge-${nextId++}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      function settle(action: () => void) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          action();
        }
      }

      const socket = open(
        (line) => {
          settle(() => {
            try {
              resolve(parseResponse(line));
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        },
        (error) => settle(() => reject(error ?? new Error("herdr closed the connection"))),
      );

      const timer = setTimeout(
        () => settle(() => reject(new HerdrError("timeout", `${method} took too long`))),
        timeoutMs,
      );

      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  function subscribe(
    subscriptions: HerdrSubscription[],
    handlers: SubscriptionHandlers,
  ): SubscriptionHandle {
    const id = `bridge-sub-${nextId++}`;
    let started = false;
    let closed = false;

    const socket = open(
      (line) => {
        if (closed) {
          return;
        }

        try {
          if (!started) {
            parseResponse(line);
            started = true;

            return;
          }

          handlers.onEvent(JSON.parse(line));
        } catch (error) {
          closed = true;
          socket.destroy();
          handlers.onClose(error instanceof Error ? error : new Error(String(error)));
        }
      },
      (error) => {
        if (!closed) {
          closed = true;
          handlers.onClose(error);
        }
      },
    );

    socket.write(
      `${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } })}\n`,
    );

    return {
      close() {
        if (!closed) {
          closed = true;
          socket.destroy();
          handlers.onClose();
        }
      },
    };
  }

  return { request, subscribe };
}
