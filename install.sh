#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 원샷 설치 스크립트 (Linux / macOS)
# ==============================================================================
# 클론 직후 이 스크립트 하나만 실행하면 바로 쓸 수 있는 상태까지 만든다:
#
#   toolchain 점검(Node 24 / Docker / PM2) → .env 생성 → 의존성 설치
#   → PostgreSQL·Redis 기동 → DB 마이그레이션 → 빌드 → PM2 기동 → health check
#
# 사용:
#   ./install.sh                     # 대화형 (LLM 엔드포인트를 물어봄)
#   ./install.sh --yes               # 비대화형 (기본값으로 진행, 프롬프트 없음)
#   ./install.sh --llm-base-url https://openrouter.ai/api/v1 \
#                --llm-api-key sk-or-... --llm-model qwen/qwen3-235b-a22b --yes
#
# 주요 옵션 (--help 로 전체 확인):
#   --yes, -y            모든 확인을 자동 승인 (비대화형)
#   --skip-docker        PostgreSQL/Redis 를 직접 운영 중일 때 (compose 건너뜀)
#   --skip-build         빌드 산출물이 이미 있을 때
#   --no-start           설치만 하고 PM2 기동은 하지 않음
#   --force-env          기존 .env 를 백업하고 새로 생성
#
# 재실행 안전(idempotent): 이미 된 단계는 건너뛰거나 갱신만 한다.
#
# 종료 코드:
#   0 성공 / 1 사용법·전제조건 오류 / 2 설치 단계 실패 / 3 health check 실패
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
readonly SCRIPT_DIR
readonly NODE_MAJOR_MIN=24
readonly NODE_PINNED_VERSION="24.16.0"   # mise.toml / .node-version 과 동일
readonly TOOLCHAIN_DIR="$SCRIPT_DIR/.openmake"
readonly TOOLCHAIN_ENV="$TOOLCHAIN_DIR/toolchain.env"
readonly HEALTH_RETRIES=45
readonly HEALTH_INTERVAL=2

APP_PORT="${OMK_PORT:-52416}"
WEB_PORT="${OMK_WEB_PORT:-3000}"
PG_PORT="${OMK_POSTGRES_PORT:-5432}"
RD_PORT="${OMK_REDIS_PORT:-6379}"

ASSUME_YES=0
SKIP_DOCKER=0
SKIP_BUILD=0
NO_START=0
FORCE_ENV=0
LLM_BASE_URL=""
LLM_API_KEY=""
LLM_MODEL=""

# ── 출력 ─────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_INFO=$'\033[1;34m'; C_OK=$'\033[1;32m'
    C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_DIM=$'\033[2m'
else
    C_RESET=""; C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""
fi

log_info() { printf "%s[INFO]%s  %s\n" "$C_INFO" "$C_RESET" "$*"; }
log_ok()   { printf "%s[OK]%s    %s\n" "$C_OK"   "$C_RESET" "$*"; }
log_warn() { printf "%s[WARN]%s  %s\n" "$C_WARN" "$C_RESET" "$*"; }
log_err()  { printf "%s[ERR]%s   %s\n" "$C_ERR"  "$C_RESET" "$*" >&2; }
log_step() { printf "\n%s━━ %s ━━%s\n" "$C_INFO" "$*" "$C_RESET"; }

die() { log_err "$*"; exit 2; }

# y/N 확인. --yes 또는 비대화형(파이프 실행)이면 자동 승인.
confirm() {
    local prompt="$1"
    if [[ $ASSUME_YES -eq 1 ]] || [[ ! -t 0 ]]; then
        log_info "$prompt → 자동 승인"
        return 0
    fi
    local reply=""
    read -r -p "$(printf '%s%s%s [y/N]: ' "$C_WARN" "$prompt" "$C_RESET")" reply || true
    case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

has() { command -v "$1" >/dev/null 2>&1; }

usage() {
    # 파일 상단 주석 블록(셔뱅 다음 ~ 첫 비주석 줄 전)을 그대로 사용법으로 출력한다.
    # 헤더를 고쳐도 --help 가 자동으로 따라오도록 줄 번호를 하드코딩하지 않는다.
    sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -y|--yes)        ASSUME_YES=1 ;;
            --skip-docker)   SKIP_DOCKER=1 ;;
            --skip-build)    SKIP_BUILD=1 ;;
            --no-start)      NO_START=1 ;;
            --force-env)     FORCE_ENV=1 ;;
            --llm-base-url)  LLM_BASE_URL="${2:-}"; shift ;;
            --llm-api-key)   LLM_API_KEY="${2:-}"; shift ;;
            --llm-model)     LLM_MODEL="${2:-}"; shift ;;
            --port)          APP_PORT="${2:-}"; shift ;;
            --web-port)      WEB_PORT="${2:-}"; shift ;;
            -h|--help)       usage; exit 0 ;;
            *) log_err "알 수 없는 옵션: $1"; echo ""; usage; exit 1 ;;
        esac
        shift
    done
}

# ── 플랫폼 감지 ──────────────────────────────────────────────────────────────
OS=""          # linux | macos
ARCH=""        # x64 | arm64
PKG=""         # brew | apt | dnf | yum | pacman | zypper | ""

detect_platform() {
    case "$(uname -s)" in
        Darwin) OS="macos" ;;
        Linux)  OS="linux" ;;
        *) log_err "지원하지 않는 OS: $(uname -s) (Linux / macOS 만 지원)"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)  ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) log_err "지원하지 않는 아키텍처: $(uname -m)"; exit 1 ;;
    esac

    if   has brew;    then PKG="brew"
    elif has apt-get; then PKG="apt"
    elif has dnf;     then PKG="dnf"
    elif has yum;     then PKG="yum"
    elif has pacman;  then PKG="pacman"
    elif has zypper;  then PKG="zypper"
    fi

    log_ok "플랫폼: $OS/$ARCH${PKG:+ (패키지 관리자: $PKG)}"
}

# 설치 중에만 유효한 PATH 를 파일로 남겨 openmake_llm.sh 가 이어받게 한다.
persist_path() {
    local dir="$1"
    mkdir -p "$TOOLCHAIN_DIR"
    if [[ -f "$TOOLCHAIN_ENV" ]] && grep -qF "$dir" "$TOOLCHAIN_ENV" 2>/dev/null; then
        return 0
    fi
    {
        [[ -f "$TOOLCHAIN_ENV" ]] || echo "# install.sh 가 생성 — openmake_llm.sh 가 자동으로 source 한다."
        echo "export PATH=\"$dir:\$PATH\""
    } >> "$TOOLCHAIN_ENV"
    log_info "PATH 등록 → .openmake/toolchain.env ($dir)"
}

# ── 1. Node.js ───────────────────────────────────────────────────────────────
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# 버전 관리자(mise/fnm/nvm/asdf)가 있으면 그것으로 Node 24 를 활성화한다.
try_node_version_manager() {
    if has mise; then
        log_info "mise 로 Node $NODE_PINNED_VERSION 설치 시도 (mise.toml 핀)"
        if mise install node@"$NODE_PINNED_VERSION" >/dev/null 2>&1; then
            local bin
            bin="$(mise where node@"$NODE_PINNED_VERSION" 2>/dev/null)/bin"
            if [[ -x "$bin/node" ]]; then
                export PATH="$bin:$PATH"; persist_path "$bin"; return 0
            fi
        fi
    fi
    if has fnm; then
        log_info "fnm 로 Node $NODE_PINNED_VERSION 설치 시도"
        if fnm install "$NODE_PINNED_VERSION" >/dev/null 2>&1; then
            eval "$(fnm env --shell bash 2>/dev/null)" || true
            fnm use "$NODE_PINNED_VERSION" >/dev/null 2>&1 || true
            [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]] && return 0
        fi
    fi
    # nvm 은 함수라 command -v 로 안 잡힌다 — 스크립트를 직접 source.
    local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if [[ -s "$nvm_sh" ]]; then
        log_info "nvm 으로 Node $NODE_PINNED_VERSION 설치 시도"
        # nvm.sh 는 set -u 환경에서 미정의 변수를 건드리므로 잠시 해제한다.
        set +u; . "$nvm_sh"; nvm install "$NODE_PINNED_VERSION" >/dev/null 2>&1 || true
        nvm use "$NODE_PINNED_VERSION" >/dev/null 2>&1 || true; set -u
        if [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]]; then
            persist_path "$(dirname "$(command -v node)")"; return 0
        fi
    fi
    return 1
}

# 마지막 수단: nodejs.org 공식 tarball 을 홈 디렉터리에 푼다 (sudo 불필요).
install_node_tarball() {
    local plat="linux-$ARCH"
    [[ "$OS" == "macos" ]] && plat="darwin-$ARCH"
    local url="https://nodejs.org/dist/v$NODE_PINNED_VERSION/node-v$NODE_PINNED_VERSION-$plat.tar.gz"
    local dest="$HOME/.openmake/node"

    if [[ -x "$dest/bin/node" ]]; then
        export PATH="$dest/bin:$PATH"; persist_path "$dest/bin"
        [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]] && return 0
    fi

    has curl || die "curl 이 필요합니다 (Node 자동 설치용). 패키지 관리자로 curl 을 먼저 설치하세요."
    log_info "Node $NODE_PINNED_VERSION 다운로드: $url"
    rm -rf "$dest"; mkdir -p "$dest"
    # --strip-components=1 로 node-v24.x-plat/ 껍데기를 벗긴다.
    if ! curl -fsSL "$url" | tar -xz -C "$dest" --strip-components=1; then
        die "Node 다운로드/압축해제 실패 — 네트워크를 확인하거나 Node 24 를 직접 설치한 뒤 재실행하세요."
    fi
    export PATH="$dest/bin:$PATH"; persist_path "$dest/bin"
    [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]] || die "Node 설치 후에도 버전 확인 실패"
}

ensure_node() {
    log_step "1/8 Node.js"

    # 이미 등록된 toolchain PATH 가 있으면 먼저 반영 (재실행 시나리오).
    # shellcheck source=/dev/null
    [[ -f "$TOOLCHAIN_ENV" ]] && . "$TOOLCHAIN_ENV"

    if has node && [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]]; then
        log_ok "node $(node -v) / npm $(npm -v 2>/dev/null || echo '?')"
        if [[ "$(node_major)" -gt $NODE_MAJOR_MIN ]]; then
            log_warn "package.json engines 는 node >=24 <25 를 명시합니다 (현재 $(node -v))."
            log_warn "설치는 계속되지만 .npmrc 에 engine-strict=true 가 있으면 실패합니다."
        fi
        return 0
    fi

    if has node; then
        log_warn "node $(node -v) 는 최소 요구 버전(v$NODE_MAJOR_MIN)보다 낮습니다 — Node 24 를 준비합니다."
    else
        log_warn "node 미설치 — Node $NODE_PINNED_VERSION 을 준비합니다."
    fi

    if try_node_version_manager && [[ "$(node_major)" -ge $NODE_MAJOR_MIN ]]; then
        log_ok "node $(node -v) 활성화"
        return 0
    fi

    if [[ "$PKG" == "brew" ]] && confirm "brew 로 node@24 를 설치할까요?"; then
        brew install node@24 || true
        local brew_bin
        brew_bin="$(brew --prefix)/opt/node@24/bin"
        if [[ -x "$brew_bin/node" ]]; then
            export PATH="$brew_bin:$PATH"; persist_path "$brew_bin"
            log_ok "node $(node -v) 활성화"; return 0
        fi
    fi

    install_node_tarball
    log_ok "node $(node -v) 준비 완료 (~/.openmake/node)"
}

# ── 2. Docker ────────────────────────────────────────────────────────────────
DOCKER_COMPOSE=""   # "docker compose" 또는 "docker-compose"

detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker compose"
    elif has docker-compose; then
        DOCKER_COMPOSE="docker-compose"
        log_warn "compose v1(docker-compose) 사용 — v2(docker compose) 업그레이드를 권장합니다."
    else
        return 1
    fi
}

install_docker() {
    if [[ "$OS" == "macos" ]]; then
        log_err "Docker 가 없습니다. macOS 는 Docker Desktop 또는 OrbStack 이 필요합니다."
        if [[ "$PKG" == "brew" ]] && confirm "brew 로 Docker Desktop 을 설치할까요? (설치 후 앱을 한 번 실행해야 합니다)"; then
            brew install --cask docker || die "Docker Desktop 설치 실패"
            log_info "Docker.app 실행 중 — 최초 실행은 권한 승인이 필요할 수 있습니다."
            open -a Docker || true
            return 0
        fi
        echo "  설치: https://www.docker.com/products/docker-desktop/  또는  brew install --cask docker"
        exit 2
    fi

    log_err "Docker 가 없습니다."
    if confirm "공식 스크립트로 Docker 를 설치할까요? (sudo 필요: curl -fsSL https://get.docker.com | sudo sh)"; then
        has curl || die "curl 이 필요합니다."
        curl -fsSL https://get.docker.com -o "$TOOLCHAIN_DIR/get-docker.sh" || die "Docker 설치 스크립트 다운로드 실패"
        sudo sh "$TOOLCHAIN_DIR/get-docker.sh" || die "Docker 설치 실패"
        sudo systemctl enable --now docker 2>/dev/null || true
        # 현재 셸은 아직 docker 그룹이 아니므로 이번 실행에서는 sudo 가 필요할 수 있다.
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        log_warn "docker 그룹 반영에는 재로그인이 필요합니다. 이번 실행에서 권한 오류가 나면 다시 로그인 후 재실행하세요."
        return 0
    fi
    echo "  설치 안내: https://docs.docker.com/engine/install/"
    exit 2
}

ensure_docker_daemon() {
    if docker info >/dev/null 2>&1; then return 0; fi

    log_warn "Docker 데몬이 응답하지 않습니다 — 기동을 시도합니다."
    if [[ "$OS" == "macos" ]]; then
        open -a Docker 2>/dev/null || open -a OrbStack 2>/dev/null || true
    else
        sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
    fi

    local i
    for ((i = 1; i <= 30; i++)); do
        docker info >/dev/null 2>&1 && { log_ok "Docker 데몬 준비 완료 (~$((i * 2))s)"; return 0; }
        sleep 2
    done
    die "Docker 데몬 기동 실패 — Docker 를 직접 실행한 뒤 재시도하세요 (linux: sudo systemctl start docker)."
}

ensure_docker() {
    log_step "2/8 Docker"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — PostgreSQL/Redis 는 직접 운영 중이라고 가정합니다."
        return 0
    fi
    has docker || install_docker
    has docker || die "docker 명령을 찾을 수 없습니다. 새 셸에서 재실행하세요."
    ensure_docker_daemon
    detect_compose || die "docker compose 를 찾을 수 없습니다 (Docker Compose v2 필요)."
    log_ok "$(docker --version) / $($DOCKER_COMPOSE version --short 2>/dev/null || echo compose)"
}

# ── 3. PM2 ───────────────────────────────────────────────────────────────────
PM2_BIN=""

ensure_pm2() {
    log_step "3/8 PM2"
    if has pm2; then
        PM2_BIN="pm2"; log_ok "pm2 $(pm2 -v 2>/dev/null)"; return 0
    fi

    log_info "pm2 전역 설치 시도 (npm i -g pm2)"
    if npm install -g pm2 >/dev/null 2>&1 && has pm2; then
        PM2_BIN="pm2"; log_ok "pm2 $(pm2 -v) 설치 완료"; return 0
    fi

    # 전역 prefix 에 쓰기 권한이 없는 환경(시스템 Node 등) — 홈 아래로 우회 설치.
    log_warn "전역 설치 실패 — 홈 디렉터리에 설치합니다 (~/.openmake/npm-global)"
    local prefix="$HOME/.openmake/npm-global"
    mkdir -p "$prefix"
    npm install -g --prefix "$prefix" pm2 >/dev/null 2>&1 \
        || die "pm2 설치 실패 — 'npm i -g pm2' 를 직접 실행한 뒤 재시도하세요."
    export PATH="$prefix/bin:$PATH"; persist_path "$prefix/bin"
    has pm2 || die "pm2 설치 후에도 실행 파일을 찾을 수 없습니다."
    PM2_BIN="pm2"
    log_ok "pm2 $(pm2 -v) 설치 완료 (홈 디렉터리)"
}

# ── 4. .env ──────────────────────────────────────────────────────────────────
# 대화형으로 LLM 엔드포인트를 고른다. --llm-* 플래그가 있으면 건너뛴다.
prompt_llm() {
    [[ -n "$LLM_BASE_URL" ]] && return 0
    if [[ $ASSUME_YES -eq 1 ]] || [[ ! -t 0 ]]; then
        log_warn "LLM 엔드포인트 미지정 — 자리표시자(http://localhost:4000)로 설정합니다."
        log_warn "채팅을 쓰려면 나중에 .env 의 LLM_BASE_URL / LLM_API_KEY / LLM_DEFAULT_MODEL 을 채우세요."
        return 0
    fi

    echo ""
    echo "  OpenMake 는 OpenAI 호환 엔드포인트 하나가 필요합니다. 어디에 연결할까요?"
    echo "    1) Ollama (로컬)          http://localhost:11434/v1"
    echo "    2) OpenRouter            https://openrouter.ai/api/v1  (API 키 필요)"
    echo "    3) 직접 입력             LiteLLM/vLLM 등 OpenAI 호환 주소"
    echo "    4) 나중에 설정           지금은 자리표시자만 채움"
    local choice=""
    read -r -p "  선택 [1-4] (기본 4): " choice || true
    case "${choice:-4}" in
        1)
            LLM_BASE_URL="http://localhost:11434/v1"
            LLM_API_KEY="ollama"
            read -r -p "  모델 ID (기본 qwen3:8b): " LLM_MODEL || true
            LLM_MODEL="${LLM_MODEL:-qwen3:8b}"
            has ollama || log_warn "ollama 가 설치되어 있지 않습니다 — https://ollama.com 에서 설치 후 'ollama pull $LLM_MODEL'"
            ;;
        2)
            LLM_BASE_URL="https://openrouter.ai/api/v1"
            read -r -p "  OpenRouter API 키: " LLM_API_KEY || true
            read -r -p "  모델 ID (기본 qwen/qwen3-235b-a22b): " LLM_MODEL || true
            LLM_MODEL="${LLM_MODEL:-qwen/qwen3-235b-a22b}"
            ;;
        3)
            read -r -p "  Base URL (예: http://localhost:4000): " LLM_BASE_URL || true
            read -r -p "  API 키 (없으면 엔터): " LLM_API_KEY || true
            read -r -p "  모델 ID: " LLM_MODEL || true
            ;;
        *)
            log_info "LLM 설정을 건너뜁니다 — .env 에서 나중에 채우세요."
            ;;
    esac
    echo ""
}

setup_env() {
    log_step "4/8 .env 설정"
    prompt_llm

    # 서브셸에서 export — 빈 LLM_* 는 내보내지 않아야 gen-env.mjs 의 기본값이 살아난다.
    (
        export OMK_PORT="$APP_PORT"
        export OMK_WEB_PORT="$WEB_PORT"
        export OMK_POSTGRES_PORT="$PG_PORT"
        export OMK_REDIS_PORT="$RD_PORT"
        [[ -n "$LLM_BASE_URL" ]] && export OMK_LLM_BASE_URL="$LLM_BASE_URL"
        [[ -n "$LLM_API_KEY"  ]] && export OMK_LLM_API_KEY="$LLM_API_KEY"
        [[ -n "$LLM_MODEL"    ]] && export OMK_LLM_MODEL="$LLM_MODEL"
        if [[ $FORCE_ENV -eq 1 ]]; then
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" --force >/dev/null
        else
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" >/dev/null
        fi
    ) || die ".env 생성 실패"

    log_ok ".env 준비 완료"
}

# .env 에서 키 하나를 읽는다 (source 하지 않는다 — 값에 공백/특수문자가 있어도 안전).
# `|| true`: 키가 없으면 grep 이 1 을 반환하고 pipefail+set -e 가 스크립트를 죽인다.
env_value() {
    local key="$1"
    [[ -f "$SCRIPT_DIR/.env" ]] || return 0
    grep -E "^${key}=" "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# ── 5. 의존성 설치 ───────────────────────────────────────────────────────────
install_deps() {
    log_step "5/8 npm 의존성 설치 (workspaces)"
    ( cd "$SCRIPT_DIR" && npm install --no-audit --no-fund ) || die "npm install 실패"
    log_ok "의존성 설치 완료"
}

# ── 6. 인프라 기동 + 마이그레이션 ────────────────────────────────────────────
compose_up() {
    log_step "6/8 PostgreSQL / Redis"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — 컨테이너 기동을 건너뜁니다."
        return 0
    fi

    # compose 파일이 infra/ 에 있으므로 project directory 도 infra/ 가 된다.
    # → 루트 .env 를 --env-file 로 명시하지 않으면 POSTGRES_PASSWORD 가 비어 기동이 실패한다.
    $DOCKER_COMPOSE --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/infra/docker-compose.yml" \
        up -d postgres redis || die "PostgreSQL/Redis 기동 실패"

    log_info "PostgreSQL 준비 대기"
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
        if docker exec openmake-postgres pg_isready -U "$(env_value POSTGRES_USER)" \
             -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
            log_ok "PostgreSQL 준비 완료 (~$((i * HEALTH_INTERVAL))s)"
            break
        fi
        [[ $i -eq $HEALTH_RETRIES ]] && die "PostgreSQL 기동 실패 — docker logs openmake-postgres 확인"
        sleep "$HEALTH_INTERVAL"
    done

    docker exec openmake-redis redis-cli ping >/dev/null 2>&1 \
        && log_ok "Redis 준비 완료" \
        || log_warn "Redis ping 실패 — docker logs openmake-redis 확인"
}

run_migrations() {
    log_step "7/8 DB 마이그레이션"
    ( cd "$SCRIPT_DIR/apps/api" && npx ts-node src/data/migrations/cli.ts migrate ) \
        || die "마이그레이션 실패 — DATABASE_URL 과 POSTGRES_PASSWORD 가 일치하는지 확인하세요."
    log_ok "마이그레이션 완료"
}

# ── 7. 빌드 + 기동 ───────────────────────────────────────────────────────────
build_app() {
    log_step "8/8 빌드 & 기동"
    if [[ $SKIP_BUILD -eq 1 ]]; then
        log_info "--skip-build — 빌드를 건너뜁니다."
        return 0
    fi
    log_info "npm run build (백엔드 tsc + 프론트 Next.js) — 수 분 걸릴 수 있습니다"
    ( cd "$SCRIPT_DIR" && npm run build ) || die "빌드 실패"
    log_ok "빌드 완료"
}

start_app() {
    if [[ $NO_START -eq 1 ]]; then
        log_info "--no-start — PM2 기동을 건너뜁니다. './openmake_llm.sh start' 로 직접 기동하세요."
        return 0
    fi

    log_info "PM2 기동 (ecosystem.config.js)"
    ( cd "$SCRIPT_DIR" && "$PM2_BIN" start ecosystem.config.js --update-env ) || die "PM2 기동 실패"

    log_info "health check 대기 (최대 $((HEALTH_RETRIES * HEALTH_INTERVAL))s)"
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
        if curl -fsS --max-time 3 "http://localhost:$APP_PORT/health" >/dev/null 2>&1; then
            log_ok "API health check 성공 (~$((i * HEALTH_INTERVAL))s)"
            return 0
        fi
        sleep "$HEALTH_INTERVAL"
    done

    log_err "health check 실패 — 최근 로그 50줄:"
    "$PM2_BIN" logs openmake-llm --lines 50 --nostream 2>/dev/null || true
    exit 3
}

# ── 마무리 안내 ──────────────────────────────────────────────────────────────
summary() {
    local admin_user admin_pass admin_email llm_url
    admin_user="$(env_value ADMIN_INITIAL_USERNAME)"
    admin_pass="$(env_value ADMIN_PASSWORD)"
    admin_email="$(env_value DEFAULT_ADMIN_EMAIL)"
    llm_url="$(env_value LLM_BASE_URL)"

    printf "\n%s══════════════════════════════════════════════════════%s\n" "$C_OK" "$C_RESET"
    printf "%s  OpenMake LLM 설치 완료%s\n" "$C_OK" "$C_RESET"
    printf "%s══════════════════════════════════════════════════════%s\n\n" "$C_OK" "$C_RESET"

    echo "  웹 UI     http://localhost:$WEB_PORT"
    echo "  API       http://localhost:$APP_PORT   (health: /health)"
    echo ""
    echo "  로그인    ${admin_email:-admin@openmake.local}  (또는 사용자명 ${admin_user:-admin})"
    echo "  비밀번호  ${admin_pass:-<.env 의 ADMIN_PASSWORD 참조>}"
    printf "  %s첫 로그인 후 비밀번호를 바꾸세요. 비밀번호는 .env 에 평문으로 저장됩니다.%s\n" "$C_DIM" "$C_RESET"
    echo ""
    echo "  자주 쓰는 명령"
    echo "    ./openmake_llm.sh status     상태 확인"
    echo "    ./openmake_llm.sh logs       실시간 로그"
    echo "    ./openmake_llm.sh stop       전체 정지"
    echo "    ./openmake_llm.sh deploy     코드 변경 반영 (build + migrate + restart)"
    echo ""

    if [[ "$llm_url" == "http://localhost:4000" ]]; then
        printf "  %s[할 일]%s LLM 엔드포인트가 아직 자리표시자입니다 — 채팅이 동작하지 않습니다.\n" "$C_WARN" "$C_RESET"
        echo "         .env 의 LLM_BASE_URL / LLM_API_KEY / LLM_DEFAULT_MODEL 을 채운 뒤"
        echo "         ./openmake_llm.sh restart 하세요."
        echo ""
    fi

    printf "  %s부팅 시 자동 시작:%s  %s startup   후 안내되는 명령 실행 →  %s save\n\n" \
        "$C_DIM" "$C_RESET" "${PM2_BIN:-pm2}" "${PM2_BIN:-pm2}"
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
    parse_args "$@"

    printf "\n%s╔══════════════════════════════════════════════════╗%s\n" "$C_INFO" "$C_RESET"
    printf "%s║        OpenMake LLM — 원샷 설치 (Linux/macOS)     ║%s\n" "$C_INFO" "$C_RESET"
    printf "%s╚══════════════════════════════════════════════════╝%s\n" "$C_INFO" "$C_RESET"

    detect_platform
    has curl || log_warn "curl 미설치 — health check 를 건너뛰게 됩니다."

    ensure_node
    ensure_docker
    ensure_pm2
    setup_env
    install_deps
    compose_up
    run_migrations
    build_app
    start_app
    summary
}

main "$@"
