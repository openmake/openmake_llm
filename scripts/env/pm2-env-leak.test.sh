#!/usr/bin/env bash
# PM2 예약 작업의 옵션이 배포한 앱으로 새지 않는지 — 실제 PM2·docker·네트워크를 건드리지 않는다.
# PM2 는 앱 옵션을 같은 이름의 환경변수로 자식에 넣는다(omk-pipeline-<env> 의 cron_restart='*/10 * * * *').
# 그 작업 안에서 `pm2 start ecosystem.config.js --only <앱>` 을 하면 PM2 가 그 환경변수를 앱 옵션으로 읽어
# openmake-llm·next·bench 가 10분마다 재시작됐다(2026-10-28 ome-on). 두 진입점이 시작할 때 지워야 한다.
#   bash scripts/env/pm2-env-leak.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$HERE/../.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }

LEAK='*/10 * * * *'

# omk.sh — env pipeline·update·backup 이 PM2 예약 작업으로 도는 진입점
got="$(cron_restart="$LEAK" OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1 bash -c '. "$1/scripts/env/omk.sh"; printf "%s" "${cron_restart-<unset>}"' _ "$ROOT")"
eq "omk.sh 는 상속한 cron_restart 를 지운다" "$got" "<unset>"

# openmake_llm.sh — deploy 가 pm2 start/restart 를 하는 곳. main 대신 환경만 보고하게 복사본을 만든다.
APP="$TMP/app"; mkdir -p "$APP/scripts/lib"
cp "$ROOT/scripts/lib/colima.sh" "$APP/scripts/lib/"
awk '$0 == "main \"$@\"" { print "printf \"%s\" \"${cron_restart-<unset>}\""; next } { print }' "$ROOT/openmake_llm.sh" > "$APP/openmake_llm.sh"
got="$(cron_restart="$LEAK" bash "$APP/openmake_llm.sh" status 2>/dev/null)"
eq "openmake_llm.sh 는 상속한 cron_restart 를 지운다" "$got" "<unset>"

# 예약 작업 자신은 그대로 등록돼야 한다 — 지우는 것은 상속된 환경변수뿐, --cron-restart 인자는 아니다.
eq "pipeline 예약 등록은 --cron-restart 인자를 쓴다" "$(grep -c -- '--cron-restart "\$cron"' "$ROOT/scripts/env/pipeline.sh")" "1"

printf 'pm2-env-leak: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
