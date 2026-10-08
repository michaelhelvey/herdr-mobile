#!/usr/bin/env bash
# Read-only health check of one run. Exit code 0 means the instance is worth driving.
# Usage: doctor.sh <run>
source "$(dirname "$0")/lib.sh"

RUN="$(run_name "${1:-}")"
load_state "$RUN"
FAIL=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok   $label"
  else
    echo "FAIL $label"
    FAIL=1
  fi
}

port_owner_is_bridge() {
  [[ "$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)" == "$BRIDGE_PID" ]]
}

session_running() {
  herdr session list 2>/dev/null | grep -E "^$SESSION[[:space:]]+running" >/dev/null
}

page_served() {
  curl -sf "$URL" | grep -q "<title>herdr</title>"
}

bridge_sees_herdr() {
  bun "$SCRIPTS/cdp.ts" "$RUN" ws | grep -q '"herdr":{"ok":true'
}

check "herdr session $SESSION is running (socket $SOCKET)" session_running
check "bridge pid $BRIDGE_PID is alive" pid_alive "$BRIDGE_PID"
check "port $PORT belongs to the bridge pid" port_owner_is_bridge
check "GET $URL serves the PWA" page_served
check "bridge /ws sends a state with herdr.ok=true" bridge_sees_herdr
check "chrome pid $CHROME_PID is alive" pid_alive "$CHROME_PID"
check "chrome devtools answers on port $CDP_PORT" curl -sf "http://127.0.0.1:$CDP_PORT/json/version"

if [[ "$FAIL" -ne 0 ]]; then
  echo "doctor: run '$RUN' is NOT healthy. Read $(run_dir "$RUN")/logs/, then down.sh $RUN and up.sh $RUN."
  exit 1
fi

echo "doctor: run '$RUN' is healthy. url=$URL"
