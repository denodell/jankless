#!/usr/bin/env bash
set -uo pipefail
dir="${JANKLESS_BASELINE_DIR:-}"
if [ -n "$dir" ] && [ -n "$(find "$dir" -type f 2> /dev/null | head -1)" ]; then
  echo "Publishing $(find "$dir" -type f | wc -l | tr -d ' ') baseline file(s) as '${JANKLESS_ACTION_ARTIFACT:-jankless-baselines}'."
  echo "collected=true" >> "$GITHUB_OUTPUT"
else
  echo "::warning::No baselines were recorded, so none were published. Recording needs tests that call toBeSmooth() or use withJankless(), and the setup step before them."
  echo "collected=false" >> "$GITHUB_OUTPUT"
fi
