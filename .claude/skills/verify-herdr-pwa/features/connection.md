# Connection pill and Herdr-down banner

The pill in the header (`.pill`) tells the user if the data is live. The banner (`.banner`) tells
the user that the bridge cannot reach Herdr.

## Sub-features

- `.pill.pill-ok` with `Live`: `/ws` is open and Herdr answers.
- `.pill.pill-bad` with `Connecting`, `Offline` (bridge gone; the PWA retries with backoff up to 8
  s), or `Herdr down`.
- `.banner` with `Cannot reach Herdr.` and the error in `code`. The banner replaces the list. The
  bridge polls every 5 s. After a good state, it keeps that state for 3 failed refreshes (1 s apart,
  log line `[bridge] refresh failed (<n>): <error>`) before it reports Herdr down. If Herdr was
  never reached, the first failure shows the banner.
- When the bridge comes back, the PWA connects again by itself.

## How to get to it (user POV)

Always visible in the header. The banner replaces the list when Herdr stops.

## Driving it with cdp.ts

```sh
S=.claude/skills/verify-herdr-pwa/scripts
$S/cdp.ts demo open "/"
$S/cdp.ts demo wait ".pill" "Live"
$S/herdr.sh demo server stop                        # stops ONLY the verify-demo Herdr
$S/cdp.ts demo wait ".banner" "Cannot reach Herdr" 30000
$S/cdp.ts demo wait ".pill" "Herdr down"
$S/cdp.ts demo shot 01-herdr-down
```

Proof: screenshot with the banner and the red pill, and `refresh failed (3)` in
`.verify/demo/logs/bridge.log`. The banner `code` shows `connect ENOENT <socket>`.

## Gotchas

- Do this feature last in a run. It breaks the run.

- After `herdr.sh <run> server stop`, the run is broken: `down.sh` and `up.sh` again.
- To test `Offline`, kill only the bridge PID from `.verify/<run>/state.env`
  (`source .verify/demo/state.env; kill $BRIDGE_PID`). Then `down.sh`.
- Failure detection takes some seconds (retries plus a 5 s request timeout). Use long `wait`
  timeouts.
