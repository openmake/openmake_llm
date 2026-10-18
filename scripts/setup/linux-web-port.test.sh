#!/usr/bin/env bash
# install_linux.sh 재설치 — 웹 포트가 충돌해 대체 포트를 고르면 .env 의 OMK_WEB_PORT 도 그 값이 되는지.
# 설치기 전체를 돌리지 않고 포트 갱신 함수만 꺼내 임시 .env 에 적용한다(실제 설치·포트 점유 없음).
#   bash scripts/setup/linux-web-port.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }

FN="$TMP/fns.sh"
sed -n '/^update_env_web_port() {/,/^}/p; /^env_value() {/,/^}/p; /^set_env() {/,/^}/p' "$HERE/../../install_linux.sh" > "$FN"
eq "함수 3개를 찾았다" "$(grep -c '^[a-z_]*() {' "$FN")" "3"
# shellcheck disable=SC2034  # 아래에서 source 하는 함수들이 읽는다
SCRIPT_DIR="$TMP"
die() { echo "die: $*" >&2; exit 1; }
# shellcheck source=/dev/null
source "$FN"

# ── OMK_WEB_PORT 가 있던 설치본: 공개 주소·CORS 와 함께 새 포트로(종전: OMK_WEB_PORT 만 옛 값으로 남았다) ──
printf 'PORT=52416\nOMK_APP_URL=http://localhost:3000\nCORS_ORIGINS=http://localhost:3000,http://localhost:52416\nOMK_WEB_PORT=3000\n' > "$TMP/.env"
update_env_web_port 3000 13000
eq "OMK_WEB_PORT" "$(env_value OMK_WEB_PORT)" "13000"
eq "OMK_APP_URL" "$(env_value OMK_APP_URL)" "http://localhost:13000"
eq "CORS_ORIGINS" "$(env_value CORS_ORIGINS)" "http://localhost:13000,http://localhost:52416"
eq "API 포트는 그대로" "$(env_value PORT)" "52416"

# ── 공개 주소에 포트가 없고 OMK_WEB_PORT 도 없던 설치본: 새 포트를 명시해 둔다(종전: 어디에도 남지 않아 기본 3000 으로 읽혔다) ──
printf 'OMK_APP_URL=https://chat.example.com\nCORS_ORIGINS=https://chat.example.com\n' > "$TMP/.env"
update_env_web_port 3000 13001
eq "OMK_WEB_PORT 추가" "$(env_value OMK_WEB_PORT)" "13001"
eq "공개 주소는 그대로" "$(env_value OMK_APP_URL)" "https://chat.example.com"
eq "OMK_WEB_PORT 한 줄" "$(grep -c '^OMK_WEB_PORT=' "$TMP/.env")" "1"

printf 'linux-web-port.test: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
