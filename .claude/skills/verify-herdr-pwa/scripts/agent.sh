#!/usr/bin/env bash
# Makes fake agents in the isolated Herdr session of a run. A fake agent is a plain shell pane
# with a reported agent kind and status (`herdr pane report-agent`). No real agent runs.
#
# Usage:
#   agent.sh <run> add <workspace-label> <kind> <status>   prints the new pane ID
#   agent.sh <run> set <pane-id> <kind> <status>           changes the status of an agent
#   agent.sh <run> close-workspace <workspace-id>
# <status> is one of: idle, working, blocked, unknown. (`done` comes only from Herdr itself.)
source "$(dirname "$0")/lib.sh"

RUN="$(run_name "${1:-}")"
CMD="${2:-}"

json_field() { bun -e "const j = JSON.parse(await Bun.stdin.text()); console.log($1)"; }

case "$CMD" in
  add)
    LABEL="$3" KIND="$4" STATUS="$5"
    PANE="$(herdr_run "$RUN" workspace create --label "$LABEL" --cwd "$REPO" --no-focus |
      json_field 'j.result.root_pane.pane_id')"
    herdr_run "$RUN" pane report-agent --source verify --agent "$KIND" --state "$STATUS" "$PANE" >/dev/null
    echo "$PANE"
    ;;
  set)
    herdr_run "$RUN" pane report-agent --source verify --agent "$4" --state "$5" "$3" >/dev/null
    echo "ok"
    ;;
  close-workspace)
    herdr_run "$RUN" workspace close "$3" >/dev/null
    echo "ok"
    ;;
  *)
    sed -n '2,10p' "$0" >&2
    exit 2
    ;;
esac
