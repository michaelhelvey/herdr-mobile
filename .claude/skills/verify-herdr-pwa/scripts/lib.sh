# Shared helpers for the verify-herdr-pwa scripts. Source this file. Do not run it.
# Each run has a name. All state of a run is in $REPO/.verify/<run>/.

set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPTS/../../../.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

run_name() {
  local name="${1:-}"
  if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]]; then
    echo "error: give a run name that matches [a-z0-9][a-z0-9-]{0,30}" >&2
    exit 2
  fi
  echo "$name"
}

run_dir() { echo "$REPO/.verify/$1"; }

session_name() { echo "verify-$1"; }

session_socket() { echo "$HOME/.config/herdr/sessions/$(session_name "$1")/herdr.sock"; }

# Prints a free TCP port on 127.0.0.1.
free_port() {
  bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop(true);'
}

# Runs herdr against the isolated session of the run, never the user's session.
herdr_run() {
  local run="$1"
  shift
  env -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_CLIENT_SOCKET_PATH \
    HERDR_SOCKET_PATH="$(session_socket "$run")" herdr "$@"
}

load_state() {
  local file
  file="$(run_dir "$1")/state.env"
  if [[ ! -f "$file" ]]; then
    echo "error: no run '$1' (missing $file). Start it with up.sh." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$file"
}

pid_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }
