# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — Node 24 · PM2 · Docker Desktop · 포트 충돌 회피
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

# ── Docker Desktop ───────────────────────────────────────────────────────────
DOCKER_COMPOSE="docker compose"
readonly DOCKER_APP="/Applications/Docker.app"
readonly DOCKER_SETTINGS="$HOME/Library/Group Containers/group.com.docker/settings-store.json"

# 공식 dmg 의 명령줄 설치 — --accept-license 로 약관 창을 없애고, root 로 실행해
# 권한 도우미·CLI 링크(/usr/local/bin)까지 한 번에 설정한다 (docs.docker.com 절차).
install_docker_desktop() {
    local dl_arch="arm64"
    [[ "$ARCH" == "x64" ]] && dl_arch="amd64"
    local url="https://desktop.docker.com/mac/main/$dl_arch/Docker.dmg"
    local dmg="$TOOLCHAIN_DIR/Docker.dmg"
    mkdir -p "$TOOLCHAIN_DIR"
    sudo_begin
    log_info "Docker Desktop 다운로드 (수백 MB): $url"
    curl -fL --progress-bar -o "$dmg" "$url" || die "Docker Desktop 다운로드 실패"
    sudo hdiutil attach "$dmg" -nobrowse -quiet || die "Docker.dmg 마운트 실패"
    sudo /Volumes/Docker/Docker.app/Contents/MacOS/install --accept-license --user="$USER" \
        || { sudo hdiutil detach /Volumes/Docker -quiet 2>/dev/null || true; die "Docker Desktop 설치 실패"; }
    sudo hdiutil detach /Volumes/Docker -quiet 2>/dev/null || true
    rm -f "$dmg"
    log_ok "Docker Desktop 설치 완료"
}

# docker CLI 가 PATH 에 없을 수 있는 설치 직후를 위해 알려진 위치를 올린다.
docker_path_fallback() {
    local d
    for d in /usr/local/bin "$HOME/.docker/bin" "$DOCKER_APP/Contents/Resources/bin"; do
        [[ -x "$d/docker" ]] && { export PATH="$PATH:$d"; persist_path "$d"; return 0; }
    done
    return 1
}

wait_docker_daemon() {
    docker info >/dev/null 2>&1 && return 0
    log_info "Docker Desktop 기동 — 첫 실행이면 화면의 권한·설정 창을 승인해 주세요."
    open -a Docker 2>/dev/null || true
    local i
    for ((i = 1; i <= 300; i++)); do
        docker info >/dev/null 2>&1 && { log_ok "Docker 데몬 준비 완료 (~$((i * 2))s)"; return 0; }
        (( i % 30 == 0 )) && log_info "Docker 데몬 대기 중… ($((i * 2))초) — Docker Desktop 창에 승인할 항목이 있는지 확인하세요."
        sleep 2
    done
    die "Docker 데몬이 10분 안에 준비되지 않았습니다 — Docker Desktop 을 직접 실행해 확인한 뒤 재실행하세요."
}

# 로그인 시 Docker Desktop 자동 시작 — 재부팅 후 DB·Redis·SearXNG 복구에 필요.
enable_docker_autostart() {
    [[ -f "$DOCKER_SETTINGS" ]] || return 0
    node -e '
        const fs = require("fs"); const p = process.argv[1];
        const s = JSON.parse(fs.readFileSync(p, "utf8"));
        if (s.AutoStart !== true) { s.AutoStart = true; fs.writeFileSync(p, JSON.stringify(s, null, 2)); }
    ' "$DOCKER_SETTINGS" 2>/dev/null && log_ok "Docker Desktop 로그인 시 자동 시작" \
        || log_warn "Docker Desktop 자동 시작 설정 실패 — Docker Desktop 설정 → General 에서 켜세요."
}

ensure_docker() {
    log_step "Docker Desktop"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — PostgreSQL/Redis 는 직접 운영 중이라고 가정합니다."
        return 0
    fi
    [[ -d "$DOCKER_APP" ]] || install_docker_desktop
    has docker || docker_path_fallback || die "docker CLI 를 찾을 수 없습니다 — 새 터미널에서 재실행하세요."
    wait_docker_daemon
    enable_docker_autostart
    docker compose version >/dev/null 2>&1 || die "docker compose(v2)를 찾을 수 없습니다."
    log_ok "$(docker --version) / compose $(docker compose version --short 2>/dev/null)"
}

# ── 포트 충돌 회피 ───────────────────────────────────────────────────────────
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_owned_by() { has docker && docker port "$1" 2>/dev/null | grep -q ":$2\$"; }

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

    if port_in_use "$APP_PORT" && ! pm2_has_app "$APP_NAME"; then
        alt="$(find_free_port $((APP_PORT + 1)))" || die "API 대체 포트 탐색 실패 — --port 로 지정하세요."
        log_warn "포트 $APP_PORT 사용 중 — API 를 $alt 로 옮깁니다."
        [[ -f "$ENV_FILE" ]] && set_env PORT "$alt"
        APP_PORT="$alt"
    fi
    if port_in_use "$WEB_PORT" && ! pm2_has_app "$FRONT_APP_NAME"; then
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
