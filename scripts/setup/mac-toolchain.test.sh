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
SCRIPT_DIR="$(cd "$HERE/../.." && pwd)"; NODE_MAJOR=24; OMK_ROOT="$TMP/root"; PG_CONTAINER="openmake-postgres"; SKIP_DOCKER=0
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

# 외장 Colima 경로를 자동 기동에도 보존한다 — 실제 launchctl 은 호출하지 않는다.
COLIMA_HOME="$TMP/external Colima" SCRIPT_DIR="$SCRIPT_DIR" TEST_AGENT="$TMP/external.plist" bash -c '
    . "$SCRIPT_DIR/scripts/setup/mac/30-toolchain.sh"
    write_colima_agent "$TEST_AGENT" /opt/homebrew/bin/colima /tmp/colima-test.log /usr/local/bin
    [[ "$COLIMA_SOCK" == "$COLIMA_HOME/openmake/docker.sock" ]] && grep -qF "<string>$COLIMA_HOME</string>" "$TEST_AGENT"
' && eq "agent: 외장 Colima 경로 보존" yes yes || eq "agent: 외장 Colima 경로 보존" no yes

# ── Homebrew Docker CLI 보장 및 기존 Desktop 설치의 Colima 전환 ──
BREW_INSTALLED=" colima "; BREW_CALLED=""
brew() {
    if [[ "$1" == --prefix ]]; then printf /opt/homebrew; return; fi
    if [[ "$1" == list ]]; then [[ "$BREW_INSTALLED" == *" $3 "* ]]; return; fi
    BREW_CALLED="$*"
}
# The production function is sourced above; the stub below is only for ensure_docker.
# shellcheck disable=SC2218
install_colima
eq "Homebrew CLI 설치" "$BREW_CALLED" "install docker docker-compose docker-buildx"
BREW_CALLED=""; BREW_INSTALLED=" colima docker docker-compose docker-buildx "
# The production function is sourced above; the stub below is only for ensure_docker.
# shellcheck disable=SC2218
install_colima
eq "Homebrew 도구 설치 생략" "$BREW_CALLED" ""

E="$TMP/e.env"; MINIMAL=1; ENV_FILE="$E"; DOCKER_NAMES="openmake-postgres"; SKIP_DOCKER=0
docker() { case "$1" in info) [[ "${DOCKER_HOST:-}" == "unix://$COLIMA_SOCK" && -z "${DOCKER_CONTEXT:-}" ]];; compose) echo "Docker Compose version v2";; esac; }
colima_profile_exists() { return 1; }
install_colima() { :; }
docker_cli_plugins() { :; }
colima_start() { :; }
wait_docker_daemon() { docker info >/dev/null; }
enable_docker_autostart() { :; }
check_docker_desktop_data() { :; }
DOCKER_HOST=unix:///Users/test/.docker/run/docker.sock DOCKER_CONTEXT=desktop-linux
ensure_docker >/dev/null
eq "기존 Desktop 설치도 Colima 사용" "$DOCKER_HOST" "unix://$COLIMA_SOCK"
eq "설치 후 Desktop context 무시" "${DOCKER_CONTEXT:-}" ""

# ── 포트 충돌: 이 클론의 개발 서버('omk dev up', PM2 아님)가 잡은 포트는 옮기지 않는다 ──
PC="$TMP/clone"; mkdir -p "$PC/apps/api" "$PC/apps/web"
PT_ENV="$TMP/ports.env"
pt_run() { # $1=포트:cwd … (LISTEN 중인 포트와 그 프로세스 작업 폴더) → 옮긴 뒤의 "PORT|OMK_WEB_PORT"
    (
        SCRIPT_DIR="$PC"; ENV_FILE="$PT_ENV"; SKIP_DOCKER=1; APP_PORT=0; WEB_PORT=0; APP_NAME=a; FRONT_APP_NAME=w
        HAS_LIST=" docker lsof "
        printf 'PORT=52417\nOMK_WEB_PORT=3010\n' > "$ENV_FILE"
        PT_BUSY=" $* "
        env_value() { grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
        set_env() { local t; t="$(grep -vE "^${1}=" "$ENV_FILE")"; printf '%s\n%s=%s\n' "$t" "$1" "$2" > "$ENV_FILE"; }
        pm2_has_app() { return 1; }
        port_in_use() { [[ "$PT_BUSY" == *" $1:"* ]]; }
        lsof() { # lsof -nP -iTCP:<p> -sTCP:LISTEN -t → pid(=포트) · lsof -a -p <pid> -d cwd -Fn → n<cwd>
            case "$*" in
                *-iTCP:*) local p="${2#-iTCP:}"; port_in_use "$p" && echo "$p" ;;
                *"-d cwd"*) local e="${PT_BUSY#* $3:}"; printf 'p%s\nn%s\n' "$3" "${e%% *}" ;;
            esac
        }
        ensure_ports >/dev/null 2>&1
        printf '%s|%s' "$(env_value PORT)" "$(env_value OMK_WEB_PORT)"
    )
}
eq "ports: 비어 있으면 그대로"          "$(pt_run)"                                                  "52417|3010"
eq "ports: 이 클론의 dev 서버면 그대로" "$(pt_run "52417:$PC/apps/api" "3010:$PC/apps/web")"         "52417|3010"
eq "ports: 남의 프로세스면 옮긴다"      "$(pt_run "52417:/elsewhere/api" "3010:/elsewhere/web")"     "52418|13000"
eq "ports: 이름만 비슷한 폴더는 남의 것" "$(pt_run "52417:${PC}-other/apps/api")"                     "52418|3010"

echo ""; echo "toolchain.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
