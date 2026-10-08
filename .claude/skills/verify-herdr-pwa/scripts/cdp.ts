#!/usr/bin/env bun
/**
 * Drives the headless Chrome of a verification run through the Chrome DevTools Protocol. Each call
 * connects to the same page, so the page keeps its WebSocket to the bridge between calls.
 *
 * Usage: bun cdp.ts <run> <command> [args]
 *   open [path]                       go to the bridge URL (plus path) and wait for the load
 *   wait <css> [text] [timeoutMs]     wait until an element matches (and contains text)
 *   gone <css> [text] [timeoutMs]     wait until no element matches (with that text)
 *   click <css> [text]                real mouse click on the center of the first match
 *   type <text>                       insert text into the focused element (real input events)
 *   key <key>                         press a key on the focused element, e.g. Enter, Escape
 *   text [css]                        print the innerText of the element (default: body)
 *   agents                            print the agent rows on the screen as JSON
 *   shot <name>                       save a screenshot to evidence/<name>.png
 *   eval <js>                         print the value of a JS expression (read only, please)
 *   ws                                pair on /ws with the run token, print the first state message
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../../..");

const [run, command, ...args] = process.argv.slice(2);

if (!run || !command) {
  console.error(readFileSync(import.meta.path, "utf8").split("*/")[0]);
  process.exit(2);
}

const runDir = join(REPO, ".verify", run);

function loadState(): Record<string, string> {
  let text: string;

  try {
    text = readFileSync(join(runDir, "state.env"), "utf8");
  } catch {
    console.error(`error: no run '${run}'. Start it with up.sh ${run}.`);
    process.exit(1);
  }

  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const state = loadState();

function need(key: string): string {
  const value = state[key];

  if (!value) {
    throw new Error(`state.env has no ${key}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pageSocketUrl(): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${need("CDP_PORT")}/json/list`);
  const targets: unknown = await response.json();

  const origin = new URL(need("URL")).origin;

  const pages = (Array.isArray(targets) ? targets : []).flatMap((target) =>
    isRecord(target) &&
    target.type === "page" &&
    typeof target.url === "string" &&
    typeof target.webSocketDebuggerUrl === "string"
      ? [{ url: target.url, socket: target.webSocketDebuggerUrl }]
      : [],
  );

  // Chrome can also list its own pages (for example chrome:// pages), so use the page of the
  // bridge. Before the first `open`, that page is still about:blank.
  const page =
    pages.find((p) => p.url.startsWith(origin)) ?? pages.find((p) => p.url === "about:blank");

  if (page) {
    return page.socket;
  }

  throw new Error("chrome has no page of the bridge. Run doctor.sh.");
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

async function connect(): Promise<Cdp> {
  const socket = new WebSocket(await pageSocketUrl());
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message: unknown = JSON.parse(String(event.data));

    if (isRecord(message) && typeof message.id === "number") {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });

  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done());
    socket.addEventListener("error", () => fail(new Error("cannot connect to chrome")));
  });

  return {
    send(method, params = {}) {
      const id = nextId++;

      return new Promise((done, fail) => {
        pending.set(id, (message) => {
          if (isRecord(message.error)) {
            fail(new Error(`${method}: ${JSON.stringify(message.error)}`));
          } else {
            done(isRecord(message.result) ? message.result : {});
          }
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (isRecord(result.exceptionDetails)) {
    throw new Error(`page threw: ${JSON.stringify(result.exceptionDetails)}`);
  }

  return isRecord(result.result) ? result.result.value : undefined;
}

function matchExpression(css: string, text: string): string {
  return `[...document.querySelectorAll(${JSON.stringify(css)})].some((el) => el.innerText.includes(${JSON.stringify(text)}))`;
}

async function poll(cdp: Cdp, expression: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    if ((await evaluate(cdp, expression)) === true) {
      return true;
    }

    await Bun.sleep(100);
  }

  return false;
}

async function firstBridgeMessage(): Promise<string> {
  const url = `ws://127.0.0.1:${need("PORT")}/ws`;
  const socket = new WebSocket(url);

  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no message from ${url} in 5 s`)), 5000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "hello", token: need("TOKEN") }));
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      fail(new Error(`bridge closed /ws: ${event.code} ${event.reason}`));
    });
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      socket.close();
      done(String(event.data));
    });
    socket.addEventListener("error", () => fail(new Error(`cannot connect to ${url}`)));
  });
}

const AGENTS_JS = `[...document.querySelectorAll("section.workspace")].map((section) => ({
  workspace: section.querySelector("h2")?.textContent ?? null,
  needsYou: section.classList.contains("needs-you"),
  agents: [...section.querySelectorAll(".agent")].map((li) => ({
    title: li.querySelector(".agent-title")?.innerText ?? null,
    meta: li.querySelector(".agent-meta")?.innerText ?? null,
    statusClass: [...li.classList].find((c) => c.startsWith("status-")) ?? null,
    label: li.querySelector(".status-label")?.innerText ?? null,
  })),
}))`;

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
};

async function click(cdp: Cdp, css: string, text: string): Promise<void> {
  const point = await evaluate(
    cdp,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(css)})]
        .find((e) => e.innerText.includes(${JSON.stringify(text)}));
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
  );

  if (!isRecord(point) || typeof point.x !== "number" || typeof point.y !== "number") {
    throw new Error(`no element for click: ${css} ${JSON.stringify(text)}`);
  }

  const at = { x: point.x, y: point.y, button: "left", clickCount: 1 };

  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

async function main(): Promise<void> {
  if (command === "ws") {
    console.log(await firstBridgeMessage());

    return;
  }

  const cdp = await connect();

  try {
    switch (command) {
      case "open": {
        await cdp.send("Page.enable");
        await cdp.send("Page.navigate", { url: new URL(args[0] ?? "", need("URL")).href });

        const loaded = await poll(cdp, `document.readyState === "complete"`, 10_000);

        console.log(loaded ? "loaded" : "error: page did not load in 10 s");
        process.exitCode = loaded ? 0 : 1;
        break;
      }

      case "wait":
      case "gone": {
        const [css, text = "", timeout = "5000"] = args;

        if (!css) {
          throw new Error(`${command} needs a css selector`);
        }

        const found = matchExpression(css, text);
        const ok = await poll(cdp, command === "wait" ? found : `!(${found})`, Number(timeout));

        console.log(ok ? "ok" : `error: timeout: ${command} ${css} ${JSON.stringify(text)}`);
        process.exitCode = ok ? 0 : 1;
        break;
      }

      case "click": {
        const [css, text = ""] = args;

        if (!css) {
          throw new Error("click needs a css selector");
        }

        await click(cdp, css, text);
        console.log("ok");
        break;
      }

      case "type":
        await cdp.send("Input.insertText", { text: args.join(" ") });
        console.log("ok");
        break;
      case "key": {
        const name = args[0] ?? "";
        const key = KEYS[name];

        if (!key) {
          throw new Error(`key must be one of: ${Object.keys(KEYS).join(", ")}`);
        }

        const base = { key: name, code: key.code, windowsVirtualKeyCode: key.keyCode };

        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key.text });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
        console.log("ok");
        break;
      }

      case "text": {
        const css = JSON.stringify(args[0] ?? "body");

        console.log(await evaluate(cdp, `document.querySelector(${css})?.innerText ?? null`));
        break;
      }

      case "agents":
        console.log(JSON.stringify(await evaluate(cdp, AGENTS_JS), null, 2));
        break;
      case "shot": {
        const name = args[0];

        if (!name || !/^[\w.-]+$/.test(name)) {
          throw new Error("shot needs a file name such as 01-home");
        }

        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });

        if (typeof shot.data !== "string") {
          throw new Error("chrome sent no screenshot data");
        }

        const dir = join(runDir, "evidence");
        const file = join(dir, `${name}.png`);

        mkdirSync(dir, { recursive: true });
        await Bun.write(file, Buffer.from(shot.data, "base64"));
        console.log(file);
        break;
      }

      case "eval":
        console.log(JSON.stringify(await evaluate(cdp, args.join(" ")), null, 2));
        break;
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } finally {
    cdp.close();
  }
}

await main();
