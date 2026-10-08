---
name: verify-herdr-pwa
description:
  Drive the real herdr PWA (the phone web app in this repo) end to end and capture proof. It starts
  an isolated Herdr session, the bridge from this checkout, and a headless iPhone-size Chrome, then
  makes fake agents and checks what the phone screen shows. Use it to prove that a change to the
  bridge, the PWA, or the Herdr wire protocol works in the real app, not only in `bun test`.
---

# verify-herdr-pwa

The app is a web PWA (`index.html`, `src/app.tsx`) that the bridge (`src/server/main.ts`) serves.
The bridge reads a Herdr server through its Unix socket and pushes the state to the PWA on `/ws`.
The user touches the PWA on a phone. This skill drives that PWA in headless Chrome at 390x844 (DPR
3, iPhone user agent).

All helpers are in `.claude/skills/verify-herdr-pwa/scripts/`. Run them from the repo root. Each run
has a name (`[a-z0-9-]`, for example `demo`). All state of a run is in `.verify/<run>/`
(git-ignored).

```sh
S=.claude/skills/verify-herdr-pwa/scripts
```

## Isolation (read this first)

- **Never point the bridge at the user's Herdr.** The user's session (`default`,
  `~/.config/herdr/herdr.sock`) has real agents. `up.sh` starts a separate headless Herdr session
  named `verify-<run>` with its own socket. Use `$S/herdr.sh <run> ...` for every herdr command; a
  bare `herdr` command can talk to the user's session.
- **Do not touch port 5173.** The user often runs `bun run dev` there. `up.sh` takes free ports for
  the bridge and for Chrome DevTools.
- Two runs with different names can run side by side.
- `up.sh` removes `HERDR_BRIDGE_PUBLIC_URL` (the user's tunnel URL) from the bridge environment and
  sets `HERDR_BRIDGE_TRUST_LAN` itself, so the user's shell does not change a run.
- For a `claude` agent, the bridge reads Claude Code session files in the real `~/.claude/` (read
  only). It finds them by the PID of the pane foreground process, so a fake agent never matches a
  real session. Do not change `~/.claude/`.
- If you run inside a Herdr pane, `HERDR_ENV`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH` point at the
  user's session. The scripts remove them. Do not export them again.

## Launch

```sh
$S/up.sh demo
# ready: run=demo url=http://127.0.0.1:61990/ pair-url=http://127.0.0.1:61990/#token=verify-demo-token trust-lan=1 cdp=61999 herdr-session=verify-demo
TRUST_LAN=0 $S/up.sh pair   # the bridge asks for the token also from 127.0.0.1 (pairing tests)
```

By default (`TRUST_LAN=1`) the bridge trusts 127.0.0.1 like a phone on the home network, so the PWA
connects with no token. A wrong token is also accepted then. Use `TRUST_LAN=0` to test pairing.

`up.sh` starts, in this order, and waits for each one:

1. `herdr --session verify-<run> server` (ready when `workspace list` answers on its socket).
2. `bun ./src/server/main.ts` from this checkout with `HERDR_SOCKET_PATH` = the isolated socket,
   `HOST=127.0.0.1`, a free `PORT`, `HERDR_BRIDGE_TOKEN=verify-<run>-token` (so it does not write
   `~/.config/herdr-bridge/token`), `HERDR_BRIDGE_TRUST_LAN=$TRUST_LAN`, and `NODE_ENV=production`.
   Ready when `GET /` gives 200. It runs the source, so the proof covers your uncommitted changes.
   `NODE_ENV=production` turns off hot reload: the run serves the code as it was at `up.sh` time.
   This is necessary because other agents can change `src/` during a run, and a hot reload in the
   middle of a drive breaks it. After you change code, run `down.sh` and `up.sh` again.
3. Headless Chrome with a scratch profile in `.verify/<run>/chrome-profile`.

The ports, PIDs, URL, and token go into `.verify/<run>/state.env`. Logs go into
`.verify/<run>/logs/` (`herdr.log`, `bridge.log`, `chrome.log`).

## Doctor

```sh
$S/doctor.sh demo
```

Read only. It checks: the Herdr session runs, the bridge PID is alive and owns the port, `GET /`
serves the PWA, a paired `/ws` sends a state with `herdr.ok=true`, Chrome DevTools answers. Run it
first when anything looks wrong. If it fails, read `.verify/<run>/logs/`, then `down.sh` and
`up.sh`.

## Drive

Fake agents (no real agent runs; a plain shell pane gets a reported kind and status through
`herdr pane report-agent`):

```sh
P=$($S/agent.sh demo add alpha claude working)   # new workspace "alpha", prints the pane ID, e.g. w1:p1
$S/agent.sh demo set "$P" claude blocked          # change the status: idle | working | blocked | unknown
$S/agent.sh demo close-workspace w1
$S/herdr.sh demo agent list                       # what Herdr itself says
```

`done` cannot be reported. Herdr sets it when a turn ends unseen.

A fake agent cannot get a prompt or keys. Herdr (0.9.3) accepts `agent.prompt` and `agent.send_keys`
only for an agent that it detected from the real foreground process. For a fake agent it gives
`agent_not_ready`, and the PWA shows `Not sent`. See `features/agent-screen.md`.

Use kind `codex` (or another kind that is not `claude`) to see terminal text on the agent screen. A
fake `claude` agent goes to the Claude history path and shows `Nothing here yet`.

The browser (`cdp.ts`, one page that stays open between calls, so its `/ws` stays open too):

```sh
$S/cdp.ts demo open "/"                            # load (trusted run, no token needed)
$S/cdp.ts demo wait ".pill" "Live"                # wait for css (+ optional text, + timeout ms)
$S/cdp.ts demo gone ".agent" "codex"               # wait until no match
$S/cdp.ts demo agents                              # agent rows on screen as JSON
$S/cdp.ts demo text main                           # innerText of an element
$S/cdp.ts demo shot 01-list                        # .verify/demo/evidence/01-list.png
$S/cdp.ts demo click ".agent" "codex"             # real mouse click on the first match with that text
$S/cdp.ts demo click 'textarea[aria-label="Message"]' && $S/cdp.ts demo type "echo hi"
$S/cdp.ts demo key Enter                           # Enter | Escape | Tab | Backspace
$S/cdp.ts demo eval "location.pathname"            # read-only inspection
$S/cdp.ts demo ws                                  # what the bridge pushes to a paired client
```

Stable handles in the PWA today (`src/app.tsx`, `src/client/views/`):

- Header: `.pill` (`Live`, `Connecting`, `Offline`, `Herdr down`). `.banner` when Herdr is down.
- Pair screen (only with `TRUST_LAN=0`): `.pair`, `details.pair-manual > summary` (click it first),
  `input[aria-label="Pairing token"]`, `.pair-form button[type=submit]`.
- List (`views/list.tsx`): `.summary`, `section.workspace > h2`, `section.workspace.needs-you`
  (copies of blocked agents, on top), `button.agent.status-<status>` (a row; tap opens the agent),
  `.agent-title`, `.agent-meta` (`kind · dir`), `.status-label` (`Working`, `Needs you`, `Done`,
  `Idle`, `Unknown`).
- Agent screen (`views/agent.tsx`, `views/chat.tsx`): `button[aria-label="Back"]`, `.detail-title`,
  `.detail-sub`, `.transcript`, `pre.msg-terminal`, `.msg-pending`, `.msg-failed`, `.typing`,
  `.sheet` with `.sheet-title` and `.keypad .key` (blocked agents),
  `textarea[aria-label="Message"]`, `button[aria-label="Send"]`,
  `button[aria-label="Stop the agent"]`, `.toast[role=alert]`, `.gone`.

`text` and `wait` use `innerText`, which gives the CSS text transform. Text that CSS shows in upper
case (`h2` labels, `.sheet-title`) must be upper case in a `wait`.

The UI changes fast. When a selector fails, read the views and update this file and the feature map.

Wait for state, do not sleep. Each `wait` polls every 100 ms.

## Evidence

Put proof in `.verify/<run>/evidence/` (screenshots from `shot`, plus text you save, for example
`$S/cdp.ts demo agents > .verify/demo/evidence/02-agents.json`). Number the files in the order of
the steps. `logs/` is evidence too.

Proof standards:

- Go through the real user path: the page in Chrome, paired with the token in the URL hash, and
  changes in Herdr that come through the bridge. Do not set signals or call internal functions.
  `cdp.ts ws` and `herdr.sh` are for side-effect checks, not a replacement for the screen.
- Capture the action and the result: a screenshot before and after, and the `agents` JSON.
- Prove live updates without a reload: change Herdr state after `open`, then `wait` for the new
  state on the same page.
- Check side effects where they happen: for a prompt or keys from the PWA, read the pane with
  `$S/herdr.sh <run> pane read <pane> --source recent` and find the text. This needs a real detected
  agent (see Drive). A text on the screen alone is not proof: the pending bubble shows it before
  Herdr answers.
- Fake agents are the one mock. They sit at the Herdr boundary (`pane report-agent` is the API that
  real agent integrations use), so the bridge and the PWA run unchanged.

## Cleanup

```sh
$S/down.sh demo
```

It kills only the Chrome and bridge PIDs in `state.env`, stops and deletes the `verify-<run>` Herdr
session, and removes `chrome-profile/` and `state.env`. It keeps `.verify/<run>/evidence/` and
`.verify/<run>/logs/`. Never kill by process name (`pkill bun`, `pkill Chrome`): the user runs their
own bun and Chrome. Never stop the `default` Herdr session. Run `down.sh` after a failed attempt
too, before you try again. To remove old evidence, delete `.verify/<run>/` yourself. Use a literal
path, never a variable with a glob.

## Feature map

`features/README.md` lists the user-facing features and how to prove each one. A proof that drives
one entry point is not complete when the map lists more. Update the map when the app changes.
