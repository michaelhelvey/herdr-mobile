#!/usr/bin/env bash
# Stops the instance of one run: Chrome, the bridge, and the isolated Herdr session. It kills only
# the PIDs that up.sh recorded, never by process name. It keeps logs/ and evidence/.
# Usage: down.sh <run>
source "$(dirname "$0")/lib.sh"

RUN="$(run_name "${1:-}")"
DIR="$(run_dir "$RUN")"
SESSION="$(session_name "$RUN")"

if [[ -f "$DIR/state.env" ]]; then
  load_state "$RUN"
  for pid in "${CHROME_PID:-}" "${BRIDGE_PID:-}"; do
    if pid_alive "$pid"; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do pid_alive "$pid" || break; sleep 0.1; done
      pid_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
    fi
  done
fi

# The session name always starts with "verify-", so this never stops the user's session.
if herdr session list 2>/dev/null | awk '{print $1}' | grep -qx "$SESSION"; then
  herdr session stop "$SESSION" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    herdr session list 2>/dev/null | grep -E "^$SESSION[[:space:]]+running" >/dev/null || break
    sleep 0.25
  done
  herdr session delete "$SESSION" >/dev/null 2>&1 || true
fi

if [[ -f "$DIR/state.env" ]] && pid_alive "${HERDR_PID:-}"; then
  kill "$HERDR_PID" 2>/dev/null || true
fi

rm -rf "$DIR/chrome-profile" "$DIR/state.env"

echo "down: run=$RUN. kept: $DIR/evidence $DIR/logs"
