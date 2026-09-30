#!/usr/bin/env bash
# 대역 전역은 source 한 30-toolchain.sh 가 읽는다.
# shellcheck disable=SC2034
# mac/30-toolchain.sh 의 순수 함수 테스트 — Colima·docker·launchd 를 건드리지 않는다.
# (scripts/setup/mac/ 안에 두지 않는다 — install_mac.sh 가 그 디렉터리의 *.sh 를 전부 source 한다.)
#   bash scripts/setup/mac-toolchain.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# install_mac.sh 가 주는 전역·도우미의 최소 대역
HOME="$TMP/home"; mkdir -p "$HOME"
NODE_MAJOR=24; OMK_ROOT="$TMP/root"; PG_CONTAINER="openmake-postgres"; SKIP_DOCKER=0
log_info() { :; }; log_ok() { :; }; log_warn() { printf 'WARN %s\n' "$*"; }; log_step() { :; }
die() { printf 'DIE %s\n' "$*"; exit 2; }
add_todo() { :; }
# 호스트 사양의 대역 — 시험은 돌리는 기계의 사양에 기대지 않는다 (16GB · 8코어)
sysctl() { case "$2" in hw.memsize) echo 17179869184 ;; hw.ncpu) echo 8 ;; esac; }
HAS_LIST=" docker "
has() { [[ "$HAS_LIST" == *" $1 "* ]]; }
# shellcheck source=/dev/null
. "$HERE/mac/30-toolchain.sh"

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

# ── colima start 인자: 전용 프로필 · 기본 컨텍스트 유지 · 고정 크기 ──
eq "start args: 기본" "$(colima_start_args | tr '\n' ' ')" \
   "start --profile openmake --activate=false --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs "
eq "start args: 환경변수" "$( OMK_COLIMA_CPU=8; OMK_COLIMA_MEMORY=12; OMK_COLIMA_DISK=100; colima_start_args | tr '\n' ' ')" \
   "start --profile openmake --activate=false --cpu 8 --memory 12 --disk 100 --vm-type vz --mount-type virtiofs "

# ── VM 크기: 옵션 없이도 호스트에 맞는 값 (메모리는 절반·최대 8, CPU 는 코어 수·최대 4) ──
eq "memory: 8GB 호스트"   "$(colima_default_memory 8)"  "4"
eq "memory: 16GB 호스트"  "$(colima_default_memory 16)" "8"
eq "memory: 64GB 호스트"  "$(colima_default_memory 64)" "8"
eq "memory: 4GB 호스트"   "$(colima_default_memory 4)"  "2"
eq "memory: 알 수 없음"    "$(colima_default_memory 0)"  "8"
eq "cpu: 8코어"           "$(colima_default_cpu 8)"  "4"
eq "cpu: 2코어"           "$(colima_default_cpu 2)"  "2"
eq "cpu: 알 수 없음"       "$(colima_default_cpu 0)"  "4"

# ── ~/.docker/config.json: 플러그인 디렉터리만 더한다 (node 가 있을 때만) ──
if command -v node >/dev/null 2>&1; then
    C="$TMP/cfg"; mkdir -p "$C"
    docker_cli_plugins "$C/new.json" /opt/homebrew/lib/docker/cli-plugins
    eq "plugins: 새 파일" "$(node -p 'JSON.stringify(require(process.argv[1]))' "$C/new.json")" \
       '{"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]}'
    printf '{"currentContext":"desktop-linux","credsStore":"desktop","cliPluginsExtraDirs":["/x"]}' > "$C/old.json"
    docker_cli_plugins "$C/old.json" /opt/homebrew/lib/docker/cli-plugins
    eq "plugins: 다른 키는 그대로" "$(node -p 'JSON.stringify(require(process.argv[1]))' "$C/old.json")" \
       '{"currentContext":"desktop-linux","credsStore":"desktop","cliPluginsExtraDirs":["/x","/opt/homebrew/lib/docker/cli-plugins"]}'
    docker_cli_plugins "$C/old.json" /opt/homebrew/lib/docker/cli-plugins
    eq "plugins: 두 번 넣지 않는다" "$(node -p 'require(process.argv[1]).cliPluginsExtraDirs.length' "$C/old.json")" "2"
    printf '{ broken' > "$C/bad.json"
    eq "plugins: 깨진 파일은 경고" "$(docker_cli_plugins "$C/bad.json" /p | cut -c1-4)" "WARN"
    eq "plugins: 깨진 파일은 그대로" "$(cat "$C/bad.json")" "{ broken"
else
    echo "SKIP docker_cli_plugins (node 없음)"
fi

# ── LaunchAgent: 로그인 시 전용 프로필을 띄운다 ──
P="$TMP/agent.plist"; write_colima_agent "$P" /opt/homebrew/bin/colima "$TMP/colima.log" /usr/local/bin
ok "agent: 라벨"     'grep -q "<string>com.openmake.colima</string>" "$P"'
ok "agent: 실행 파일" 'grep -q "<string>/opt/homebrew/bin/colima</string>" "$P"'
ok "agent: 프로필"    'grep -q "<string>openmake</string>" "$P"'
ok "agent: 컨텍스트 유지" 'grep -q "<string>--activate=false</string>" "$P"'
ok "agent: 로그인 시 실행" 'grep -A1 "<key>RunAtLoad</key>" "$P" | grep -q "<true/>"'
ok "agent: 로그 경로" 'grep -q "<string>$TMP/colima.log</string>" "$P"'
# colima 는 기동할 때 호스트의 docker CLI 를 찾는다 — Docker Desktop 의 CLI(/usr/local/bin)를 쓰는 Mac 에서도 보여야 한다
ok "agent: PATH 에 docker 위치" 'grep -q "<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>" "$P"'
write_colima_agent "$P" /opt/homebrew/bin/colima "$TMP/colima.log" /opt/homebrew/bin
ok "agent: 같은 위치는 한 번만" 'grep -q "<string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>" "$P"'
# COLIMA_HOME 은 colima 가 읽는 환경변수다 — 설치기가 같은 이름을 쓰면 사용자의 값을 덮는다
ok "colima 의 환경변수 이름을 쓰지 않는다" '[[ -z "${COLIMA_HOME:-}" ]]'
if command -v plutil >/dev/null 2>&1; then ok "agent: plist 문법" 'plutil -lint "$P" >/dev/null'; fi

# ── 기존 설치본 판정: 기본 Docker 로 운영 중인 호스트는 옮기지 않는다 ──
E="$TMP/e.env"
DOCKER_UP=1; DOCKER_NAMES=""
docker() { # 기본 Docker 의 대역 — DOCKER_HOST 가 있으면 잘못 부른 것이다
    [[ -z "${DOCKER_HOST:-}" ]] || { echo "BUG: DOCKER_HOST 가 설정된 채 기본 Docker 를 조회" >&2; return 9; }
    case "$1" in
        info) [[ $DOCKER_UP -eq 1 ]] ;;
        ps)   [[ $DOCKER_UP -eq 1 ]] && printf '%s\n' $DOCKER_NAMES   # 단어 분할이 의도다 — 이름 목록 ;;
    esac
}
rm -f "$E"; DOCKER_NAMES="openmake-postgres"
ok "기존: 기본 Docker 에 openmake 컨테이너"        'installed_on_other_docker "$E"'
DOCKER_NAMES="openmake-staging-postgres"
ok "기존: 다른 환경의 컨테이너도 (호스트 단위)"     'installed_on_other_docker "$E"'
DOCKER_NAMES="postgres other-openmake-postgres openmake-postgres-exporter"
ok "새 설치: 남의 컨테이너는 무시"                '! installed_on_other_docker "$E"'
DOCKER_NAMES=""
ok "새 설치: 컨테이너도 .env 도 없음"              '! installed_on_other_docker "$E"'
printf 'PORT=52416\n' > "$E"; DOCKER_UP=0
ok "기존: .env 는 있는데 Docker 가 꺼져 있음"      'installed_on_other_docker "$E"'
printf 'PORT=52416\nDOCKER_HOST=unix:///x\n' > "$E"
ok "새 설치: .env 가 Colima 를 가리킴"            '! installed_on_other_docker "$E"'
printf 'PORT=52416\n' > "$E"; DOCKER_UP=1; DOCKER_NAMES=""
ok "새 설치: 기본 Docker 를 비웠음 (이전 완료)"    '! installed_on_other_docker "$E"'
HAS_LIST=" "
ok "새 설치: docker CLI 가 없음"                  '! installed_on_other_docker "$E"'
HAS_LIST=" docker "
# 컨테이너가 많은 호스트 — grep 이 먼저 끝나 docker ps 가 SIGPIPE 로 죽어도 판정이 뒤집히면 안 된다
DOCKER_NAMES="openmake-postgres $(seq 1 20000 | sed 's/^/c/' | tr '\n' ' ')"
ok "기존: 컨테이너가 많아도 (pipefail)" '( set -o pipefail; installed_on_other_docker "$E" )'
DOCKER_NAMES=""
eq "판정은 DOCKER_HOST 를 빼고 조회" "$( export DOCKER_HOST=unix:///colima; DOCKER_NAMES=openmake-postgres; rm -f "$E"; installed_on_other_docker "$E" 2>&1; echo "$?" )" "0"

echo ""; echo "toolchain.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
