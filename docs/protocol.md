# Herdr wire protocol

This document describes the Herdr socket API that the PWA uses. It covers only the methods that
control agents. The PWA is not a general terminal client.

The data in this document comes from Herdr 0.9.3, protocol 22. Do a check of the version before you
use new features (see [Versions](#versions)).

## Transport

- Herdr listens on a Unix domain socket only. The default path is `~/.config/herdr/herdr.sock`.
  Panes that Herdr manages get the path in `$HERDR_SOCKET_PATH`.
- Herdr does not have a TCP, HTTP, or WebSocket listener. A browser cannot connect to the socket.
  Thus, the PWA needs a bridge server on the same machine as Herdr. The bridge connects to the
  socket and gives an HTTP and WebSocket API to the PWA. The network tunnel goes to the bridge.

```
phone (PWA) ──https/wss──▶ tunnel ──▶ bridge (bun) ──unix socket──▶ herdr server
```

## Framing

Each message is one JSON object on one line, followed by `\n`.

Request:

```json
{ "id": "1", "method": "agent.list", "params": {} }
```

Success response:

```json
{"id":"1","result":{"type":"agent_list","agents":[...]}}
```

Error response:

```json
{ "id": "1", "error": { "code": "invalid_request", "message": "invalid request: ..." } }
```

- `params` is always necessary. Use `{}` when a method has no parameters.
- `result.type` tells the response type (for example `agent_list`, `agent_info`, `pane_read`).

### Connections

**Use one connection for each request.** The server closes the connection after it sends the
response. If you write a second request on the same connection, the write fails with `EPIPE`.

The one exception is `events.subscribe`. The connection stays open after the response, and the
server sends events on it (see [Live updates](#live-updates)).

## Schema

The server binary contains a full JSON Schema (draft 2020-12) for all requests, responses, and
events:

```sh
herdr api schema --json > herdr-schema.json
```

The schema has these top-level entries in `.schemas`: `request`, `success_response`,
`error_response`, `event`, `subscription_event`. Use the schema to generate TypeScript types. Do not
write the types by hand.

## Identifiers

- Workspace: `w1`. Tab: `w1:t1`. Pane: `w1:p1`.
- IDs are opaque. Do not parse them and do not make them from other data.
- Herdr does not use a closed pane ID again.
- When a pane moves to a different workspace, it gets a new pane ID.
- The agent methods accept a `target`. The target is a pane ID or a unique live agent name. Names
  match `[a-z][a-z0-9_-]{0,31}`. Most agents do not have a name, so use the pane ID.

## Agent status

`agent_status` has one of these values:

| Value     | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `idle`    | The agent is ready for input.                                           |
| `done`    | The agent is ready for input. It completed a turn that nobody saw.      |
| `working` | The agent is busy with a turn.                                          |
| `blocked` | The agent shows an approval or question UI. It needs the user.          |
| `unknown` | Herdr found an agent but cannot identify its state. This is not "done". |

The PWA must make `blocked` very easy to see. This is the state that needs action from the user.

## Methods

### `agent.list`

Params: `{}`

Gives all live agents. Use this for the home screen.

```json
{
  "type": "agent_list",
  "agents": [
    {
      "terminal_id": "term_65d55a8d0526b2",
      "agent": "claude",
      "terminal_title": "✳ Rego static data dependency analysis for Topaz",
      "terminal_title_stripped": "Rego static data dependency analysis for Topaz",
      "agent_status": "idle",
      "workspace_id": "w2",
      "tab_id": "w2:t1",
      "pane_id": "w2:p2",
      "focused": false,
      "state_change_seq": 6,
      "cwd": "/Users/michaelhelvey/dev/thirdparty/topaz",
      "foreground_cwd": "/Users/michaelhelvey/dev/thirdparty/topaz",
      "revision": 1
    }
  ]
}
```

- `agent` is the agent kind (for example `claude`, `codex`).
- `terminal_title_stripped` is the title that the agent sets. Claude Code puts a summary of the
  conversation there. Use it as the title of the list row.
- `state_change_seq` increases when the status changes.

### `agent.get`

Params: `{"target": string}`

Gives one agent, in the same shape as one item of `agent.list`. The response type is `agent_info`,
and the agent is in `result.agent`.

### `session.snapshot`

Params: `{}`

Gives all workspaces, tabs, panes, and agents in one response (`result.snapshot`). Use it for the
first load of the app.

### `agent.read`

Params:

| Name         | Type    | Necessary | Notes                                                    |
| ------------ | ------- | --------- | -------------------------------------------------------- |
| `target`     | string  | yes       |                                                          |
| `source`     | string  | yes       | `visible`, `recent`, `recent_unwrapped`, or `detection`. |
| `lines`      | integer | no        | Number of rows to get.                                   |
| `format`     | string  | no        | `text` (default) or `ansi`.                              |
| `strip_ansi` | boolean | no        | Default `true`.                                          |

Use `source: "recent_unwrapped"`. It joins soft-wrapped lines.

**Warning: do not send `lines`.** Claude Code and OpenCode draw on the alternate screen, and they
keep their history in the application, not in the terminal. Herdr keeps only about 80 rows. If
`lines` asks for more, Herdr scrolls the TUI of the agent to collect the history, and then scrolls
it back. The user sees the terminal on the Mac move up and down. It is also slow:

| `lines` | Time    |
| ------- | ------- |
| none    | 107 ms  |
| 60      | 106 ms  |
| 150     | 616 ms  |
| 400     | 3070 ms |

The PWA reads without `lines` and joins each new screen to the text that it has (`mergeScreen` in
`src/client/merge.ts`). For a full history, read the session files of the agent instead.

```json
{
  "type": "pane_read",
  "read": {
    "pane_id": "w3:p1",
    "workspace_id": "w3",
    "tab_id": "w3:t1",
    "source": "recent_unwrapped",
    "format": "text",
    "text": "...",
    "revision": 0,
    "truncated": true
  }
}
```

**Caution:** `text` is the text of the terminal screen. It contains the agent's TUI: box-drawing
characters, the input box, mode lines, and other parts of the UI. It is not a list of chat messages.
See [Transcripts](#transcripts).

### `agent.prompt`

Params:

| Name     | Type   | Necessary | Notes                                                |
| -------- | ------ | --------- | ---------------------------------------------------- |
| `target` | string | yes       |                                                      |
| `text`   | string | yes       | The message to send.                                 |
| `wait`   | object | no        | `{"until"?: AgentStatus[], "timeout_ms"?: integer}`. |

Herdr sends the text and then Enter. It uses bracketed paste if the pane has it on.

- If the agent is `blocked`, Herdr sends nothing and gives the error `agent_blocked`.
- With `wait`, Herdr waits until the agent goes to `idle`, `done`, or `blocked`. If Herdr does not
  see activity in 5 seconds, it gives `agent_prompt_stalled`.
- A timeout does not prove that the agent did not get the prompt. Do not send the prompt again
  automatically.

For the PWA, do not use `wait`. Send the prompt, return immediately, and get the status from
[live updates](#live-updates).

### `agent.send_keys`

Params: `{"target": string, "keys": string[]}`

Sends logical keys, for example `esc`, `ctrl+c`, `enter`, `up`, `down`. Herdr validates all keys
before it writes bytes.

Use it to:

- Stop a turn (`esc` for Claude Code).
- Answer approval and question dialogs when the agent is `blocked`.

### `agent.wait`

Params: `{"target": string, "until"?: AgentStatus[], "timeout_ms"?: integer}`

Blocks until the agent has one of the statuses. The PWA does not need this method if it uses
subscriptions.

### `agent.start`

Params:

| Name         | Type     | Necessary | Notes                                    |
| ------------ | -------- | --------- | ---------------------------------------- |
| `name`       | string   | yes       | Unique agent name.                       |
| `kind`       | string   | yes       | Agent kind, for example `claude`.        |
| `pane_id`    | string   | yes       | A pane with an idle shell prompt.        |
| `args`       | string[] | no        | Arguments for the agent command.         |
| `timeout_ms` | integer  | no        | More than 3000 and not more than 300000. |

`agent.start` does not make a pane. To start a new agent, first make a pane with `tab.create` or
`pane.split`. Then use the pane ID from that response. `agent.start` returns when the agent is ready
for input. If the agent is blocked during startup, it gives the error `agent_not_ready`.

### Other agent methods

- `agent.rename`: change the agent name.
- `agent.focus`: focus the agent in the Herdr TUI. This also marks `done` as seen.
- `agent.explain`: gives the detection rules and why Herdr selected the current status. Use it for
  debugging only.

## Live updates

`events.subscribe` keeps the connection open and sends events.

Request:

```json
{
  "id": "sub",
  "method": "events.subscribe",
  "params": {
    "subscriptions": [
      { "type": "pane.agent_detected" },
      { "type": "pane.created" },
      { "type": "pane.closed" },
      { "type": "pane.exited" },
      { "type": "pane.agent_status_changed", "pane_id": "w2:p2" }
    ]
  }
}
```

First response:

```json
{ "id": "sub", "result": { "type": "subscription_started" } }
```

After that, each line is one event:

```json
{
  "event": "pane.agent_status_changed",
  "data": {
    "pane_id": "w2:p2",
    "workspace_id": "w2",
    "agent": "claude",
    "display_agent": "Claude",
    "agent_status": "working",
    "title": "...",
    "state_labels": {}
  }
}
```

Important rules:

- `pane.agent_status_changed` needs a `pane_id`. You must subscribe for each pane. When
  `pane.agent_detected` or `pane.created` comes, open a new subscription that includes the new pane.
- You cannot change a subscription after it starts. To change the list, open a new connection and
  close the old one. Get `agent.list` again after you reconnect, because you can lose events in the
  gap.
- There is no event for "pane output changed". To update the transcript, read again when the status
  changes. While an agent is `working`, read again at an interval (for example 1 to 2 seconds). Do
  not send a new read to the PWA if `revision` did not change.
- `pane.output_matched` sends an event when output matches a regex. It is not useful for a chat
  view.

## Transcripts

`agent.read` gives terminal text. For a chat UI with message bubbles, there are two options.

### Option 1: Parse the terminal text

Remove the TUI parts from `agent.read` text for each agent kind. This works for all agent kinds. It
is fragile, because it breaks when an agent changes its TUI.

### Option 2: Read the Claude Code session file

Claude Code writes each session to a JSONL file:

```
~/.claude/projects/<cwd-slug>/<session-id>.jsonl
```

`<cwd-slug>` is the `cwd` of the agent with `/` and `.` changed to `-`. For example,
`/Users/michaelhelvey/dev/helvetici/herdr-mobile` becomes
`-Users-michaelhelvey-dev-helvetici-herdr-mobile`.

Herdr knows the session path (`pane.report_agent_session` has `agent_session_path`), but **the API
does not give this value back**. It is not in `agent.list`, `agent.get`, or `session.snapshot`. Thus
the bridge must find the file itself.

Problem: one directory can have many session files, and two agents can have the same `cwd`. The file
with the newest modification time is not always the correct file. Possible fixes:

- Compare the `terminal_title_stripped` of the agent with the summary in each session file.
- Compare the most recent text from `agent.read` with the last messages in each file.
- Ask Herdr to add `agent_session_path` to the `agent.get` response.

### What the bridge does now

The bridge reads the session files of the harness (`src/server/history/`). For Claude Code, it finds
the file without a guess:

1. `pane.process_info` gives the PIDs of the foreground processes in the pane.
2. Claude Code writes `~/.claude/sessions/<pid>.json`. It contains `sessionId` and `cwd`.
3. The session is `~/.claude/projects/<cwd slug>/<sessionId>.jsonl`. The slug is the `cwd` with each
   character that is not a letter or a digit changed to `-`.

A new session has no file until the first message. The JSONL has user messages as exact strings,
messages sent while the agent works (`attachment.type: "queued_command"`), assistant Markdown, and
tool calls. The tool result of Edit and Write has `toolUseResult.structuredPatch`, which gives diff
hunks with line numbers.

### Recommendation

Use the Herdr API to control agents and to get status: list, prompt, keys, and the event stream. To
show a Claude Code agent, read its JSONL file. For other agent kinds, show the `agent.read` text in
a terminal-style view.

## Versions

Send `ping` when the bridge starts:

```json
{ "id": "1", "method": "ping", "params": {} }
```

```json
{
  "id": "1",
  "result": {
    "type": "pong",
    "version": "0.9.3",
    "protocol": 22,
    "capabilities": { "health_check": true, "...": true }
  }
}
```

If `protocol` is not the value that the bridge expects, show a warning in the PWA. The CLI command
`herdr status` shows the same data.

## Error codes

These codes are related to agents:

| Code                   | Cause                                                   |
| ---------------------- | ------------------------------------------------------- |
| `invalid_request`      | The method or the params are not correct.               |
| `agent_blocked`        | `agent.prompt` was sent to a `blocked` agent.           |
| `agent_prompt_stalled` | `agent.prompt` with `wait` did not see activity in 5 s. |
| `agent_not_ready`      | `agent.start` found the agent blocked during startup.   |
| `timeout`              | A wait did not complete before `timeout_ms`.            |

The full list is in the schema under `error_response`.

## Security

The socket gives full control of all terminals, not only agents. The bridge must:

- Expose only the methods in this document.
- Require authentication, also on the local network.
- Never forward a method name or params directly from the PWA to the socket.
