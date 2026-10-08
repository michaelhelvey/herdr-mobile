import type { ModelChange } from "./harness.ts";
import { array, isRecord, number, ParseError, record, string } from "./parse.ts";

/** The keys that the PWA can send to an agent. Herdr accepts more, but the PWA needs only these. */
export const ALLOWED_KEYS = [
  "esc",
  "enter",
  "up",
  "down",
  "left",
  "right",
  "tab",
  "shift+tab",
  "space",
  "ctrl+c",
  "1",
  "2",
  "3",
  "4",
  "5",
  "y",
  "n",
  "s",
] as const;

/** A key that the PWA can send to an agent. */
export type AllowedKey = (typeof ALLOWED_KEYS)[number];

/** The Herdr read sources that the PWA can ask for. See `docs/protocol.md`. */
export const READ_SOURCES = ["recent_unwrapped", "visible"] as const;

/** A Herdr read source that the PWA can ask for. */
export type ReadSource = (typeof READ_SOURCES)[number];

/** The calls that the PWA can make on the bridge. Each call has a target agent pane. */
export type RpcCall =
  | { method: "read"; paneId: string; source: ReadSource }
  | { method: "history"; paneId: string; since: number | null }
  | { method: "controls"; paneId: string }
  | { method: "dialog"; paneId: string }
  | { method: "choose"; paneId: string; index: number; labels: string[] }
  | { method: "setModel"; paneId: string; change: ModelChange }
  | {
      method: "prompt";
      paneId: string;
      text: string;
      /** The IDs that `/api/upload` gave for the images of the message. */
      images: string[];
    }
  | { method: "keys"; paneId: string; keys: AllowedKey[] };

/** The text of an agent pane. */
export interface ReadResult {
  text: string;
  revision: number;
}

/** A message from the PWA to the bridge. */
export type ClientMessage =
  { type: "hello"; token: string } | { type: "rpc"; id: number; call: RpcCall };

/** The answer of the bridge to one `rpc` message. */
export type RpcResultMessage =
  | { type: "rpc_result"; id: number; ok: true; result: unknown }
  | { type: "rpc_result"; id: number; ok: false; error: string };

/** The WebSocket close code that the bridge sends when the pairing token is not correct. */
export const UNAUTHORIZED_CLOSE_CODE = 4001;

/** An ID that `/api/upload` gives. It is the name of a file in the upload folder. */
export const UPLOAD_ID = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/;

/** The most images in one message. */
export const MAX_IMAGES = 8;

/** The longest prompt that the bridge accepts. */
export const MAX_PROMPT_LENGTH = 20_000;

function isAllowedKey(value: string): value is AllowedKey {
  return ALLOWED_KEYS.some((key) => key === value);
}

function parseCall(value: unknown): RpcCall {
  const call = record(value, "call");
  const paneId = string(call.paneId, "call.paneId");

  switch (call.method) {
    case "read": {
      const source = READ_SOURCES.find((name) => name === call.source);

      if (!source) {
        throw new ParseError("call.source: expected recent_unwrapped or visible");
      }

      return { method: "read", paneId, source };
    }

    case "controls":
    case "dialog":
      return { method: call.method, paneId };

    case "choose": {
      const index = number(call.index, "call.index");

      if (!Number.isInteger(index) || index < 0) {
        throw new ParseError("call.index: expected a whole number");
      }

      return {
        method: "choose",
        paneId,
        index,
        labels: array(call.labels, "call.labels").map((label, i) =>
          string(label, `call.labels[${i}]`),
        ),
      };
    }

    case "setModel": {
      const change = record(call.change, "call.change");
      const scope = change.scope;

      if (scope !== "session" && scope !== "default") {
        throw new ParseError("call.change.scope: expected session or default");
      }

      return {
        method: "setModel",
        paneId,
        change: {
          model: string(change.model, "call.change.model"),
          effort: change.effort === null ? null : string(change.effort, "call.change.effort"),
          scope,
        },
      };
    }

    case "history": {
      const since = call.since;

      if (since !== null && (typeof since !== "number" || !Number.isInteger(since) || since < 0)) {
        throw new ParseError("call.since: expected a whole number or null");
      }

      return { method: "history", paneId, since };
    }

    case "prompt": {
      const text = string(call.text, "call.text");

      const images = array(call.images ?? [], "call.images").map((image, index) => {
        const id = string(image, `call.images[${index}]`);

        if (!UPLOAD_ID.test(id)) {
          throw new ParseError(`call.images[${index}]: not an upload ID`);
        }

        return id;
      });

      if ((text.trim().length === 0 && images.length === 0) || text.length > MAX_PROMPT_LENGTH) {
        throw new ParseError(`call.text: expected 1 to ${MAX_PROMPT_LENGTH} characters`);
      }

      if (images.length > MAX_IMAGES) {
        throw new ParseError(`call.images: expected at most ${MAX_IMAGES} images`);
      }

      return { method: "prompt", paneId, text, images };
    }

    case "keys": {
      const keys = array(call.keys, "call.keys").map((key, index) => {
        const name = string(key, `call.keys[${index}]`);

        if (!isAllowedKey(name)) {
          throw new ParseError(`call.keys[${index}]: key "${name}" is not allowed`);
        }

        return name;
      });

      if (keys.length === 0 || keys.length > 10) {
        throw new ParseError("call.keys: expected 1 to 10 keys");
      }

      return { method: "keys", paneId, keys };
    }

    default:
      throw new ParseError("call.method: expected a method of the bridge");
  }
}

/** Parses one message from the PWA. Throws a `ParseError` if the message is not valid. */
export function parseClientMessage(raw: string): ClientMessage {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new ParseError("message: not valid JSON");
  }

  const message = record(json, "message");

  if (message.type === "hello") {
    return { type: "hello", token: string(message.token, "message.token") };
  }

  if (message.type === "rpc") {
    return { type: "rpc", id: number(message.id, "message.id"), call: parseCall(message.call) };
  }

  throw new ParseError("message.type: expected hello or rpc");
}

/** Gives the `rpc_result` message in the JSON, or `null` if it is a different message. */
export function parseRpcResult(json: unknown): RpcResultMessage | null {
  if (!isRecord(json) || json.type !== "rpc_result") {
    return null;
  }

  const id = number(json.id, "message.id");

  if (json.ok === true) {
    return { type: "rpc_result", id, ok: true, result: json.result };
  }

  return { type: "rpc_result", id, ok: false, error: string(json.error, "message.error") };
}

/** Parses the result of a `read` call. */
export function parseReadResult(value: unknown): ReadResult {
  const result = record(value, "result");

  return {
    text: string(result.text, "result.text"),
    revision: number(result.revision, "result.revision"),
  };
}
