#!/usr/bin/env bash
# Runs a herdr CLI command against the isolated session of a run, never the user's session.
# Usage: herdr.sh <run> <herdr args...>   Example: herdr.sh demo agent list
source "$(dirname "$0")/lib.sh"

RUN="$(run_name "${1:-}")"
shift
herdr_run "$RUN" "$@"
