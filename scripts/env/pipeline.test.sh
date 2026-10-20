#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2329,SC2034 # Fixture overrides are invoked by sourced commands.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
. "$HERE/omk.sh"
mkdir -p "$OMK_ROOT/staging/llm"
git -C "$OMK_ROOT/staging/llm" init -q
git -C "$OMK_ROOT/staging/llm" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m fixture
sha="$(git -C "$OMK_ROOT/staging/llm" rev-parse HEAD)"
cmd_env_hold staging
[[ "$(cat "$OMK_ROOT/staging/.pipeline/hold")" == "$sha" ]]
if ( pipeline_update_allowed staging ); then echo 'FAIL: held update allowed'; exit 1; fi
cmd_env_hold staging --release
pipeline_update_allowed staging
mkdir -p "$OMK_ROOT/staging/.pipeline/lock"
if ( pipeline_locked staging true ); then echo 'FAIL: concurrent lock allowed'; exit 1; fi
rmdir "$OMK_ROOT/staging/.pipeline/lock"
if ( pipeline_verify_proof staging "$sha" ); then echo 'FAIL: missing proof allowed'; exit 1; fi
echo 'pipeline shell checks passed'
# A real fixture checks proof against source, validation, disk and running build IDs.
ldir="$OMK_ROOT/staging/llm"
mkdir -p "$ldir/apps/api/dist"
printf '{"gitHash":"%s"}\n' "$sha" > "$ldir/apps/api/dist/build-info.json"
curl() { printf '{"success":true,"data":{"build":{"gitHash":"%s"}}}\n' "${RUNNING_SHA:-$sha}"; }
cmd_env_hold staging
printf '{"schemaVersion":1,"stage":"staging-validation","sha":"%s","status":"passed","checks":[{"status":"passed"}],"startedAt":"2026-10-20T00:00:00Z","finishedAt":"2026-10-20T00:01:00Z"}\n' "$sha" > "$OMK_ROOT/staging/.pipeline/validation.json"
pipeline_verify_proof staging "$sha"
if ( RUNNING_SHA=abcdef0; pipeline_verify_proof staging "$sha" ) >/dev/null 2>&1; then echo 'FAIL: wrong running SHA allowed'; exit 1; fi
if ( pipeline_verify_proof staging aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ) >/dev/null 2>&1; then echo 'FAIL: stale SHA allowed'; exit 1; fi
printf '{"gitHash":"abcdef0"}' > "$ldir/apps/api/dist/build-info.json"
if ( pipeline_verify_proof staging "$sha" ) >/dev/null 2>&1; then echo 'FAIL: wrong installed build allowed'; exit 1; fi
printf '{"gitHash":"%s"}\n' "$sha" > "$ldir/apps/api/dist/build-info.json"
printf '{"schemaVersion":1,"stage":"staging-validation","sha":"%s","status":"passed","checks":[]}\n' "$sha" > "$OMK_ROOT/staging/.pipeline/validation.json"
if ( pipeline_verify_proof staging "$sha" ) >/dev/null 2>&1; then echo 'FAIL: empty validation allowed'; exit 1; fi
# Pipeline always smokes without a status token and holds the checked SHA.
cmd_env_hold staging --release
git -C "$ldir" branch -M main
printf 'OMK_TRACK=main\n' > "$ldir/.env"
pipeline_update_step() { printf 'update\n' >> "$TMP/order"; }
cmd_env_smoke() { printf 'smoke\n' >> "$TMP/order"; }
pipeline_validate() { printf 'validate\n' >> "$TMP/order"; }
pipeline_run staging
[[ "$(cat "$TMP/order")" == $'update\nsmoke\nvalidate' ]]
[[ "$(cat "$OMK_ROOT/staging/.pipeline/hold")" == "$sha" ]]
# Online chooses once; even if latest changes during update it uses captured commit.
mkdir -p "$OMK_ROOT/online/llm"
git -C "$OMK_ROOT/online/llm" init -q
online="$OMK_ROOT/online/llm"
git -C "$online" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m old
old="$(git -C "$online" rev-parse HEAD)"
git -C "$online" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m release
captured_test="$(git -C "$online" rev-parse HEAD)"
git -C "$online" tag v1.0.0
git -C "$online" reset -q --hard "$old"
printf 'OMK_TRACK=release\n' > "$online/.env"
git() { if [[ "${3:-}" == fetch ]]; then return 0; fi; command git "$@"; }
release_gate_fetch() { return 0; }
release_gate_check() { [[ "$2" == "$captured_test" ]]; }
pipeline_update_step() { command git -C "$online" tag -f v1.0.0 "$old" >/dev/null; OMK_PIPELINE_RELEASE_SHA="$2" release_behind "$online"; [[ "$RELEASE_TAG" == "$captured_test" ]]; command git -C "$online" reset -q --hard "$RELEASE_TAG"; }
pipeline_identity() { [[ "$2" == "$captured_test" ]]; }
pipeline_run online
release_gate_check() { GATE_REASON=unverified; return 1; }
if ( pipeline_run online ) >/dev/null 2>&1; then echo 'FAIL: unverified release allowed'; exit 1; fi
echo 'pipeline identity, staging and captured release checks passed'
# Release gate rejects functional changes even when a later commit reverts them.
unset -f git
fixture="$TMP/release-gate"; git init -q "$fixture"
printf '{"version":"1.0.0","dependencies":{"x":"1"}}\n' > "$fixture/package.json"
git -C "$fixture" add .; git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm base
base="$(git -C "$fixture" rev-parse HEAD)"
printf '{"version":"1.0.0","dependencies":{"x":"2"}}\n' > "$fixture/package.json"
git -C "$fixture" add .; git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm unsafe
printf '{"version":"1.0.0","dependencies":{"x":"1"}}\n' > "$fixture/package.json"
git -C "$fixture" add .; git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm revert
[[ -n "$(release_gate_offending "$fixture" "$base" HEAD)" ]] || { echo 'FAIL: reverted dependency change accepted'; exit 1; }
[[ "$(pm2_names staging)" == *'omk-pipeline-staging'* ]] || { echo 'FAIL: reset/status do not manage pipeline schedule'; exit 1; }
# Update failures cannot fall through to smoke/success, even in conditional callers.
git() { if [[ "${3:-}" == fetch ]]; then return 0; fi; command git "$@"; }
release_gate_check() { return 0; }
pipeline_update_step() { return 2; }
cmd_env_smoke() { touch "$TMP/should-not-smoke"; }
if ( pipeline_run online ); then echo 'FAIL: failed update marked successful'; exit 1; fi
[[ ! -f "$TMP/should-not-smoke" ]] || { echo 'FAIL: smoke ran after failed update'; exit 1; }
pm2() { [[ "$1" != describe ]] || return 1; printf '%s\n' "$@" > "$TMP/pm2-arguments"; }
pipeline_run staging --schedule '0 * * * *'
[[ "$(tail -3 "$TMP/pm2-arguments")" == $'env\npipeline\nstaging' ]]
if rg -q -- '--report|env update' "$TMP/pm2-arguments"; then echo 'FAIL: schedule invokes partial flow'; exit 1; fi
echo 'pipeline schedules invoke the full flow without requiring status credentials'
