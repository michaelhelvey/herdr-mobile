# Agent screen: transcript, prompt, keys

A screen for one agent at `/agent/<paneId>` (`src/client/routes.ts`, `src/client/views/agent.tsx`).
It shows what the agent did, a composer to send a prompt, a Stop button while the agent works, and a
key sheet when the agent is blocked. The bridge side is `src/server/rpc.ts` (RPC `read`, `history`,
`prompt`, `keys`).

The screen has two sources, selected by the agent kind:

- **History** (kind `claude` only, `src/server/history/claude.ts`). The bridge finds the Claude Code
  session file from the PID of the pane foreground process (`~/.claude/sessions/<pid>.json`, then
  `~/.claude/projects/<cwd slug>/<id>.jsonl`). The screen shows it as chat
  (`src/client/views/chat.tsx`): Markdown, tool runs, diff cards. It never shows terminal text.
- **Terminal** (all other kinds). The screen polls `agent.read` and shows the text in
  `pre.msg-terminal` (`src/client/agents/generic.ts`; `opencode` has its own adapter).

## Sub-features

- Open: tap a `button.agent` row in the list. Back: `button[aria-label="Back"]` or the browser back
  gesture. The URL hash (token) stays.
- Header: `.detail-title`, and `.detail-sub.status-<status>` with `<Label> · <kind> · <dir>`.
- History mode (`claude`): `.markdown`, `.code-block` with `button.code-copy`, tool runs
  (`.tool-run`, `.tool-run-dot.running` / `.failed`, tap for `.tool-detail`), diff cards
  (`.diff-card`, `.diff-line.add` / `.del`). With no session file: `p.empty` `Nothing here yet`.
- Terminal mode (other kinds): `pre.msg-terminal`.
- Composer: `textarea[aria-label="Message"]` (placeholder `Message the agent…`, or
  `Queue a message…` while `working`), `button[aria-label="Send"]` (or Cmd/Ctrl+Enter). It is not
  shown while the agent is blocked.
- Pending prompt: `.msg-user.msg-pending` (`Sending…`). If the send fails: `.msg-failed`
  (`Not sent · tap to try again`); a tap sends again.
- Working: `button[aria-label="Stop the agent"]` (sends `esc`) and `.typing` (dots).
- Blocked: `.sheet` with `.sheet-title` (`Needs you`), `pre.sheet-dialog` (the screen text), and
  `.keypad .key` buttons `↑ ↓ Enter Esc 1 2 3` (`Enter` is `.key-primary`).
- Errors: `.toast[role=alert]`. It goes away after 4 s.
- Agent closed: `.gone` (`This agent is not running anymore.`) with `.pill-button` `Back to agents`.

## How to get to it (user POV)

Tap an agent row in the list, or open `/agent/<paneId>` directly.

## Driving it with cdp.ts

Use kind `codex` (or any kind that is not `claude`) for terminal mode:

```sh
S=.claude/skills/verify-herdr-pwa/scripts
P=$($S/agent.sh demo add beta codex idle)
C=$($S/agent.sh demo add alpha claude idle)
$S/cdp.ts demo open "/"
$S/cdp.ts demo click ".agent" "codex"
$S/cdp.ts demo wait ".detail-sub" "Idle · codex"
$S/cdp.ts demo eval "location.pathname"               # "/agent/w2%3Ap1"
$S/cdp.ts demo wait "pre.msg-terminal" "" 8000
$S/cdp.ts demo shot 01-agent-terminal
$S/agent.sh demo set "$P" codex working
$S/cdp.ts demo wait 'button[aria-label="Stop the agent"]'
$S/cdp.ts demo wait ".typing"
$S/agent.sh demo set "$P" codex blocked
$S/cdp.ts demo wait ".sheet-title" "NEEDS YOU"         # CSS upper case, see Gotchas
$S/cdp.ts demo text ".keypad"
$S/cdp.ts demo shot 02-blocked-sheet
$S/agent.sh demo set "$P" codex idle
$S/cdp.ts demo click 'button[aria-label="Back"]'
$S/cdp.ts demo click ".agent-title" "claude"
$S/cdp.ts demo wait "p.empty" "Nothing here yet" 8000  # history mode, no session file
$S/cdp.ts demo click 'textarea[aria-label="Message"]'
$S/cdp.ts demo type "PENDING_MARKER"
$S/cdp.ts demo click 'button[aria-label="Send"]'
$S/cdp.ts demo wait ".msg-failed" "Not sent" 8000     # Herdr refuses fake agents, see Gotchas
$S/herdr.sh demo workspace close w1                    # close the open agent
$S/cdp.ts demo wait ".gone" "not running anymore" 8000
$S/cdp.ts demo click ".gone .pill-button" "Back to agents"
$S/cdp.ts demo wait ".summary"
```

Proof: the screenshots, the `.detail-sub` text, and the sheet keys.

## Gotchas

- **A fake agent cannot get a prompt or keys.** Herdr 0.9.3 accepts `agent.prompt` and
  `agent.send_keys` only for an agent that it detected itself from the real foreground process. For
  a pane that has only `report-agent`, it gives `agent_not_ready` (`is not an active named agent` or
  `is no longer the pane foreground process`). The PWA then shows `.msg-failed`. A Send or a key tap
  from the PWA to a fake agent never reaches the pane. To prove that a prompt reaches Herdr, you
  need a real detected agent (for example a real `codex` or `claude` process) in the isolated
  session. That uses the user's agent account, so ask the user first.
- Do not use a fake `claude` agent to prove a prompt. The pending bubble shows the text at once,
  before Herdr answers, so a `wait` for the text passes without proof.
- The history mode of a real Claude agent (Markdown, tool runs, diff cards) needs a real Claude Code
  process. A fake agent has no session file.
- `cdp.ts text` and `wait` use `innerText`, which gives the CSS text transform. `.sheet-title` is
  upper case on screen, so wait for `NEEDS YOU`.
- `report-agent` sets the status, but typing in the shell does not. The status stays what you set.
- The toast goes away after 4 s. Wait for it at once, or read it with `cdp.ts text ".toast"`.
