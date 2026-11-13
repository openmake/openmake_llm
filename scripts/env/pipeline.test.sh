#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2329,SC2034,SC2016 # Fixture overrides are invoked by sourced commands; probe scripts expand later.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
. "$HERE/omk.sh"
git() { if [[ "${3:-}" == fetch ]]; then return 0; fi; command git "$@"; }
mkdir -p "$OMK_ROOT/staging/llm"
command git -C "$OMK_ROOT/staging/llm" init -q
command git -C "$OMK_ROOT/staging/llm" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m fixture
sha="$(command git -C "$OMK_ROOT/staging/llm" rev-parse HEAD)"
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
# 갱신 단계가 실패하면 기억하고, 다음 주기는 HEAD 가 같아도 --redeploy 로 다시 배포한다(성공하면 지운다).
printf 'printf "%%s|%%s\\n" "$*" "${OMK_PIPELINE_RELEASE_SHA:-}" >> "$UPDATE_LOG"; exit "${UPDATE_RC:-0}"\n' > "$TMP/update-probe.sh"
mkdir -p "$OMK_ROOT/online"
(
    SCRIPT_PATH="$TMP/update-probe.sh"; export UPDATE_LOG="$TMP/update-log"
    for e in staging:'' online:"$sha"; do
        env="${e%%:*}" rel="${e#*:}"; : > "$UPDATE_LOG"
        if ( export UPDATE_RC=2; pipeline_update_step "$env" "$rel" ); then echo "FAIL: $env failed update passed"; exit 1; fi
        [[ -f "$(update_failed_marker "$env")" ]] || { echo "FAIL: $env update failure not remembered"; exit 1; }
        pipeline_update_step "$env" "$rel"
        [[ ! -f "$(update_failed_marker "$env")" ]] || { echo "FAIL: $env success kept failure marker"; exit 1; }
        pipeline_update_step "$env" "$rel"
        [[ "$(cat "$UPDATE_LOG")" == "env update $env --yes|$rel"$'\n'"env update $env --yes --redeploy|$rel"$'\n'"env update $env --yes|$rel" ]] || { echo "FAIL: $env retry arguments: $(cat "$UPDATE_LOG")"; exit 1; }
    done
)
echo 'pipeline update failures redeploy on the next run'
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
# 앱 게시 단계(실제 함수): .env 에 OMK_DESKTOP_PUBLISH=1 이 없으면 node 를 부르지 않고 0,
# 켜면 고정된 인자 모양으로 desktop-publish.mjs 를 부르고 그 종료 코드를 그대로 돌려준다.
(
    desk="$OMK_ROOT/desk/llm"; mkdir -p "$desk"
    command git -C "$desk" init -q
    command git -C "$desk" remote add origin https://example.com/acme/app.git
    node() { printf '%s\n' "$*" >> "$TMP/node-calls"; return "${NODE_RC:-0}"; }
    for content in '' 'OMK_DESKTOP_PUBLISH=0\n' 'OMK_DESKTOP_PUBLISH=yes\n'; do
        printf "$content" > "$desk/.env"
        pipeline_desktop_publish desk "$sha"
        [[ ! -e "$TMP/node-calls" ]] || { echo "FAIL: desktop publish ran while off ($content)"; exit 1; }
    done
    out="--output $OMK_ROOT/desk/.pipeline/desktop-publish.json"
    printf 'OMK_DESKTOP_PUBLISH=1\n' > "$desk/.env"
    pipeline_desktop_publish desk "$sha"
    [[ "$(cat "$TMP/node-calls")" == "$SCRIPT_DIR/../pipeline/desktop-publish.mjs publish --cwd $desk --sha $sha --dir $desk/data/desktop-updates --repo acme/app $out" ]] || { echo "FAIL: desktop publish arguments: $(cat "$TMP/node-calls")"; exit 1; }
    rm -f "$TMP/node-calls"
    printf 'OMK_DESKTOP_PUBLISH=1\nDESKTOP_UPDATE_DIR=/srv/desktop-updates\n' > "$desk/.env"
    rc=0; NODE_RC=75 pipeline_desktop_publish desk "$sha" || rc=$?
    [[ "$rc" == 75 ]] || { echo "FAIL: desktop publish exit code $rc"; exit 1; }
    [[ "$(cat "$TMP/node-calls")" == "$SCRIPT_DIR/../pipeline/desktop-publish.mjs publish --cwd $desk --sha $sha --dir /srv/desktop-updates --repo acme/app $out" ]] || { echo "FAIL: desktop publish dir: $(cat "$TMP/node-calls")"; exit 1; }
)
echo 'pipeline desktop publish is off by default and calls the publisher with fixed arguments'
# Pipeline always smokes without a status token and holds the checked SHA.
cmd_env_hold staging --release
command git -C "$ldir" branch -M main
printf 'OMK_TRACK=main\n' > "$ldir/.env"
pipeline_update_step() { printf 'update\n' >> "$TMP/order"; }
cmd_env_smoke() { printf 'smoke\n' >> "$TMP/order"; }
pipeline_validate() { printf 'validate\n' >> "$TMP/order"; }
# 앱 게시가 꺼져 있으면(.env 에 키 없음) 순서·hold 가 종전과 같고 게시 스크립트를 부르지 않는다.
rm -f "$TMP/node-calls"
node() { printf '%s\n' "$*" >> "$TMP/node-calls"; }
pipeline_run staging
unset -f node
[[ "$(cat "$TMP/order")" == $'update\nsmoke\nvalidate' ]]
[[ ! -e "$TMP/node-calls" ]] || { echo 'FAIL: staging pipeline published while off'; exit 1; }
[[ "$(cat "$OMK_ROOT/staging/.pipeline/hold")" == "$sha" ]]
# 켜져 있으면 스모크 뒤·검증 앞에 설치된 SHA 로 게시한다. 대기(75)·실패(1)는 그 코드로 끝나고 검증·hold 가 없다.
pipeline_desktop_publish() { printf 'desktop %s %s\n' "$1" "$2" >> "$TMP/order"; return "${DESKTOP_RC:-0}"; }
cmd_env_hold staging --release; : > "$TMP/order"
pipeline_run staging
[[ "$(cat "$TMP/order")" == $'update\nsmoke\ndesktop staging '"$sha"$'\nvalidate' ]] || { echo "FAIL: staging order $(cat "$TMP/order")"; exit 1; }
[[ "$(cat "$OMK_ROOT/staging/.pipeline/hold")" == "$sha" ]]
for code in 75 1; do
    cmd_env_hold staging --release; : > "$TMP/order"
    rc=0; ( export DESKTOP_RC="$code"; pipeline_run staging ) || rc=$?
    [[ "$rc" == "$code" ]] || { echo "FAIL: staging desktop $code ended with $rc"; exit 1; }
    [[ ! -f "$OMK_ROOT/staging/.pipeline/hold" ]] || { echo "FAIL: staging held after desktop $code"; exit 1; }
    [[ "$(cat "$TMP/order")" == $'update\nsmoke\ndesktop staging '"$sha" ]] || { echo "FAIL: staging validated after desktop $code"; exit 1; }
done
# Online chooses once; even if latest changes during update it uses captured commit.
mkdir -p "$OMK_ROOT/online/llm"
command git -C "$OMK_ROOT/online/llm" init -q
online="$OMK_ROOT/online/llm"
command git -C "$online" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m old
old="$(command git -C "$online" rev-parse HEAD)"
command git -C "$online" -c user.name=test -c user.email=t@example.com commit -q --allow-empty -m release
captured_test="$(command git -C "$online" rev-parse HEAD)"
command git -C "$online" tag v1.0.0
command git -C "$online" reset -q --hard "$old"
printf 'OMK_TRACK=release\n' > "$online/.env"
release_gate_fetch() { return 0; }
release_gate_check() { [[ "$2" == "$captured_test" ]]; }
pipeline_update_step() { command git -C "$online" tag -f v1.0.0 "$old" >/dev/null; OMK_PIPELINE_RELEASE_SHA="$2" release_behind "$online"; [[ "$RELEASE_TAG" == "$captured_test" ]]; command git -C "$online" reset -q --hard "$RELEASE_TAG"; }
pipeline_identity() { [[ "$2" == "$captured_test" ]] && printf 'identity\n' >> "$TMP/online-order"; }
pipeline_desktop_publish() { printf 'desktop %s %s\n' "$1" "$2" >> "$TMP/online-order"; return "${DESKTOP_RC:-0}"; }
pipeline_run online
[[ "$(cat "$TMP/online-order")" == $'identity\ndesktop online '"$captured_test" ]] || { echo "FAIL: online order $(cat "$TMP/online-order")"; exit 1; }
# 운영 게시 대기·실패는 제품이 올라간 뒤라도 파이프라인의 종료 코드가 된다. 설치 SHA 확인이 실패하면 게시하지 않는다.
command git -C "$online" tag -f v1.0.0 "$captured_test" >/dev/null; : > "$TMP/online-order"
rc=0; ( export DESKTOP_RC=75; pipeline_run online ) || rc=$?
[[ "$rc" == 75 ]] || { echo "FAIL: online desktop pending ended with $rc"; exit 1; }
command git -C "$online" tag -f v1.0.0 "$captured_test" >/dev/null; : > "$TMP/online-order"
rc=0; ( pipeline_identity() { return 3; }; pipeline_run online ) || rc=$?
[[ "$rc" == 3 && ! -s "$TMP/online-order" ]] || { echo "FAIL: online published after identity failure ($rc)"; exit 1; }
release_gate_check() { GATE_REASON=unverified; return 1; }
if ( pipeline_run online ) >/dev/null 2>&1; then echo 'FAIL: unverified release allowed'; exit 1; fi
echo 'pipeline identity, staging and captured release checks passed'
# Release gate rejects functional changes even when a later commit reverts them.
fixture="$TMP/release-gate"; command git init -q "$fixture"
printf '{"version":"1.0.0","dependencies":{"x":"1"}}\n' > "$fixture/package.json"
command git -C "$fixture" add .; command git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm base
base="$(command git -C "$fixture" rev-parse HEAD)"
printf '{"version":"1.0.0","dependencies":{"x":"2"}}\n' > "$fixture/package.json"
command git -C "$fixture" add .; command git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm unsafe
printf '{"version":"1.0.0","dependencies":{"x":"1"}}\n' > "$fixture/package.json"
command git -C "$fixture" add .; command git -C "$fixture" -c user.name=t -c user.email=t@e commit -qm revert
[[ -n "$(release_gate_offending "$fixture" "$base" HEAD)" ]] || { echo 'FAIL: reverted dependency change accepted'; exit 1; }
[[ "$(pm2_names staging)" == *'omk-pipeline-staging'* ]] || { echo 'FAIL: reset/status do not manage pipeline schedule'; exit 1; }
# Update failures cannot fall through to smoke/success, even in conditional callers.
release_gate_check() { return 0; }
pipeline_update_step() { return 2; }
cmd_env_smoke() { touch "$TMP/should-not-smoke"; }
if ( pipeline_run online ); then echo 'FAIL: failed update marked successful'; exit 1; fi
[[ ! -f "$TMP/should-not-smoke" ]] || { echo 'FAIL: smoke ran after failed update'; exit 1; }
pm2() { [[ "$1" != describe ]] || return 1; printf '%s\n' "$@" > "$TMP/pm2-arguments"; }
pipeline_run staging --schedule '0 * * * *'
[[ "$(tail -3 "$TMP/pm2-arguments")" == $'env\npipeline\nstaging' ]]
# 0=발견(실패), 1=없음(통과), 2 이상=검사 자체 오류(실패) — if 문은 127(도구 없음)도 '없음'으로 삼킨다
found=0; grep -Eq -- '--report|env update' "$TMP/pm2-arguments" || found=$?
[[ "$found" == 1 ]] || { echo "FAIL: schedule invokes partial flow (grep status $found)"; exit 1; }
echo 'pipeline schedules invoke the full flow without requiring status credentials'
