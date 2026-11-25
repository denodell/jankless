#!/usr/bin/env bash
set -euo pipefail

event="${GITHUB_EVENT_NAME:-}"
on_default=false
[ -n "${DEFAULT_BRANCH:-}" ] && [ "${GITHUB_REF:-}" = "refs/heads/$DEFAULT_BRANCH" ] && on_default=true

record=false
if [ "$on_default" = true ]; then
  case "$event" in
    push | schedule | workflow_dispatch) record=true ;;
  esac
fi

temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
baselines="$temp/jankless-baselines"
mkdir -p "$baselines"
started="$temp/jankless-started"
touch "$started"

results_artifact="${RESULTS_ARTIFACT:-}"
[ -n "$results_artifact" ] || results_artifact="jankless-results-${GITHUB_JOB:-job}-${GITHUB_RUN_ATTEMPT:-1}-$RANDOM$RANDOM"

{
  echo "record=$record"
  echo "baselines=$baselines"
  echo "started=$started"
  echo "results-artifact=$results_artifact"
} >> "$GITHUB_OUTPUT"

{
  echo "JANKLESS_BASELINE_DIR=$baselines"
  echo "JANKLESS_ACTION_STARTED=$started"
  echo "JANKLESS_ACTION_ARTIFACT=${ARTIFACT_NAME:-jankless-baselines}"
  if [ "$record" = true ]; then echo "JANKLESS_RECORD_BASELINES=1"; fi
} >> "$GITHUB_ENV"

if [ "$record" = true ]; then
  echo "Event: $event on ${GITHUB_REF:-?}. Checks compare with main's baselines, then record this run's as the new ones."
else
  echo "Event: $event on ${GITHUB_REF:-?}. Checks compare with main's baselines."
fi
