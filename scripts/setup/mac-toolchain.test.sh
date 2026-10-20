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

# ── LaunchAgent: 로그인 시 전용 프로필을 띄운다 ──
P="$TMP/agent.plist"; write_colima_agent "$P" /opt/homebrew/bin/colima "$TMP/colima.log" /usr/local/bin
ok "agent: 라벨"     'grep -q "<string>com.openmake.colima</string>" "$P"'
ok "agent: 실행 파일" 'grep -q "<string>/opt/homebrew/bin/colima</string>" "$P"'
ok "agent: 프로필"    'grep -q "<string>openmake</string>" "$P"'
ok "agent: 컨텍스트 유지" 'grep -q -- "--activate=false" "$P"'
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

# 경로의 &·따옴표·< 는 XML 로 이스케이프한다 — 외장 디스크 이름에 흔하다.
XP="$TMP/escaped.plist"
COLIMA_HOME="$TMP/Ext & \"Q\" <C>" SCRIPT_DIR="$SCRIPT_DIR" TEST_AGENT="$XP" bash -c '
    . "$SCRIPT_DIR/scripts/setup/mac/30-toolchain.sh"
    write_colima_agent "$TEST_AGENT" "/opt/b&b/bin/colima" "/tmp/l\"o<g>.log" /usr/local/bin
'
ok "agent: XML 이스케이프 (&)" 'grep -qF "<string>/opt/b&amp;b/bin/colima</string>" "$XP"'
ok "agent: XML 이스케이프 (COLIMA_HOME)" 'grep -qF "Ext &amp; &quot;Q&quot; &lt;C&gt;</string>" "$XP"'
ok "agent: XML 이스케이프 (로그)" 'grep -qF "<string>/tmp/l&quot;o&lt;g&gt;.log</string>" "$XP"'
if command -v plutil >/dev/null 2>&1; then ok "agent: 이스케이프한 plist 문법" 'plutil -lint "$XP" >/dev/null'; fi

# ── 자동 시작 등록: 로드된 정의(실행 파일·인자·환경)가 같으면 다시 올리지 않는다 (launchctl 대역) ──
# shellcheck source=/dev/null
. "$HERE/fake-launchctl.test-lib.sh"
FB="$TMP/fakebin"; mkdir -p "$FB"; printf '#!/bin/sh\n' > "$FB/colima"; printf '#!/bin/sh\n' > "$FB/docker"; chmod +x "$FB/colima" "$FB/docker"
agent_run() { PATH="$FB:$PATH" enable_docker_autostart "$TMP/agent-log/colima.log"; }
# XML 이스케이프는 셸 판에 기대지 않는다 — bash 5.2+ 의 patsub_replacement 는 ${v//x/&...} 의 & 를 바꿔 넣는다 (tom 사고).
# plist 를 다시 읽은 값이 입력과 글자 그대로 같아야 하고, guard 는 sh 문법으로 유효해야 한다.
RT_COLIMA="/opt/b&b \"q\" <x>/bin/colima"; RT_LOG="/tmp/l&g \"o\" <g> 'a'.log"; RT_HOME="$TMP/Ext & \"Q\" <C> 'a'"
COLIMA_HOME="$RT_HOME" SCRIPT_DIR="$SCRIPT_DIR" TEST_AGENT="$TMP/roundtrip.plist" RT_COLIMA="$RT_COLIMA" RT_LOG="$RT_LOG" bash -c '
    . "$SCRIPT_DIR/scripts/setup/mac/30-toolchain.sh"
    write_colima_agent "$TEST_AGENT" "$RT_COLIMA" "$RT_LOG" /usr/local/bin
'
RTA=(); RTE=""; RTO=""; RTK=""
while IFS=$'\t' read -r tag v; do
    case "$tag" in A) RTA+=("$v") ;; K) RTK="$v" ;; V) [[ $RTK == COLIMA_HOME ]] && RTE="$v" ;; O) RTO="$v" ;; esac
done < <(fake_plist_fields "$TMP/roundtrip.plist")
eq "xml: guard 인자 = 상수 (bash ${BASH_VERSINFO[0]})" "${RTA[2]:-}" "$COLIMA_AGENT_GUARD"
eq "xml: colima 경로 그대로" "${RTA[3]:-}" "$RT_COLIMA"
eq "xml: COLIMA_HOME 그대로" "$RTE" "$RT_HOME"
eq "xml: 로그 경로 그대로" "$RTO" "$RT_LOG"
printf '%s\n' "${RTA[2]:-}" > "$TMP/guard.sh"
ok "xml: guard 는 sh 문법으로 유효 (/bin/sh -n)" '/bin/sh -n "$TMP/guard.sh"'
if command -v plutil >/dev/null 2>&1; then
    ok "xml: plutil 이 읽은 guard = 상수" '[[ "$(plutil -extract ProgramArguments.2 raw -o - "$TMP/roundtrip.plist")" == "$COLIMA_AGENT_GUARD" ]]'
fi

# 로그인 때 저장소(외장 디스크)가 없으면 새 VM 을 만들지 않는다 — LaunchAgent 의 명령을 그대로 실행해 본다.
GC="$TMP/guard-bin/colima"; mkdir -p "$TMP/guard-bin"
printf '#!/bin/sh\nprintf "%%s " "$@" > "%s"\n' "$TMP/guard-called" > "$GC"; chmod +x "$GC"
write_colima_agent "$TMP/guard.plist" "$GC" "$TMP/g.log" "$TMP/guard-bin"
GARGS=(); while IFS=$'\t' read -r tag v; do [[ $tag == A ]] && GARGS+=("$v"); done < <(fake_plist_fields "$TMP/guard.plist")
GH="$TMP/guard home & 'q'"
grc=0; (COLIMA_HOME="$GH" "${GARGS[@]}") 2>/dev/null || grc=$?
eq "agent: 프로필이 없으면 colima 를 실행하지 않는다" "$grc|$([[ -e "$TMP/guard-called" ]] && echo called)" "78|"
mkdir -p "$GH/openmake"; : > "$GH/openmake/colima.yaml"
grc=0; (COLIMA_HOME="$GH" "${GARGS[@]}") || grc=$?
eq "agent: 프로필이 있으면 기존 프로필만 띄운다" "$grc|$(cat "$TMP/guard-called" 2>/dev/null)" "0|start --profile openmake --activate=false "

fake_lctl_reset
agent_run >/dev/null
eq "autostart: 새 등록은 bootstrap 만" "$(fake_lctl_log)" "bootstrap"
ok "autostart: 로드된 정의 확인" 'PATH="$FB:$PATH" colima_agent_loaded_matches "$FB/colima" "$FB" "$TMP/agent-log/colima.log"'
: > "$LCTL_STATE/log"; agent_run >/dev/null
eq "autostart: 같은 정의·로드 상태는 그대로" "$(fake_lctl_log)" ""
ok "autostart: 백업을 만들지 않는다" '[[ ! -d "$OMK_ROOT/backups/launchd" ]]'
fake_lctl_reset; agent_run >/dev/null
eq "autostart: 등록이 없으면 bootstrap 만" "$(fake_lctl_log)" "bootstrap"
# 파일은 같아도 로드된 정의가 예전 것(다른 COLIMA_HOME)이면 다시 올린다
sed "s|<string>$OPENMAKE_COLIMA_HOME</string>|<string>/old/colima</string>|" "$COLIMA_AGENT_PLIST" > "$TMP/loaded-old.plist"
fake_lctl_reset; fake_lctl_load "$TMP/loaded-old.plist"; printf '%s' "$COLIMA_AGENT_PLIST" > "$LCTL_STATE/path"
ok "autostart: 예전 환경으로 로드된 정의는 불일치" '! PATH="$FB:$PATH" colima_agent_loaded_matches "$FB/colima" "$FB" "$TMP/agent-log/colima.log"'
# 알려진 예전 에이전트에서 이어받는 설정: --save-config=false · 소유자 HOME · 따로 둔 stderr — 같은 작성기·같은 비교기
KP="$TMP/kept.plist"; KH="$TMP/owner home"
write_colima_agent "$KP" "$GC" "$TMP/out.log" "$TMP/guard-bin" "$TMP/err.log" --save-config=false "$KH"
KA=(); KE=""; KO=""; KR=""; KK=""
while IFS=$'\t' read -r tag v; do
    case "$tag" in A) KA+=("$v") ;; K) KK="$v" ;; V) [[ $KK == HOME ]] && KE="$v" ;; O) KO="$v" ;; E) KR="$v" ;; esac
done < <(fake_plist_fields "$KP")
eq "kept: 인자" "$(printf '%s|' "${KA[@]}")" "/bin/sh|-c|$COLIMA_AGENT_GUARD_WITH_FLAGS|$GC|openmake|--save-config=false|"
eq "kept: HOME·stdout·stderr" "$KE|$KO|$KR" "$KH|$TMP/out.log|$TMP/err.log"
rm -f "$TMP/guard-called"; grc=0; (COLIMA_HOME="$GH" "${KA[@]}") || grc=$?
eq "kept: guard 가 플래그를 넘긴다" "$grc|$(cat "$TMP/guard-called" 2>/dev/null)" "0|start --profile openmake --save-config=false --activate=false "
printf '%s\n' "$COLIMA_AGENT_GUARD_WITH_FLAGS" > "$TMP/guard-flags.sh"; ok "kept: guard 문법 (/bin/sh -n)" '/bin/sh -n "$TMP/guard-flags.sh"'
fake_lctl_reset; fake_lctl_load "$KP" "$COLIMA_AGENT_PLIST"
ok "kept: 같은 설정으로 로드된 정의는 일치" 'colima_agent_loaded_matches "$GC" "$TMP/guard-bin" "$TMP/out.log" "$TMP/err.log" --save-config=false "$KH"'
ok "kept: 플래그를 빼면 불일치" '! colima_agent_loaded_matches "$GC" "$TMP/guard-bin" "$TMP/out.log" "$TMP/err.log" "" "$KH"'
ok "kept: HOME 을 빼면 불일치" '! colima_agent_loaded_matches "$GC" "$TMP/guard-bin" "$TMP/out.log" "$TMP/err.log" --save-config=false ""'
ok "kept: stderr 가 다르면 불일치" '! colima_agent_loaded_matches "$GC" "$TMP/guard-bin" "$TMP/out.log" "$TMP/out.log" --save-config=false "$KH"'

# 로드된 정의는 인자 순서·개수와 환경 전체까지 같아야 한다 (launchd 가 넣는 키는 제외)
loaded_variant() { # $1=이름 $2=sed 식
    sed "$2" "$COLIMA_AGENT_PLIST" > "$TMP/variant.plist"; fake_lctl_reset; fake_lctl_load "$TMP/variant.plist" "$COLIMA_AGENT_PLIST"
    ok "loaded: $1 → 불일치" '! PATH="$FB:$PATH" colima_agent_loaded_matches "$FB/colima" "$FB" "$TMP/agent-log/colima.log"'
}
loaded_variant "프로필 인자 없음" '/<string>openmake<\/string>/d'
loaded_variant "다른 실행 파일" "s|<string>$FB/colima</string>|<string>/other/colima</string>|"
loaded_variant "추가 인자" "s|<string>openmake</string>|<string>openmake</string><string>--cpu</string>|"
loaded_variant "추가 환경" 's|<key>PATH</key>|<key>DOCKER_CONTEXT</key><string>colima</string><key>PATH</key>|'
loaded_variant "stderr 없음" '/<key>StandardErrorPath<\/key>/,/<string>/d'
loaded_variant "다른 로그" "s|<string>$TMP/agent-log/colima.log</string>|<string>/tmp/other.log</string>|"
fake_lctl_reset; fake_lctl_load "$COLIMA_AGENT_PLIST"
ok "loaded: 같은 정의 (launchd 주입 키 무시)" 'PATH="$FB:$PATH" colima_agent_loaded_matches "$FB/colima" "$FB" "$TMP/agent-log/colima.log"'
fake_lctl_reset; fake_lctl_load "$TMP/loaded-old.plist" "$COLIMA_AGENT_PLIST"
agent_run >/dev/null
eq "autostart: 로드된 정의가 다르면 다시 올린다" "$(fake_lctl_log)" "bootout bootstrap"
ok "autostart: 파일이 같으면 백업하지 않는다" '[[ ! -d "$OMK_ROOT/backups/launchd" ]]'
printf 'old definition\n' > "$COLIMA_AGENT_PLIST"
: > "$LCTL_STATE/log"; agent_run >/dev/null
eq "autostart: 정의가 바뀌면 다시 올린다" "$(fake_lctl_log)" "bootout bootstrap"
ok "autostart: 이전 정의 백업 (LaunchAgents 밖)" 'grep -q "old definition" "$OMK_ROOT/backups/launchd/"*.before-colima-*'
ok "autostart: 백업은 본인만 읽는다" '[[ "$(ls -l "$OMK_ROOT/backups/launchd/"*.before-colima-* | cut -c1-10)" == -rw------- ]]'
ok "autostart: LaunchAgents 에는 plist 하나" '[[ "$(ls "$HOME/Library/LaunchAgents")" == com.openmake.colima.plist ]]'
ok "autostart: 새 정의 기록" 'grep -q "<string>$FB/colima</string>" "$COLIMA_AGENT_PLIST"'
ok "autostart: 로그 경로 지정" 'grep -q "<string>$TMP/agent-log/colima.log</string>" "$COLIMA_AGENT_PLIST"'
# 백업이 실패하면 정의·등록을 바꾸지 않고 실패를 돌려준다
printf 'kept definition\n' > "$COLIMA_AGENT_PLIST"; fake_lctl_reset; fake_lctl_load "$TMP/loaded-old.plist" "$COLIMA_AGENT_PLIST"
mv "$OMK_ROOT/backups" "$TMP/backups.saved"; printf 'not a directory' > "$OMK_ROOT/backups"
brc=0; agent_run >/dev/null 2>&1 || brc=$?
eq "autostart: 백업 실패 → 실패 반환" "$([[ $brc -ne 0 ]] && echo failed)" "failed"
eq "autostart: 백업 실패 → 정의 그대로" "$(cat "$COLIMA_AGENT_PLIST")" "kept definition"
eq "autostart: 백업 실패 → launchctl 변경 없음" "$(fake_lctl_log)" ""
ok "autostart: 백업 실패 → 로드된 정의 그대로" '[[ -f "$LCTL_STATE/loaded.plist" ]]'
rm -f "$OMK_ROOT/backups"; mv "$TMP/backups.saved" "$OMK_ROOT/backups"
# GUI 세션이 없으면(SSH 전용) 정의만 두고 등록은 보류로 알린다 — sudo·system 도메인으로 우회하지 않는다
rm -f "$COLIMA_AGENT_PLIST"; fake_lctl_reset 0
sudo() { echo "sudo $*" >> "$LCTL_STATE/log"; return 1; }
eq "autostart: GUI 도메인 없음 → 보류 안내" "$(agent_run | grep -c '등록 보류')" "1"
eq "autostart: GUI 도메인 없음 → 등록·sudo 시도 없음" "$(fake_lctl_log)" ""
ok "autostart: GUI 도메인 없음 → 정의는 기록" '[[ -f "$COLIMA_AGENT_PLIST" ]]'
unset -f launchctl sudo; rm -rf "$LCTL_STATE"

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

# 설치기가 Homebrew bin 을 앞에 둘 때도 고정한 node@24 가 먼저다
mkdir -p "$TMP/pinned-node"; printf '#!/bin/sh\necho v24\n' > "$TMP/pinned-node/node"; chmod +x "$TMP/pinned-node/node"
eq "install_colima: 고정 node 우선" "$(OMK_NODE_BIN="$TMP/pinned-node"; PATH="$TMP/pinned-node:/usr/bin:/bin"; install_colima; printf '%s' "${PATH%%:*}")" "$TMP/pinned-node"

# 이미 만든 프로필의 저장소가 없으면(외장 디스크 미마운트) 새 VM 을 만들지 않는다
storage_run() { # $1=colima-openmake 컨텍스트 소켓(없으면 미등록) [$2=기존 설치 .env 내용] [$3=full: 전체 설치 경로] → 출력|colima 호출
    (
        : > "$TMP/colima-calls"; rm -rf "$OPENMAKE_COLIMA_HOME"
        if [[ "${3:-}" == full ]]; then
            MINIMAL=0; omk_env_name() { printf staging; }; ENV_FILE="$TMP/unused.env"
            [[ -z "${2:-}" ]] || { mkdir -p "$OMK_ROOT/staging/llm"; printf '%s\n' "$2" > "$OMK_ROOT/staging/llm/.env"; }
        else
            MINIMAL=1; ENV_FILE="$TMP/storage.env"; rm -f "$ENV_FILE"
            [[ -z "${2:-}" ]] || printf '%s\n' "$2" > "$ENV_FILE"
        fi
        colima() { printf ' %s' "$1" >> "$TMP/colima-calls"; [[ $1 != status ]]; }
        docker() { [[ "$1 $2" == "context inspect" && -n "$CTX_ENDPOINT" ]] && echo "$CTX_ENDPOINT"; [[ "$1 $2" != "context inspect" || -n "$CTX_ENDPOINT" ]]; }
        CTX_ENDPOINT="$1"
        out="$(colima_start 2>&1)"; printf '%s|%s' "$(printf '%s' "$out" | grep -c DIE)" "$(cat "$TMP/colima-calls")"
    )
}
eq "colima_start: 등록된 프로필의 저장소 없음 → 중단" "$(storage_run "unix://$COLIMA_SOCK")" "1|"
ok "colima_start: 중단 시 COLIMA_HOME 을 만들지 않는다" '[[ ! -d "$OPENMAKE_COLIMA_HOME" ]]'
eq "colima_start: 새 설치는 VM 생성" "$(storage_run "")" "0| status start"
# 컨텍스트 조회가 실패하고 /Volumes 경로도 아니어도, 이 설치의 .env 가 전용 Colima 소켓을 쓰던 설치면 새 VM 을 만들지 않는다
MANAGED_ENV="DOCKER_HOST=unix://$COLIMA_SOCK"
eq "colima_start: 기존 Colima 설치(.env, --minimal) + 컨텍스트 없음 → 중단" "$(storage_run "" "$MANAGED_ENV")" "1|"
ok "colima_start: 기존 설치 중단 시 COLIMA_HOME 을 만들지 않는다" '[[ ! -d "$OPENMAKE_COLIMA_HOME" ]]'
eq "colima_start: 기존 Colima 설치(.env, 전체 설치) + 컨텍스트 없음 → 중단" "$(storage_run "" "$MANAGED_ENV" full)" "1|"
rm -rf "$OMK_ROOT/staging"
# Desktop 시절 설치(.env 에 Colima 소켓 없음)는 첫 Colima VM 을 만들 수 있다 — 기존 데이터는 check_docker_desktop_data 가 지킨다
eq "colima_start: Desktop 시절 설치는 첫 VM 생성 허용" "$(storage_run "" "DOCKER_HOST=")" "0| status start"

# 설치기: 정리 명령의 오류(2)는 설치를 멈추고, 보류(1)는 경고로 남긴다
mkdir -p "$TMP/fake-repo/scripts/setup"; printf '#!/bin/sh\nexit "$FAKE_REPAIR_RC"\n' > "$TMP/fake-repo/scripts/setup/mac-host-repair.sh"
eq "run_mac_host_repair: 오류 → 중단" "$(SCRIPT_DIR="$TMP/fake-repo" FAKE_REPAIR_RC=2 bash -c "$(declare -f run_mac_host_repair die log_warn add_todo); run_mac_host_repair; echo continued" 2>&1 | cut -c1-3 | tr '\n' ' ')" "DIE "
eq "run_mac_host_repair: 보류 → 경고 후 계속" "$(SCRIPT_DIR="$TMP/fake-repo" FAKE_REPAIR_RC=1 bash -c "$(declare -f run_mac_host_repair die log_warn add_todo); run_mac_host_repair; echo continued" 2>&1 | cut -c1-4 | tr '\n' ' ')" "WARN cont "

E="$TMP/e.env"; MINIMAL=1; ENV_FILE="$E"; DOCKER_NAMES="openmake-postgres"; SKIP_DOCKER=0
docker() { case "$1" in info) [[ "${DOCKER_HOST:-}" == "unix://$COLIMA_SOCK" && -z "${DOCKER_CONTEXT:-}" ]];; compose) echo "Docker Compose version v2";; esac; }
colima_profile_exists() { return 1; }
install_colima() { :; }
colima_start() { :; }
wait_docker_daemon() { docker info >/dev/null; }
REPAIR_CALLED=""
run_mac_host_repair() { REPAIR_CALLED="$DOCKER_HOST"; }
check_docker_desktop_data() { :; }
DOCKER_HOST=unix:///Users/test/.docker/run/docker.sock DOCKER_CONTEXT=desktop-linux
ensure_docker >/dev/null
eq "기존 Desktop 설치도 Colima 사용" "$DOCKER_HOST" "unix://$COLIMA_SOCK"
eq "설치 후 Desktop context 무시" "${DOCKER_CONTEXT:-}" ""
eq "설치기는 같은 호스트 정리 명령을 쓴다" "$REPAIR_CALLED" "unix://$COLIMA_SOCK"

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
