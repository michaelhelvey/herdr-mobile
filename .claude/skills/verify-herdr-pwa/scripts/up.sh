#!/usr/bin/env bash
# Starts an isolated verification instance:
#   1. a headless Herdr server in its own named session (verify-<run>),
#   2. the bridge from this checkout on a free port, connected to that session only,
#   3. a headless Chrome with an iPhone-size window and a free DevTools port.
# Usage: up.sh <run>
#   TRUST_LAN=0 up.sh <run>   the bridge asks for the token also from 127.0.0.1 (to test pairing).
#   The default (TRUST_LAN=1) trusts 127.0.0.1 like a phone on the home network: no token needed.
source "$(dirname "$0")/lib.sh"

RUN="$(run_name "${1:-}")"
TRUST_LAN="${TRUST_LAN:-1}"
[[ "$TRUST_LAN" == 0 || "$TRUST_LAN" == 1 ]] || { echo "error: TRUST_LAN must be 0 or 1" >&2; exit 2; }
DIR="$(run_dir "$RUN")"
SESSION="$(session_name "$RUN")"
SOCKET="$(session_socket "$RUN")"

if [[ -f "$DIR/state.env" ]]; then
  echo "error: run '$RUN' exists. Use doctor.sh $RUN, or down.sh $RUN first." >&2
  exit 1
fi

mkdir -p "$DIR/logs" "$DIR/evidence"

if herdr session list 2>/dev/null | awk '{print $1}' | grep -qx "$SESSION"; then
  echo "error: herdr session $SESSION exists already. Run down.sh $RUN." >&2
  exit 1
fi

# The env -u removes the variables of the parent Herdr pane, so that Herdr does not refuse a
# nested start and does not use the user's socket.
env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_SOCKET_PATH -u HERDR_CLIENT_SOCKET_PATH \
  nohup herdr --session "$SESSION" server >"$DIR/logs/herdr.log" 2>&1 &
HERDR_PID=$!

for _ in $(seq 1 40); do
  [[ -S "$SOCKET" ]] && herdr_run "$RUN" workspace list >/dev/null 2>&1 && break
  sleep 0.25
done
herdr_run "$RUN" workspace list >/dev/null || { echo "error: herdr did not start, see $DIR/logs/herdr.log" >&2; exit 1; }

PORT="$(free_port)"
TOKEN="verify-$RUN-token"

# The exec chain keeps one PID, so that $! is the PID of bun and down.sh can kill exactly it.
# The env -u removes the user's tunnel URL, so that the log of a run does not show it.
# NODE_ENV=production stops hot reload. Other agents can change src/ during a run, and a reload
# in the middle of a drive breaks the drive. The run serves the code as it was at up.sh time.
(cd "$REPO" && exec env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_BRIDGE_PUBLIC_URL \
  HERDR_SOCKET_PATH="$SOCKET" HERDR_BRIDGE_TOKEN="$TOKEN" HERDR_BRIDGE_TRUST_LAN="$TRUST_LAN" \
  PORT="$PORT" HOST=127.0.0.1 NODE_ENV=production \
  nohup bun ./src/server/main.ts >"$DIR/logs/bridge.log" 2>&1) &
BRIDGE_PID=$!

# Ready means: the bridge serves the PWA. The log text changes often, so do not wait for it.
for _ in $(seq 1 80); do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break
  pid_alive "$BRIDGE_PID" || break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$PORT/" >/dev/null || { echo "error: bridge did not start, see $DIR/logs/bridge.log" >&2; exit 1; }

CDP_PORT="$(free_port)"

nohup "$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$DIR/chrome-profile" --no-first-run --no-default-browser-check \
  --window-size=390,844 --force-device-scale-factor=3 --hide-scrollbars \
  --user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" \
  about:blank >"$DIR/logs/chrome.log" 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null || { echo "error: chrome did not start, see $DIR/logs/chrome.log" >&2; exit 1; }

cat >"$DIR/state.env" <<EOF
RUN=$RUN
SESSION=$SESSION
SOCKET=$SOCKET
HERDR_PID=$HERDR_PID
BRIDGE_PID=$BRIDGE_PID
PORT=$PORT
URL=http://127.0.0.1:$PORT/
TOKEN=$TOKEN
TRUST_LAN=$TRUST_LAN
CHROME_PID=$CHROME_PID
CDP_PORT=$CDP_PORT
EOF

echo "ready: run=$RUN url=http://127.0.0.1:$PORT/ pair-url=http://127.0.0.1:$PORT/#token=$TOKEN trust-lan=$TRUST_LAN cdp=$CDP_PORT herdr-session=$SESSION"
echo "evidence: $DIR/evidence"
