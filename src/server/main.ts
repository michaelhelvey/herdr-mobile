import { networkInterfaces } from "node:os";
import { join } from "node:path";

import { renderUnicodeCompact } from "uqr";

import index from "../../index.html";
import icon192Png from "../../public/icon-192.png" with { type: "file" };
import iconPng from "../../public/icon-512.png" with { type: "file" };
import iconMaskablePng from "../../public/icon-maskable-512.png" with { type: "file" };
import faviconPng from "../../public/favicon.png" with { type: "file" };
import touchIconPng from "../../public/apple-touch-icon.png" with { type: "file" };
import manifest from "../../public/manifest.webmanifest" with { type: "file" };
import type { StateMessage } from "../shared/messages.ts";
import {
  parseClientMessage,
  type RpcResultMessage,
  UNAUTHORIZED_CLOSE_CODE,
  UPLOAD_ID,
} from "../shared/rpc.ts";
import { defaultTokenPath, loadToken, tokenMatches } from "./auth.ts";
import { Bridge } from "./bridge.ts";
import { createHerdrClient, defaultSocketPath } from "./herdr.ts";
import { UPLOAD_IMAGE_PREFIX } from "./history/claude-records.ts";
import { ImageStore } from "./history/images.ts";
import { ModelQueue } from "./model-queue.ts";
import { createHistoryProviders } from "./history/index.ts";
import { handleRpc } from "./rpc.ts";
import { isTrustedRequest } from "./trust.ts";
import {
  defaultUploadDir,
  imageExtension,
  MAX_UPLOAD_BYTES,
  removeOldUploads,
  saveUpload,
} from "./uploads.ts";

const TOPIC = "state";

const socketPath = defaultSocketPath();

const port = Number(process.env.PORT ?? 5173);

const hostname = process.env.HOST ?? "0.0.0.0";

const token = await loadToken(defaultTokenPath());

const client = createHerdrClient(socketPath);

const images = new ImageStore();

const uploadDir = defaultUploadDir();

const histories = createHistoryProviders(client, images, uploadDir);

await removeOldUploads(uploadDir);

/** The public URL of a tunnel to the bridge, for example `https://herdr.example.ts.net`. */
const publicUrl = process.env.HERDR_BRIDGE_PUBLIC_URL?.replace(/\/+$/, "");

/** Set `HERDR_BRIDGE_TRUST_LAN=0` to ask for the token also on the home network. */
const trustLan = process.env.HERDR_BRIDGE_TRUST_LAN !== "0";

interface SocketData {
  /** The socket can use the API. */
  authed: boolean;
  /** The socket came directly from a private network, so it does not need the token. */
  trusted: boolean;
}

/** The data of a new socket. Bun also uses this value to get the type of `ws.data`. */
const NEW_SOCKET: SocketData = { authed: false, trusted: false };

function stateMessage(): string {
  const message: StateMessage = { type: "state", state: models.decorate(bridge.state) };

  return JSON.stringify(message);
}

/**
 * Serves a file from `public/`. The browser must ask again each time (`no-cache`) and gets a 304
 * when the file did not change. Thus a new icon shows when you install the app again.
 */
function staticFile(path: string, type: string): (request: Request) => Promise<Response> {
  let etag: Promise<string> | undefined;

  return async (request) => {
    etag ??= Bun.file(path)
      .bytes()
      .then((bytes) => `"${Bun.hash(bytes).toString(36)}"`);

    const headers = { "content-type": type, "cache-control": "no-cache", etag: await etag };

    if (request.headers.get("if-none-match") === headers.etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(Bun.file(path), { headers });
  };
}

/** Tells if an HTTP request can use the API: it comes from the home network or has the token. */
function authorized(request: Request, ip: string | null): boolean {
  return (
    (trustLan && isTrustedRequest(ip, request.headers)) ||
    tokenMatches(token, request.headers.get("x-herdr-token"))
  );
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((info) => (info && info.family === "IPv4" && !info.internal ? [info.address] : []));
}

const models = new ModelQueue(
  async (paneId, change) => {
    const kind = bridge.state.workspaces
      .flatMap((workspace) => workspace.agents)
      .find((agent) => agent.paneId === paneId)?.kind;

    const provider = kind ? histories.get(kind) : undefined;

    if (!provider) {
      throw new Error("the agent is gone");
    }

    await provider.setModel(paneId, change);
    void bridge.refresh();
  },
  () => server.publish(TOPIC, stateMessage()),
);

const bridge = new Bridge({
  client,
  onState: (state) => {
    models.tick(state);
    server.publish(TOPIC, stateMessage());
  },
});

setInterval(() => models.tick(bridge.state), 2000);

const server = Bun.serve({
  port,
  hostname,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: {
    "/": index,
    "/agent/*": index,
    "/manifest.webmanifest": staticFile(manifest, "application/manifest+json"),
    "/icon-192.png": staticFile(icon192Png, "image/png"),
    "/icon-512.png": staticFile(iconPng, "image/png"),
    "/icon-maskable-512.png": staticFile(iconMaskablePng, "image/png"),
    "/favicon.png": staticFile(faviconPng, "image/png"),
    "/apple-touch-icon.png": staticFile(touchIconPng, "image/png"),
    "/api/upload": {
      POST: async (request, server) => {
        if (!authorized(request, server.requestIP(request)?.address ?? null)) {
          return new Response("not paired", { status: 401 });
        }

        const extension = imageExtension(request.headers.get("content-type"));

        if (!extension) {
          return new Response("expected a PNG, JPEG, GIF, or WebP image", { status: 415 });
        }

        const bytes = new Uint8Array(await request.arrayBuffer());

        if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
          return new Response("the image is empty or too large", { status: 413 });
        }

        const path = await saveUpload(uploadDir, bytes, extension);

        return Response.json({ id: path.slice(uploadDir.length + 1) });
      },
    },
    "/api/image/:id": async (request, server) => {
      if (!authorized(request, server.requestIP(request)?.address ?? null)) {
        return new Response("not paired", { status: 401 });
      }

      const id = request.params.id;
      const name = id.startsWith(UPLOAD_IMAGE_PREFIX) ? id.slice(UPLOAD_IMAGE_PREFIX.length) : null;

      if (name !== null) {
        const file = UPLOAD_ID.test(name) ? Bun.file(join(uploadDir, name)) : null;

        return file && (await file.exists())
          ? new Response(file, { headers: { "cache-control": "private, max-age=86400" } })
          : new Response("not found", { status: 404 });
      }

      const image = images.get(id);

      return image
        ? new Response(image.bytes, {
            headers: { "content-type": image.mediaType, "cache-control": "private, max-age=86400" },
          })
        : new Response("not found", { status: 404 });
    },
    "/ws": (request, server) => {
      const ip = server.requestIP(request)?.address ?? null;
      const trusted = trustLan && isTrustedRequest(ip, request.headers);

      if (server.upgrade(request, { data: { authed: false, trusted } })) {
        return undefined;
      }

      return new Response("expected a websocket upgrade", { status: 426 });
    },
  },
  websocket: {
    data: NEW_SOCKET,
    open(ws) {
      setTimeout(() => {
        if (!ws.data.authed) {
          ws.close(UNAUTHORIZED_CLOSE_CODE, "not paired");
        }
      }, 5000);
    },
    async message(ws, raw) {
      let message;

      try {
        message = parseClientMessage(String(raw));
      } catch (error) {
        ws.close(1008, error instanceof Error ? error.message : "bad message");

        return;
      }

      if (!ws.data.authed) {
        const allowed =
          message.type === "hello" && (ws.data.trusted || tokenMatches(token, message.token));

        if (!allowed) {
          ws.close(UNAUTHORIZED_CLOSE_CODE, "not paired");

          return;
        }

        ws.data.authed = true;
        ws.subscribe(TOPIC);
        ws.send(stateMessage());

        return;
      }

      if (message.type !== "rpc") {
        return;
      }

      let answer: RpcResultMessage;

      try {
        const result = await handleRpc(message.call, {
          client,
          state: bridge.state,
          providers: histories,
          uploadDir,
          models,
        });

        answer = { type: "rpc_result", id: message.id, ok: true, result };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);

        answer = { type: "rpc_result", id: message.id, ok: false, error: text };
      }

      ws.send(JSON.stringify(answer));

      if (message.call.method === "prompt" || message.call.method === "keys") {
        void bridge.refresh();
      }
    },
  },
});

await bridge.start();

function printQr(title: string, url: string) {
  console.log(`\n${title}\n  ${url}\n`);
  console.log(
    renderUnicodeCompact(url, { border: 2 })
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );
}

console.log(`herdr bridge on port ${server.port} (socket ${socketPath})`);

const lanUrl = (hostname === "0.0.0.0" ? lanAddresses() : [hostname]).map(
  (address) => `http://${address}:${server.port}/`,
)[0];

if (lanUrl) {
  printQr(
    trustLan ? "On your home network (no pairing needed):" : "On your home network:",
    trustLan ? lanUrl : `${lanUrl}#token=${token}`,
  );
}

if (publicUrl) {
  printQr("Away from home (scan once to pair this phone):", `${publicUrl}/#token=${token}`);
} else {
  console.log("\nSet HERDR_BRIDGE_PUBLIC_URL to the URL of your tunnel to get a pairing code.");
}
