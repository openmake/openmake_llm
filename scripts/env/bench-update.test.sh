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

# ── 무거운 단계는 호출만 센다 ──
CALLS=""; APP_STATUS=online
bench_build() { CALLS="$CALLS build"; }
bench_pm2_start() { CALLS="$CALLS start"; }
wait_http() { return 0; }
pm2_status_of() { printf '%s' "$APP_STATUS"; }
run() { CALLS=""; bench_update online "$@" >/dev/null 2>&1; printf '%s' "${CALLS# }"; }

eq "bench 그대로 + 앱 online → 빌드·재시작 안 함" "$(run)" ""
advance two
eq "origin 이 앞섬 → 받아서 빌드·재시작"          "$(run)" "build start"
eq "받은 뒤 다시 돌면 → 그대로"                     "$(run)" ""
APP_STATUS=stopped
eq "bench 그대로지만 앱이 안 떠 있음 → 빌드·기동"   "$(run)" "build start"
APP_STATUS=online
eq "--redeploy(force) → 그대로여도 다시 배포"        "$(run --force)" "build start"

printf 'bench-update: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
