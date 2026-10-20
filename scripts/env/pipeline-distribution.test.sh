#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2034
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
cp "$HERE/omk.sh" "$TMP/omk.sh"
. "$TMP/omk.sh"
if ( pipeline_helpers_require staging ) > "$TMP/missing.log" 2>&1; then echo 'FAIL missing helpers accepted'; exit 1; fi
if rg -q 'command not found' "$TMP/missing.log"; then echo 'FAIL missing helpers lack actionable error'; exit 1; fi
installed="$OMK_ROOT/staging/llm/scripts/env"; mkdir -p "$installed"
cp "$HERE/pipeline.sh" "$installed/pipeline.sh"; cp "$HERE/omk.sh" "$installed/omk.sh"
pipeline_helpers_require staging
declare -F pipeline_locked >/dev/null
[[ "$SCRIPT_DIR" == "$installed" && "$SCRIPT_PATH" == "$installed/omk.sh" ]]
echo 'standalone omk resolves helpers from installed source and fails clearly if absent'
