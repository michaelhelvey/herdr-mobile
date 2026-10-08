# Agent list with live status

The home screen. It shows each Herdr workspace with its agents, and the status of each agent. The
`blocked` status ("Needs you") must be easy to see.

## Sub-features

- Summary line: `<n> agents · <n> workspaces · v<herdr version>` (`.summary`).
- One `section.workspace` for each workspace, sorted by the Herdr workspace number, with the label
  in `h2` (CSS shows it in upper case; `innerText` gives upper case, `textContent` gives the real
  label).
- A workspace without agents shows `No agents` (`.empty`).
- `section.workspace.needs-you` on top, with `h2` `Needs you`: a copy of each blocked agent. A
  blocked agent shows twice (here and in its workspace).
- Each agent row: `button.agent.status-<status>` with `.status-dot` (it pulses for `working` and
  `blocked`), title (`.agent-title`, the terminal title or else the kind), meta (`.agent-meta`:
  `kind · last dir`, `~` for the home dir), label (`.status-label`), and `.row-chevron`. A tap opens
  the agent screen (see `agent-screen.md`).
- Live: status changes, new agents, and closed workspaces show without a reload.

## How to get to it (user POV)

Open the bridge URL on the phone (see `pairing.md`). The list is the first screen (`/`).

## Driving it with cdp.ts

```sh
S=.claude/skills/verify-herdr-pwa/scripts
P1=$($S/agent.sh demo add alpha claude working)
P2=$($S/agent.sh demo add beta codex idle)
$S/cdp.ts demo open "/"
$S/cdp.ts demo wait ".pill" "Live"
$S/cdp.ts demo wait ".summary" "2 agents"
$S/cdp.ts demo agents > .verify/demo/evidence/01-agents.json
$S/cdp.ts demo shot 01-list
$S/agent.sh demo set "$P1" claude blocked           # no reload after this
$S/cdp.ts demo wait ".needs-you .agent.status-blocked" "claude"
$S/cdp.ts demo shot 02-blocked
$S/agent.sh demo close-workspace w2
$S/cdp.ts demo gone ".agent" "codex"
$S/cdp.ts demo shot 03-closed
```

Proof: `agents` JSON has a `needsYou: true` section with the alpha agent, and the alpha agent has
`statusClass: "status-blocked"` and `label: "Needs you"`, the screenshots show the amber row, and
`$S/herdr.sh demo agent list` agrees.

## Gotchas

- New workspaces start in the repo dir, so meta shows the name of the repo directory.
- The bridge also polls every 5 s, so a missed event still shows within about 5 s. Use a `wait`
  timeout of at least 6000 ms when you test a lost-event path.
- You cannot report `done`. To see the `Done` label you need a real agent that ends a turn unseen.
- A fake agent has no terminal title, so the title is the kind.
- When Herdr is down, `.banner` replaces the summary and all sections (see `connection.md`).
- `.empty` is also the `Connecting…` text before the first state. Give `wait ".empty"` a text.
