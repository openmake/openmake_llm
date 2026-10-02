# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — Node 24 · PM2 · Docker(전용 Colima) · 포트 충돌 회피
# ==============================================================================

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

ensure_node() {
    log_step "Node.js $NODE_MAJOR"
    local bin
    bin="$(brew --prefix)/opt/node@$NODE_MAJOR/bin"
    [[ -x "$bin/node" ]] || die "node@$NODE_MAJOR 가 없습니다 (brew install node@$NODE_MAJOR)"
    # keg-only formula 라 PATH 에 직접 올린다 — PM2 가 기동 시점 PATH 의 node 를 쓴다.
    export PATH="$bin:$PATH"
    persist_path "$bin"
    [[ "$(node_major)" -eq $NODE_MAJOR ]] || die "node $(node -v) — package.json engines 는 >=$NODE_MAJOR <$((NODE_MAJOR + 1))"
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
# Docker Desktop 은 로그인·약관·업데이트 창에서 사람을 기다린다 — 재부팅 뒤 창 하나에 멈추면 DB 와
# 샌드박스가 같이 멈춘다. openmake 는 자기 Colima VM 에서만 돌고, 사용자의 기본 docker 컨텍스트
# (Docker Desktop 등)와 그 위의 컨테이너는 건드리지 않는다.
DOCKER_COMPOSE="docker compose"
readonly COLIMA_PROFILE="openmake"
# (COLIMA_HOME 은 colima 가 읽는 환경변수 이름이라 쓰지 않는다 — 사용자가 export 해 둔 값을 덮게 된다.)
readonly COLIMA_DIR="$HOME/.colima/$COLIMA_PROFILE"
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

# 이 호스트가 사용자의 기본 Docker 로 openmake 를 운영 중인가 — 그렇다면 옮기지 않는다(DB 가 그쪽에 있다).
# 판정은 호스트 단위다: 접속 규칙(소켓이 있으면 Colima)이 호스트 전체에 걸리므로, 환경 하나만 옮길 수 없다.
installed_on_other_docker() { # $1=대상 .env
    has docker || return 1
    if ( unset DOCKER_HOST; docker info >/dev/null 2>&1 ); then
        # 목록을 먼저 받는다 — 파이프로 잇면 grep -q 가 먼저 끝날 때 docker 가 SIGPIPE 로 죽고,
        # pipefail 아래에서는 "없음"으로 읽혀 운영 중인 호스트를 새 설치로 오판한다.
        local names
        names="$( unset DOCKER_HOST; docker ps -a --format '{{.Names}}' 2>/dev/null || true )"
        grep -qE '^openmake(-[a-z0-9-]+)?-postgres$' <<< "$names"
        return
    fi
    # 기본 Docker 가 꺼져 있어 볼 수 없다 — .env 가 있는데 Colima 를 가리키지 않으면 기존 설치본으로 본다.
    [[ -f "$1" ]] && ! grep -qE '^DOCKER_HOST=' "$1"
}

install_colima() {
    local missing="colima"
    brew list --formula colima >/dev/null 2>&1 && missing=""
    # docker CLI·플러그인은 없는 것만 — Docker Desktop 이 깔아 둔 CLI 가 있으면 그대로 쓴다.
    has docker || missing="$missing docker"
    docker compose version >/dev/null 2>&1 || missing="$missing docker-compose"
    docker buildx version >/dev/null 2>&1 || missing="$missing docker-buildx"
    [[ -z "${missing// /}" ]] && return 0
    log_info "설치:$missing"
    # 단어 분할이 의도다 — formula 이름 목록.
    # shellcheck disable=SC2086
    brew install $missing || die "brew install 실패:$missing — 직접 실행한 뒤 재시도하세요."
}

# brew 의 compose·buildx 는 docker 가 찾는 기본 위치에 없다 — 플러그인 디렉터리를 알려준다.
# Docker Desktop 과 같이 쓰는 파일이라 다른 키(currentContext·credsStore 등)는 건드리지 않는다.
docker_cli_plugins() { # $1=config.json $2=플러그인 디렉터리
    mkdir -p "$(dirname "$1")"
    node -e '
        const fs = require("fs"); const [p, dir] = process.argv.slice(1);
        let c = {};
        if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch { process.exit(3); } }
        const dirs = Array.isArray(c.cliPluginsExtraDirs) ? c.cliPluginsExtraDirs : [];
        if (dirs.includes(dir)) process.exit(0);
        c.cliPluginsExtraDirs = [...dirs, dir];
        fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
    ' "$1" "$2" 2>/dev/null \
        || log_warn "$1 을 읽을 수 없어 고치지 않았습니다 — \"cliPluginsExtraDirs\": [\"$2\"] 를 직접 넣으세요."
}

colima_start() {
    # colima 는 ~/.colima 가 있으면 그곳을, 없고 XDG_CONFIG_HOME 이 있으면 그 아래를 쓴다 — 접속 규칙의 소켓 경로와 맞춘다.
    mkdir -p "$HOME/.colima"
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

write_colima_agent() { # $1=plist $2=colima 경로 $3=로그 파일 $4=docker CLI 디렉터리
    # colima 는 기동할 때 호스트의 docker CLI 를 찾는다 — launchd 는 셸 프로파일을 읽지 않으므로 PATH 에 직접 넣는다.
    local bin path
    bin="$(dirname "$2")"; path="$bin"
    [[ -z "${4:-}" || "$4" == "$bin" ]] || path="$path:$4"
    mkdir -p "$(dirname "$1")" "$(dirname "$3")"
    cat > "$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$COLIMA_AGENT</string>
    <key>ProgramArguments</key>
    <array>
        <string>$2</string>
        <string>start</string>
        <string>--profile</string>
        <string>$COLIMA_PROFILE</string>
        <string>--activate=false</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$path:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$3</string>
    <key>StandardErrorPath</key>
    <string>$3</string>
</dict>
</plist>
EOF
}

# 로그인 시 전용 프로필을 띄운다 — 재부팅 후 DB·Redis·SearXNG 복구에 필요.
# (brew services 는 기본 프로필만 띄운다.) 컨테이너는 restart 정책으로 VM 과 함께 올라온다.
enable_docker_autostart() {
    local domain; domain="gui/$(id -u)"
    write_colima_agent "$COLIMA_AGENT_PLIST" "$(command -v colima)" "$OMK_ROOT/logs/colima.log" "$(dirname "$(command -v docker)")"
    launchctl bootout "$domain/$COLIMA_AGENT" 2>/dev/null || true
    if launchctl bootstrap "$domain" "$COLIMA_AGENT_PLIST" 2>/dev/null; then
        log_ok "Colima 로그인 시 자동 시작 ($COLIMA_AGENT)"
    else
        log_warn "Colima 자동 시작 등록 실패"
        add_todo "Colima 자동 시작 등록: launchctl bootstrap $domain $COLIMA_AGENT_PLIST"
    fi
}

# 판정에 쓸 .env — 전체 설치는 omk 가 만들 환경 디렉터리, --minimal 은 이 클론.
docker_target_env_file() {
    if [[ $MINIMAL -eq 1 ]]; then printf '%s' "$ENV_FILE"; else printf '%s/%s/llm/.env' "$OMK_ROOT" "$(omk_env_name)"; fi
}

ensure_docker() {
    log_step "Docker (Colima)"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — PostgreSQL/Redis 는 직접 운영 중이라고 가정합니다."
        return 0
    fi
    if ! colima_profile_exists && installed_on_other_docker "$(docker_target_env_file)"; then
        # 이미 기본 Docker 로 운영 중인 호스트 — DB 가 그쪽에 있다. 설치기가 옮기지 않는다.
        docker info >/dev/null 2>&1 \
            || die "이 호스트의 openmake 는 기본 Docker 에서 운영 중인데 Docker 가 응답하지 않습니다 — Docker 를 켠 뒤 재실행하세요."
        docker compose version >/dev/null 2>&1 || die "docker compose(v2)를 찾을 수 없습니다."
        log_warn "기존 설치본 — 기본 Docker 를 계속 씁니다 ($(docker --version))"
        add_todo "전용 Colima 로 옮기려면 scripts/env/README.md 의 'Docker Desktop 에서 옮기기' 절차를 따르세요"
        return 0
    fi
    install_colima
    docker_cli_plugins "$HOME/.docker/config.json" "$(brew --prefix)/lib/docker/cli-plugins"
    colima_start
    export DOCKER_HOST="unix://$COLIMA_SOCK"
    wait_docker_daemon
    enable_docker_autostart
    docker compose version >/dev/null 2>&1 || die "docker compose(v2)를 찾을 수 없습니다."
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
