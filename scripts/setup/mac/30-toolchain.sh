# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — Node 24 · PM2 · Docker(전용 Colima) · 포트 충돌 회피
# ==============================================================================

# Node 버전 검사(.node-version 정확 일치) — 저장소 루트는 install_mac.sh 의 SCRIPT_DIR.
# shellcheck source=/dev/null
. "$SCRIPT_DIR/scripts/lib/node-version.sh"

ensure_node() {
    log_step "Node.js $NODE_MAJOR"
    local bin
    bin="$(brew --prefix)/opt/node@$NODE_MAJOR/bin"
    [[ -x "$bin/node" ]] || die "node@$NODE_MAJOR 가 없습니다 (brew install node@$NODE_MAJOR)"
    # keg-only formula 라 PATH 에 직접 올린다 — PM2 가 기동 시점 PATH 의 node 를 쓴다.
    export PATH="$bin:$PATH"
    OMK_NODE_BIN="$bin"
    persist_path "$bin"
    # 메이저만이 아니라 .node-version 과 정확히 같아야 한다 (안내는 require_node_version 이 stderr 에 낸다).
    require_node_version "$SCRIPT_DIR" \
        || die "node $(node -v) 가 .node-version($(node_version_pinned "$SCRIPT_DIR")) 과 다릅니다 — 위 안내대로 맞춘 뒤 다시 실행하세요."
    # brew upgrade 가 다른 판으로 올리지 않게 고정한다 (실패해도 설치는 계속).
    brew pin "node@$NODE_MAJOR" >/dev/null 2>&1 || log_warn "brew pin node@$NODE_MAJOR 실패 — 'brew pin node@$NODE_MAJOR' 를 직접 실행하세요."
    log_ok "node $(node -v) / npm $(npm -v)"
}

ensure_pm2() {
    log_step "PM2"
    if ! has pm2; then
        npm install -g pm2 >/dev/null 2>&1 || die "pm2 설치 실패 — 'npm i -g pm2' 를 직접 실행한 뒤 재시도하세요."
    fi
    log_ok "pm2 $(pm2 -v 2>/dev/null)"
}

pm2_has_app() { pm2 describe "$1" >/dev/null 2>&1; }

# ── Docker — 전용 Colima (프로필 openmake) ───────────────────────────────────
# macOS OpenMake 는 Docker Desktop 유무와 무관하게 자기 Colima VM 에서 실행한다.
# 기본 Docker 컨텍스트는 바꾸지 않으며, OpenMake 명령만 전용 소켓을 선택한다.
DOCKER_COMPOSE="docker compose"
readonly COLIMA_PROFILE="openmake"
# 명시한 COLIMA_HOME 또는 등록된 프로필의 경로를 자동 기동에도 그대로 쓴다.
. "$SCRIPT_DIR/scripts/lib/colima.sh"
OPENMAKE_COLIMA_HOME="$(openmake_colima_home)" || die "Colima 경로를 확인할 수 없습니다."
readonly OPENMAKE_COLIMA_HOME
readonly COLIMA_DIR="$OPENMAKE_COLIMA_HOME/$COLIMA_PROFILE"
readonly COLIMA_SOCK="$COLIMA_DIR/docker.sock"
readonly COLIMA_AGENT="com.openmake.colima"
readonly COLIMA_AGENT_PLIST="$HOME/Library/LaunchAgents/$COLIMA_AGENT.plist"
readonly DOCKER_WAIT_TRIES=60          # × 2초 = 2분
# VM 크기 — 옵션 없이 설치해도 그 호스트에서 뜨는 값을 고른다. 환경변수를 주면 그 값을 쓴다.
#   메모리: 호스트의 절반, 최대 8GB (작업 샌드박스 1GB × 4~5 개 + 상시 컨테이너 약 2GB), 최소 2GB
#   CPU:    호스트의 코어 수, 최대 4
colima_default_memory() { # $1=호스트 RAM(GB). 0 = 알 수 없음
    local half=$(( $1 / 2 ))
    if   [[ "$1" -le 0 ]];   then echo 8
    elif [[ $half -ge 8 ]];  then echo 8
    elif [[ $half -lt 2 ]];  then echo 2
    else echo "$half"; fi
}
colima_default_cpu() { # $1=호스트 코어 수. 0 = 알 수 없음
    if [[ "$1" -le 0 || "$1" -ge 4 ]]; then echo 4; else echo "$1"; fi
}
host_ram_gb() { echo $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )); }
host_cpus()   { sysctl -n hw.ncpu 2>/dev/null || echo 0; }
OMK_COLIMA_CPU="${OMK_COLIMA_CPU:-$(colima_default_cpu "$(host_cpus)")}"
OMK_COLIMA_MEMORY="${OMK_COLIMA_MEMORY:-$(colima_default_memory "$(host_ram_gb)")}"
OMK_COLIMA_DISK="${OMK_COLIMA_DISK:-60}"        # GB — 런타임 이미지 약 7GB + DB + 캐시

colima_profile_exists() { [[ -f "$COLIMA_DIR/colima.yaml" ]]; }

# 새 프로필을 만들 때의 인자 (한 줄에 하나). 이미 있는 프로필은 크기 옵션 없이 띄운다 — 설정을 덮지 않는다.
colima_start_args() {
    printf '%s\n' start --profile "$COLIMA_PROFILE" --activate=false \
        --cpu "$OMK_COLIMA_CPU" --memory "$OMK_COLIMA_MEMORY" --disk "$OMK_COLIMA_DISK" \
        --vm-type vz --mount-type virtiofs
}

install_colima() {
    local missing="" formula prefix
    for formula in colima docker docker-compose docker-buildx; do
        brew list --formula "$formula" >/dev/null 2>&1 || missing="$missing $formula"
    done
    prefix="$(brew --prefix)" || die "Homebrew 경로를 확인할 수 없습니다."
    export PATH="$prefix/bin:$PATH"
    # Homebrew bin 에 다른 node 가 있어도 ensure_node 가 고른 고정 판이 먼저다.
    [[ -z "${OMK_NODE_BIN:-}" ]] || export PATH="$OMK_NODE_BIN:$PATH"
    [[ -z "${missing// /}" ]] && return 0
    log_info "설치:$missing"
    # 단어 분할이 의도다 — brew formula 이름 목록.
    # shellcheck disable=SC2086
    brew install $missing || die "brew install 실패:$missing — 직접 실행한 뒤 재시도하세요."
}

# 이 설치의 .env — --minimal 은 클론의 .env, 전체 설치는 omk 규칙 위치.
openmake_install_env() {
    if [[ "${MINIMAL:-0}" == 1 ]]; then printf '%s' "$ENV_FILE"; else printf '%s' "$OMK_ROOT/$(omk_env_name)/llm/.env"; fi
}

# 이미 만든 프로필의 저장소가 사라졌는가 — 외장 볼륨이 없거나, 이 설치의 .env 가 전용 Colima 소켓을 쓰고 있었거나
# (50-env.sh 가 Colima 를 쓸 때만 DOCKER_HOST 를 남긴다), colima-openmake 컨텍스트가 이 소켓으로 등록돼 있는데 프로필이 없다.
colima_storage_missing() {
    local volume endpoint envf
    case "$OPENMAKE_COLIMA_HOME" in
        /Volumes/*) volume="${OPENMAKE_COLIMA_HOME#/Volumes/}"; [[ -d "/Volumes/${volume%%/*}" ]] || return 0 ;;
    esac
    envf="$(openmake_install_env)"
    if [[ -f "$envf" ]] && grep -qE '^DOCKER_HOST=unix://.+/openmake/docker\.sock$' "$envf"; then return 0; fi
    endpoint="$(docker context inspect colima-openmake --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || return 1
    [[ "$endpoint" == "unix://$COLIMA_SOCK" ]]
}

colima_start() {
    # colima 는 ~/.colima 가 있으면 그곳을, 없고 XDG_CONFIG_HOME 이 있으면 그 아래를 쓴다 — 접속 규칙의 소켓 경로와 맞춘다.
    export COLIMA_HOME="$OPENMAKE_COLIMA_HOME"
    # 처음 설치만 VM 을 만든다 — 기존 설치의 저장소가 없으면 빈 VM 으로 바꿔치지 않는다 (경로도 만들지 않는다).
    if ! colima_profile_exists && colima_storage_missing; then
        die "Colima 프로필 $COLIMA_PROFILE 이 $COLIMA_DIR 에 없습니다 — 외장 디스크가 연결됐는지 확인하세요. 새 VM 을 만들지 않았습니다."
    fi
    mkdir -p "$COLIMA_HOME"
    if colima status --profile "$COLIMA_PROFILE" >/dev/null 2>&1; then
        return 0
    fi
    if colima_profile_exists; then
        log_info "Colima 기동 (프로필 $COLIMA_PROFILE)"
        colima start --profile "$COLIMA_PROFILE" --activate=false || die "colima start 실패 — 위 출력을 확인하세요."
    else
        log_info "Colima VM 생성 (CPU $OMK_COLIMA_CPU · 메모리 ${OMK_COLIMA_MEMORY}GB · 디스크 ${OMK_COLIMA_DISK}GB) — 첫 기동은 수 분 걸립니다"
        local args=() a
        while IFS= read -r a; do args+=("$a"); done < <(colima_start_args)
        colima "${args[@]}" || die "colima start 실패 — 위 출력을 확인하세요."
    fi
}

wait_docker_daemon() {
    local i
    for ((i = 1; i <= DOCKER_WAIT_TRIES; i++)); do
        docker info >/dev/null 2>&1 && { log_ok "Docker 데몬 준비 완료 (~$((i * 2))s)"; return 0; }
        sleep 2
    done
    die "Docker 데몬이 2분 안에 준비되지 않았습니다 — 'colima status --profile $COLIMA_PROFILE' 을 확인한 뒤 재실행하세요."
}

# LaunchAgent 는 설치된 기동 가드(scripts/setup/colima-boot-guard.sh 의 사본)로 기존 프로필만 띄운다 —
# 저장소·Lima 인스턴스가 없으면 시작하지 않고(빈 VM 생성 방지), 지난 부팅의 비정상 종료가 남긴 ha.pid·vz.pid 만 보관 후 시작한다.
# 저장소가 외장 디스크일 수 있어 사본은 내장 홈에 둔다. docker-config-reconcile.cjs 가 같은 인자 모양(/bin/bash <가드> <colima> openmake [플래그])을 안다.
readonly COLIMA_BOOT_GUARD_SRC="$SCRIPT_DIR/scripts/setup/colima-boot-guard.sh"
readonly COLIMA_BOOT_GUARD="$HOME/.local/share/openmake/colima-boot-guard.sh"

colima_boot_guard_installed() { [[ -x "$COLIMA_BOOT_GUARD" ]] && cmp -s "$COLIMA_BOOT_GUARD_SRC" "$COLIMA_BOOT_GUARD"; }

# 같은 내용이면 그대로. 바꿀 때는 임시 파일에 쓴 뒤 옮긴다 — 실패하면 1 (에이전트 정의·등록을 바꾸지 않게).
install_colima_boot_guard() {
    colima_boot_guard_installed && return 0
    local tmp
    if mkdir -p "$(dirname "$COLIMA_BOOT_GUARD")" && tmp="$(mktemp "$COLIMA_BOOT_GUARD.XXXXXX")" \
        && cp "$COLIMA_BOOT_GUARD_SRC" "$tmp" && chmod 755 "$tmp" && mv "$tmp" "$COLIMA_BOOT_GUARD"; then
        log_info "Colima 기동 가드 설치: $COLIMA_BOOT_GUARD"; return 0
    fi
    rm -f "${tmp:-}"; log_warn "Colima 기동 가드를 설치하지 못했습니다 ($COLIMA_BOOT_GUARD) — 정의·등록을 바꾸지 않았습니다."; return 1
}

# plist <string> 값 — 경로의 & " ' < > (외장 디스크 이름 등). sed 로 한다:
# bash 5.2+ 는 patsub_replacement 가 켜져 ${v//x/&amp;} 의 & 를 찾은 글자로 바꾼다 (같은 스크립트가 셸 판마다 다른 plist 를 쓴다).
xml_escape() {
    printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\\&apos;/g"
}

colima_agent_path() { # $1=colima 경로 $2=docker CLI 디렉터리 → LaunchAgent 의 PATH
    local bin path
    bin="$(dirname "$1")"; path="$bin"
    [[ -z "${2:-}" || "$2" == "$bin" ]] || path="$path:$2"
    printf '%s' "$path:/usr/bin:/bin:/usr/sbin:/sbin"
}

# LaunchAgent 를 쓰는 곳은 이것 하나다 (설치기·mac-host-repair.sh 공용).
# 알려진 예전 에이전트에서 이어받는 설정은 선택 인자다: [$5=stderr 파일(기본 $3)] [$6=시작 플래그] [$7=HOME]
# — 없으면 출력은 기본 정의와 바이트까지 같다.
write_colima_agent() { # $1=plist $2=colima 경로 $3=로그 파일 $4=docker CLI 디렉터리 [$5 $6 $7]
    # colima 는 기동할 때 호스트의 docker CLI 를 찾는다 — launchd 는 셸 프로파일을 읽지 않으므로 PATH 에 직접 넣는다.
    local label profile colima home path log err guard flag_xml="" home_xml="" nl=$'\n'
    label="$(xml_escape "$COLIMA_AGENT")"; profile="$(xml_escape "$COLIMA_PROFILE")"; guard="$(xml_escape "$COLIMA_BOOT_GUARD")"
    colima="$(xml_escape "$2")"; home="$(xml_escape "$OPENMAKE_COLIMA_HOME")"; log="$(xml_escape "$3")"; err="$(xml_escape "${5:-$3}")"
    path="$(xml_escape "$(colima_agent_path "$2" "${4:-}")")"
    [[ -z "${6:-}" ]] || flag_xml="$nl        <string>$(xml_escape "$6")</string>"
    [[ -z "${7:-}" ]] || home_xml="$nl        <key>HOME</key>$nl        <string>$(xml_escape "$7")</string>"
    mkdir -p "$(dirname "$1")" "$(dirname "$3")" "$(dirname "${5:-$3}")"
    cat > "$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$guard</string>
        <string>$colima</string>
        <string>$profile</string>$flag_xml
    </array>
    <key>EnvironmentVariables</key>
    <dict>$home_xml
        <key>COLIMA_HOME</key>
        <string>$home</string>
        <key>PATH</key>
        <string>$path</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$log</string>
    <key>StandardErrorPath</key>
    <string>$err</string>
</dict>
</plist>
EOF
}

# 로그인 시 전용 프로필을 띄운다 — 재부팅 후 DB·Redis·SearXNG 복구에 필요.
# (brew services 는 기본 프로필만 띄운다.) 컨테이너는 restart 정책으로 VM 과 함께 올라온다.
colima_gui_domain() { printf 'gui/%s' "$(id -u)"; }
colima_gui_domain_available() { launchctl print "$(colima_gui_domain)" >/dev/null 2>&1; }
colima_agent_registered() { launchctl print "$(colima_gui_domain)/$COLIMA_AGENT" >/dev/null 2>&1; }

# `launchctl print` 에서 비교할 부분만 정해진 순서로: 파일·실행 파일·인자(순서 그대로)·로그·환경(정렬, launchd 가 넣는 키 제외)
colima_agent_print_canonical() {
    sed 's/^[[:space:]]*//' | awk '
        block == "args" { if ($0 == "}") block = ""; else args = args "arg=" $0 "\n"; next }
        block == "env" {
            if ($0 == "}") { block = ""; next }
            if ($0 !~ /^(XPC_SERVICE_NAME|OSLogRateLimit) => /) env[++n] = "env=" $0
            next
        }
        $0 == "arguments = {" { block = "args"; next }
        $0 == "environment = {" { block = "env"; next }
        /^path = / && path == "" { path = $0; next }
        /^program = / && program == "" { program = $0; next }
        /^stdout path = / { out = $0; next }
        /^stderr path = / { err = $0; next }
        END {
            for (i = 2; i <= n; i++) { v = env[i]; for (j = i - 1; j >= 1 && env[j] > v; j--) env[j + 1] = env[j]; env[j + 1] = v }
            printf "%s\n%s\n%s%s\n%s\n", path, program, args, out, err
            for (i = 1; i <= n; i++) print env[i]
        }'
}

colima_agent_expected_print() { # $1=colima 경로 $2=docker CLI 디렉터리 $3=로그 파일 [$4=stderr $5=시작 플래그 $6=HOME]
    printf '%s\n' "path = $COLIMA_AGENT_PLIST" "program = /bin/bash" "arg=/bin/bash" "arg=$COLIMA_BOOT_GUARD" "arg=$1" "arg=$COLIMA_PROFILE"
    [[ -z "${5:-}" ]] || printf '%s\n' "arg=$5"
    printf '%s\n' "stdout path = $3" "stderr path = ${4:-$3}" "env=COLIMA_HOME => $OPENMAKE_COLIMA_HOME"
    [[ -z "${6:-}" ]] || printf '%s\n' "env=HOME => $6"
    printf '%s\n' "env=PATH => $(colima_agent_path "$1" "$2")"
}

# 등록 여부만이 아니라 launchd 가 실제로 들고 있는 정의(파일·실행 파일·인자·환경·로그)가 이 계약과 같은지 본다.
# (plist 가 있음 ≠ 등록됨 ≠ 재부팅 후 실제 기동 — 마지막은 재부팅해야만 증명된다.)
colima_agent_loaded_matches() { # $1=colima 경로 $2=docker CLI 디렉터리 $3=로그 파일 [$4=stderr $5=시작 플래그 $6=HOME]
    local out
    out="$(launchctl print "$(colima_gui_domain)/$COLIMA_AGENT" 2>/dev/null)" || return 1
    [[ "$(printf '%s\n' "$out" | colima_agent_print_canonical)" == "$(colima_agent_expected_print "$1" "$2" "$3" "${4:-}" "${5:-}" "${6:-}")" ]]
}

# 같은 정의가 이미 로드돼 있으면 건드리지 않는다 — bootout 은 정의가 바뀌었거나 로드된 것이 다를 때만.
# 이전 정의는 LaunchAgents 밖에 백업한다 (그 폴더의 파일은 launchd 가 같은 라벨로 읽을 수 있다).
# 생성·검사·백업·설치가 모두 성공해야 등록을 바꾼다 — 하나라도 실패하면 정의·등록을 그대로 두고 1 을 돌려준다.
# GUI 세션이 없으면(SSH 전용) 정의만 두고 등록 보류를 알린다 — sudo·system 도메인으로 우회하지 않는다.
enable_docker_autostart() { # [$1=로그 파일] [$2=stderr 파일 $3=시작 플래그 $4=HOME — 알려진 예전 에이전트에서 이어받은 값]
    local domain tmp backup colima docker_dir log err="${2:-}" flag="${3:-}" home="${4:-}"
    domain="$(colima_gui_domain)"; colima="$(command -v colima)"; docker_dir="$(dirname "$(command -v docker)")"
    log="${1:-$OMK_ROOT/logs/colima.log}"
    # 정의가 가리킬 가드를 먼저 둔다 — 설치에 실패하면 정의·등록을 바꾸지 않는다.
    install_colima_boot_guard || return 1
    tmp="$(mktemp)" || return 1
    if ! write_colima_agent "$tmp" "$colima" "$log" "$docker_dir" "$err" "$flag" "$home" \
        || { command -v plutil >/dev/null 2>&1 && ! plutil -lint -s "$tmp" >/dev/null; }; then
        rm -f "$tmp"; log_warn "Colima LaunchAgent 정의를 만들지 못했습니다 — 정의·등록을 바꾸지 않았습니다."; return 1
    fi
    if [[ -f "$COLIMA_AGENT_PLIST" ]] && cmp -s "$tmp" "$COLIMA_AGENT_PLIST"; then
        rm -f "$tmp"
        if colima_agent_loaded_matches "$colima" "$docker_dir" "$log" "$err" "$flag" "$home"; then log_ok "Colima 자동 시작 등록 유지 ($COLIMA_AGENT)"; return 0; fi
    else
        if [[ -f "$COLIMA_AGENT_PLIST" ]]; then
            backup="$OMK_ROOT/backups/launchd/$COLIMA_AGENT.plist.before-colima-$(date +%Y%m%d%H%M%S)-$$"
            if ! { mkdir -p "$(dirname "$backup")" 2>/dev/null && (umask 077; cp "$COLIMA_AGENT_PLIST" "$backup"); }; then
                rm -f "$tmp"; log_warn "이전 정의 백업 실패 ($backup) — 정의·등록을 바꾸지 않았습니다."; return 1
            fi
            log_info "이전 정의 백업: $backup"
        fi
        if ! { mkdir -p "$(dirname "$COLIMA_AGENT_PLIST")" && chmod 644 "$tmp" && mv "$tmp" "$COLIMA_AGENT_PLIST"; }; then
            rm -f "$tmp"; log_warn "$COLIMA_AGENT_PLIST 을 쓰지 못했습니다 — 등록을 바꾸지 않았습니다."; return 1
        fi
    fi
    if ! colima_gui_domain_available; then
        log_warn "Colima 자동 시작 등록 보류 — $domain 세션이 없습니다 (SSH 전용). 정의는 $COLIMA_AGENT_PLIST 에 있고 다음 GUI 로그인 때 읽힙니다."
        add_todo "Colima 자동 시작 등록: GUI 로그인 세션에서 launchctl bootstrap $domain $COLIMA_AGENT_PLIST"
        return 0
    fi
    if colima_agent_registered; then
        launchctl bootout "$domain/$COLIMA_AGENT" 2>/dev/null || true
    fi
    # RunAtLoad — 등록하면 곧바로 기존 프로필을 띄운다 (멈춰 있었다면 시작된다).
    if launchctl bootstrap "$domain" "$COLIMA_AGENT_PLIST" 2>/dev/null; then
        log_ok "Colima 로그인 시 자동 시작 ($COLIMA_AGENT) — 등록하면서 기존 프로필 $COLIMA_PROFILE 을 시작합니다"
    else
        log_warn "Colima 자동 시작 등록 실패"
        add_todo "Colima 자동 시작 등록: launchctl bootstrap $domain $COLIMA_AGENT_PLIST"
    fi
}

# Docker 설정·CLI PATH·자동 시작은 기존 서버와 같은 명령으로 맞춘다 — 설치가 Desktop 의존을 다시 만들지 않게.
# 오류(2: 자격 증명 충돌·잠긴 키체인·깨진 설정 등)는 설치를 멈춘다. 보류·수동 항목(1)은 할 일로 남긴다.
run_mac_host_repair() {
    local rc=0
    OMK_ROOT="$OMK_ROOT" COLIMA_HOME="$OPENMAKE_COLIMA_HOME" bash "$SCRIPT_DIR/scripts/setup/mac-host-repair.sh" --apply || rc=$?
    case $rc in
        0) return 0 ;;
        1) log_warn "Docker 호스트 정리에 남은 항목이 있습니다 (위 출력)."
           add_todo "Docker 호스트 정리 확인: bash $SCRIPT_DIR/scripts/setup/mac-host-repair.sh --check" ;;
        *) die "Docker 호스트 정리 실패 — 위 출력을 확인하세요. 설치를 중단했습니다 (바꾸기 전 설정은 보존됩니다)." ;;
    esac
}

check_docker_desktop_data() {
    local guard="$SCRIPT_DIR/scripts/setup/check-docker-desktop-data.sh" existing=0
    [[ ! -f "$(openmake_install_env)" ]] || existing=1
    PG_CONTAINER="$PG_CONTAINER" EXISTING_INSTALL="$existing" bash "$guard" \
        || die "기존 Docker 데이터 확인이 필요합니다 — Colima 설치를 중단했습니다. 원본 데이터는 변경하지 않았습니다."
}

ensure_docker() {
    log_step "Docker (Colima)"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — PostgreSQL/Redis 는 직접 운영 중이라고 가정합니다."
        return 0
    fi
    install_colima
    colima_start
    export DOCKER_HOST="unix://$COLIMA_SOCK"
    unset DOCKER_CONTEXT
    wait_docker_daemon
    check_docker_desktop_data
    run_mac_host_repair
    docker compose version >/dev/null 2>&1 || die "docker compose(v2)를 찾을 수 없습니다 — bash scripts/setup/mac-host-repair.sh --check 로 플러그인 설정을 확인하세요."
    log_ok "$(docker --version) / compose $(docker compose version --short 2>/dev/null) — Colima 프로필 $COLIMA_PROFILE"
}

# ── 포트 충돌 회피 ───────────────────────────────────────────────────────────
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_owned_by() { has docker && docker port "$1" 2>/dev/null | grep -q ":$2\$"; }
# 이 클론의 프로세스(작업 폴더가 클론 안)가 LISTEN 중인가 — 'omk dev up' 의 개발 서버는 PM2 가 아니다
port_owned_by_clone() { # $1=포트 $2=클론 경로(실제 경로)
    has lsof || return 1
    local pid cwd
    for pid in $(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null); do
        cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
        case "$cwd/" in "$2"/*) return 0 ;; esac
    done
    return 1
}

find_free_port() {
    local p
    for ((p = $1; p < $1 + 200; p++)); do
        port_in_use "$p" || { echo "$p"; return 0; }
    done
    return 1
}

# 재실행으로 .env 가 이미 있으면 바뀐 포트를 연결 URL 까지 함께 고친다.
update_env_port() { # $1=POSTGRES_PORT|REDIS_PORT $2=새 포트
    [[ -f "$ENV_FILE" ]] || return 0
    local tmp; tmp="$(mktemp)"
    if [[ "$1" == "POSTGRES_PORT" ]]; then
        sed -E "s|^POSTGRES_PORT=.*|POSTGRES_PORT=$2|; s|^(DATABASE_URL=.*@[^:/]+:)[0-9]+|\1$2|" "$ENV_FILE" > "$tmp"
    else
        sed -E "s|^REDIS_PORT=.*|REDIS_PORT=$2|; s|^(REDIS_URL=redis://[^:/]+:)[0-9]+|\1$2|" "$ENV_FILE" > "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

ensure_ports() {
    local v alt
    v="$(env_value POSTGRES_PORT)"; [[ -n "$v" ]] && PG_PORT="$v"
    v="$(env_value REDIS_PORT)";    [[ -n "$v" ]] && RD_PORT="$v"
    v="$(env_value PORT)";          [[ -n "$v" ]] && APP_PORT="$v"
    v="$(env_value OMK_WEB_PORT)";  [[ -n "$v" ]] && WEB_PORT="$v"

    if port_in_use "$APP_PORT" && ! pm2_has_app "$APP_NAME" && ! port_owned_by_clone "$APP_PORT" "$SCRIPT_DIR"; then
        alt="$(find_free_port $((APP_PORT + 1)))" || die "API 대체 포트 탐색 실패 — --port 로 지정하세요."
        log_warn "포트 $APP_PORT 사용 중 — API 를 $alt 로 옮깁니다."
        [[ -f "$ENV_FILE" ]] && set_env PORT "$alt"
        APP_PORT="$alt"
    fi
    if port_in_use "$WEB_PORT" && ! pm2_has_app "$FRONT_APP_NAME" && ! port_owned_by_clone "$WEB_PORT" "$SCRIPT_DIR"; then
        alt="$(find_free_port 13000)" || die "웹 대체 포트 탐색 실패 — --web-port 로 지정하세요."
        log_warn "포트 $WEB_PORT 사용 중 — 웹 UI 를 $alt 로 옮깁니다."
        [[ -f "$ENV_FILE" ]] && set_env OMK_WEB_PORT "$alt"
        WEB_PORT="$alt"
    fi
    [[ $SKIP_DOCKER -eq 1 ]] && return 0
    if port_in_use "$PG_PORT" && ! port_owned_by "$PG_CONTAINER" "$PG_PORT"; then
        alt="$(find_free_port 15432)" || die "PostgreSQL 대체 포트 탐색 실패 — --postgres-port 로 지정하세요."
        log_warn "포트 $PG_PORT 사용 중 — PostgreSQL 을 $alt 로 옮깁니다."
        PG_PORT="$alt"; update_env_port POSTGRES_PORT "$alt"
    fi
    if port_in_use "$RD_PORT" && ! port_owned_by "$RD_CONTAINER" "$RD_PORT"; then
        alt="$(find_free_port 16379)" || die "Redis 대체 포트 탐색 실패 — --redis-port 로 지정하세요."
        log_warn "포트 $RD_PORT 사용 중 — Redis 를 $alt 로 옮깁니다."
        RD_PORT="$alt"; update_env_port REDIS_PORT "$alt"
    fi
}
