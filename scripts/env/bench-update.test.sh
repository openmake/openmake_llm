#!/usr/bin/env bash
# omk.sh bench_update — bench 가 바뀌지 않았으면 다시 빌드·재시작하지 않는다. 실제 PM2·네트워크를 건드리지 않는다.
# 운영 파이프라인은 10분마다 같은 릴리스로 `env update online` 을 끝까지 돌린다. llm 은 "이미 최신"이면 배포를
# 건너뛰지만 bench_update 는 매번 빌드 + PM2 재등록을 해 openmake-bench 가 10분마다 재시작됐다(2026-10-28 ome-on).
#   bash scripts/env/bench-update.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
# shellcheck source=/dev/null
. "$HERE/omk.sh"
set +e

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }

# ── fixture: origin(bare) + 환경 online 의 bench 클론 ──
G=(-c user.email=t@example.com -c user.name=t)
git init -q --bare "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/seed" 2>/dev/null
git -C "$TMP/seed" "${G[@]}" commit -q --allow-empty -m one && git -C "$TMP/seed" push -q origin HEAD:main 2>/dev/null
BDIR="$(bench_dir online)"; mkdir -p "$(dirname "$BDIR")"
git clone -q -b main "$TMP/origin.git" "$BDIR" 2>/dev/null
printf 'OMKB_PORT=1\n' > "$BDIR/.env"; printf '.env\n' > "$BDIR/.git/info/exclude"
advance() { git -C "$TMP/seed" "${G[@]}" commit -q --allow-empty -m "$1" && git -C "$TMP/seed" push -q origin HEAD:main 2>/dev/null; }

# ── 무거운 단계는 호출만 센다. BUILD_FAIL=1 이면 빌드가 실패한다(실제 bench_build 는 die). ──
CALLS="$TMP/calls"; APP_STATUS=online; BUILD_FAIL=0
bench_build() { printf ' build' >> "$CALLS"; [[ $BUILD_FAIL -eq 0 ]] || exit 9; }
bench_pm2_start() { printf ' start' >> "$CALLS"; }
wait_http() { return 0; }
pm2_status_of() { printf '%s' "$APP_STATUS"; }
# 서브셸에서 돌린다(die·exit 가 테스트를 끝내지 않게) — 호출 기록과 종료 코드를 함께 돌려준다.
run() { : > "$CALLS"; ( bench_update online "$@" ) >/dev/null 2>&1; local rc=$? c; c="$(cat "$CALLS")"; printf '%s rc=%s' "${c# }" "$rc"; }

eq "기록 없음(이 수정 뒤 첫 갱신) → 한 번 빌드·재시작"   "$(run)" "build start rc=0"
eq "같은 커밋 + 앱 online → 빌드·재시작 안 함"            "$(run)" " rc=0"
advance two
eq "origin 이 앞섬 → 받아서 빌드·재시작"                   "$(run)" "build start rc=0"
eq "받은 뒤 다시 돌면 → 그대로"                              "$(run)" " rc=0"
APP_STATUS=stopped
eq "같은 커밋이지만 앱이 안 떠 있음 → 빌드·기동"            "$(run)" "build start rc=0"
APP_STATUS=online
eq "--redeploy(force) → 그대로여도 다시 배포"                 "$(run --force)" "build start rc=0"
advance three
BUILD_FAIL=1
eq "받은 뒤 빌드 실패 → 실패로 끝남"                          "$(run)" "build rc=9"
BUILD_FAIL=0
eq "다음 주기 — 빌드가 기록되지 않았으니 다시 빌드"          "$(run)" "build start rc=0"
eq "작업 트리는 깨끗하다(기록은 .git 안)"                     "$(git -C "$BDIR" status --porcelain)" ""

printf 'bench-update: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
