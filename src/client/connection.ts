import { signal } from "@preact/signals";

import { type AppState, parseStateMessage } from "../shared/messages.ts";
import { isRecord } from "../shared/parse.ts";
import {
  type ClientMessage,
  parseRpcResult,
  type RpcCall,
  UNAUTHORIZED_CLOSE_CODE,
} from "../shared/rpc.ts";

/** The status of the WebSocket connection to the bridge. */
export type LinkStatus = "connecting" | "open" | "closed" | "unpaired";

const TOKEN_KEY = "herdr-bridge-token";

const CALL_TIMEOUT_MS = 15_000;

/** Gives the time to wait before the next connection attempt. The time doubles to a maximum. */
export function reconnectDelay(attempt: number, baseMs = 500, maxMs = 8000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/** Gives the WebSocket URL of the bridge for a page location. */
export function bridgeUrl(location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";

  return `${scheme}//${location.host}/ws`;
}

/** Gives the token in a URL hash such as `#token=abc`, or `null`. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token")?.trim();

  return token ? token : null;
}

/** The last state from the bridge, or `null` before the first message. */
export const appState = signal<AppState | null>(null);

/** The status of the connection to the bridge. */
export const linkStatus = signal<LinkStatus>("connecting");

function readSavedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode can refuse storage. The token in the URL hash still works.
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

let started = false;

let socket: WebSocket | null = null;

let open: (() => void) | null = null;

let nextId = 1;

const pending = new Map<number, Pending>();

function send(message: ClientMessage): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(message));

  return true;
}

function failPending(reason: string): void {
  for (const [id, call] of pending) {
    clearTimeout(call.timer);
    call.reject(new Error(reason));
    pending.delete(id);
  }
}

/** Sends a call to the bridge and gives its result. */
export function call(rpc: RpcCall): Promise<unknown> {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("the bridge did not answer"));
    }, CALL_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });

    if (!send({ type: "rpc", id, call: rpc })) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error("not connected"));
    }
  });
}

/** Uploads an image to the bridge and gives its upload ID. */
export async function uploadImage(image: Blob): Promise<string> {
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": image.type, "x-herdr-token": readSavedToken() ?? "" },
    body: image,
  });

  if (!response.ok) {
    throw new Error(`upload failed: ${await response.text()}`);
  }

  const json: unknown = await response.json();

  if (!isRecord(json) || typeof json.id !== "string") {
    throw new Error("upload failed: the bridge sent no ID");
  }

  return json.id;
}

/** Gets an image of the history from the bridge, as an object URL for an `img` element. */
export async function fetchImage(id: string): Promise<string> {
  const response = await fetch(`/api/image/${encodeURIComponent(id)}`, {
    headers: { "x-herdr-token": readSavedToken() ?? "" },
  });

  if (!response.ok) {
    throw new Error(`image ${id}: ${response.status}`);
  }

  return URL.createObjectURL(await response.blob());
}

/** Saves a new pairing token and connects again with it. */
export function pair(token: string): void {
  saveToken(token.trim());
  open?.();
}

function handleMessage(data: string): void {
  let json: unknown;

  try {
    json = JSON.parse(data);
  } catch {
    return;
  }

  try {
    if (isRecord(json) && json.type === "state") {
      appState.value = parseStateMessage(data).state;

      return;
    }

    const result = parseRpcResult(json);
    const waiting = result ? pending.get(result.id) : undefined;

    if (result && waiting) {
      clearTimeout(waiting.timer);
      pending.delete(result.id);

      if (result.ok) {
        waiting.resolve(result.result);
      } else {
        waiting.reject(new Error(result.error));
      }
    }
  } catch (error) {
    console.error("bad message from the bridge", error);
  }
}

/**
 * Connects to the bridge and keeps `appState` and `linkStatus` up to date. The first message is
 * the pairing token, from the URL hash or from storage. On the home network the bridge does not
 * need the token, so the token can be empty. When the connection stops, it connects
 * again. It also connects again at once when the page becomes visible, because phone browsers stop sockets
 * of pages in the background. A second call does nothing, so that a hot reload of `main.tsx` does
 * not open a second connection.
 */
export function connect(url: string): void {
  if (started) {
    return;
  }

  started = true;

  const fromHash = tokenFromHash(window.location.hash);

  if (fromHash) {
    saveToken(fromHash);
  }

  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  open = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    const token = readSavedToken() ?? tokenFromHash(window.location.hash) ?? "";

    socket?.close();
    linkStatus.value = "connecting";

    const ws = new WebSocket(url);

    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      ws.send(JSON.stringify({ type: "hello", token } satisfies ClientMessage));
      linkStatus.value = "open";
    });

    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") {
        handleMessage(event.data);
      }
    });

    ws.addEventListener("close", (event) => {
      if (socket !== ws) {
        return;
      }

      socket = null;
      failPending("the connection stopped");

      if (event.code === UNAUTHORIZED_CLOSE_CODE) {
        linkStatus.value = "unpaired";

        return;
      }

      linkStatus.value = "closed";
      retryTimer = setTimeout(() => open?.(), reconnectDelay(attempt++));
    });
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket === null) {
      attempt = 0;
      open?.();
    }
  });

  open();
}
