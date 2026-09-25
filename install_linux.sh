#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — Linux 원샷 설치 (단일 내부망 구성) · Windows 는 WSL2 안에서
# ==============================================================================
# macOS 는 install_mac.sh 를 쓴다 — install.sh(입구)가 OS 를 판별해 자동으로 넘긴다.
# 새 서버에서 이 스크립트 하나로 운영과 같은 구성을 만든다. 역할은 셋으로 나뉜다:
#
#   1) 이 스크립트  — Linux 사전 준비: 호스트 패키지(apt/dnf…) · uv · 절전 해제 · Node 24 · PM2
#                     · Docker Engine(+ docker 그룹 재진입) · 질문(한 번에) · (선택) Tailscale
#   2) omk          — 스택 (scripts/env/omk.sh env install): LiteLLM 게이트웨이 · SearXNG ·
#                     샌드박스 이미지 · 운영 기능 프로필 · DGX 연결 · 내부망 HTTPS · 뷰어 · Discord
#   3) 이 스크립트 --minimal — omk 가 부르는 앱 본체: .env · PostgreSQL/Redis(빈 DB) · 빌드 · PM2
#   … 끝으로 호스트 마무리: :443 권한 · 루트 인증서 신뢰 · DB 백업 예약 · 로그 회전 · systemd 자동 시작
#
# 전제: 서버·DGX·사용자 PC 가 하나의 내부망에 있고 외부에는 공개하지 않는다.
#       설치·운영 중 인터넷으로 나가는 연결은 가능하다 (패키지·npm·Docker 이미지·검색).
#       DGX 는 같은 LAN(직접) 또는 다른 네트워크(Tailscale) 둘 다 지원한다.
#       소스는 omk 규칙 위치($OMK_ROOT/<환경>/llm, 기본 ~/.openmake/online/llm)에 둔다.
# Windows: 네이티브(Git Bash/PowerShell)는 지원하지 않는다 — WSL2(Ubuntu) 설치 절차를 안내하고 종료한다.
#
# 사용:
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install_linux.sh | bash
#   ./install_linux.sh                       # 대화형 — 처음에 질문을 모두 받고 이후 무인 진행
#   ./install_linux.sh --yes --dgx-host 192.168.0.50 --vllm-api-key <키>
#   ./install_linux.sh --yes --llm-provider openrouter --llm-model qwen/qwen3-235b-a22b:free --llm-api-key sk-or-...
#   ./install_linux.sh --minimal --yes       # 앱 본체만 (omk 가 부르는 모드 · CI 설치 스모크)
#
# 옵션:
#   -y, --yes                 모든 확인 자동 승인 (선택 항목은 끔 — 켜려면 --with-* 옵션)
#   LLM (DGX vLLM — 기본):
#     --dgx-host HOST         DGX 주소 (LAN IP 또는 Tailscale IP/이름)
#     --dgx-via lan|tailscale DGX 연결 방식 (기본 lan)
#     --vllm-api-key KEY      DGX vLLM API 키 (DGX /home/<user>/vllm/vllm.env 의 VLLM_API_KEY)
#     --tailscale-authkey KEY Tailscale 무인 로그인 키 (없으면 로그인 URL 을 브라우저에서 승인)
#   LLM (외부 provider — DGX 를 쓰지 않을 때):
#     --llm-provider NAME     openrouter | ollama-cloud | nvidia | hasa | bai | orcarouter | custom
#     --llm-model ID          기본 채팅 모델 ID (provider 가 쓰는 이름 그대로)
#     --llm-api-key KEY       provider API 키 (서버 공용 키 — LiteLLM 에만 저장)
#     --llm-base-url URL      custom 일 때 OpenAI 호환 주소 (--minimal 에서는 앱이 직접 쓸 주소)
#   접속:
#     --host NAME|IP          접속 주소 (기본 이 서버의 LAN IP)
#     --http                  HTTPS 없이 HTTP 로만 (복사 버튼·웹 푸시가 동작하지 않음)
#   선택 항목:
#     --with-artifact-viewer  아티팩트 공유 뷰어 (별도 포트 origin)
#     --with-discord          Discord 봇 (--discord-token 필요)
#     --discord-token TOKEN   이 서버 전용 새 봇 토큰 (운영 봇 토큰 재사용 금지)
#     --no-sandbox-images     MCP·작업 샌드박스 이미지 빌드 생략 (샌드박스 기능 꺼짐)
#   기타:
#     --instance NAME         환경 이름 (기본 online) — 같은 호스트에 나란히 설치
#     --minimal               앱 본체만 (omk 가 부르는 모드)
#     --public-url URL        (--minimal) 공개 주소 — OMK_APP_URL/CORS 반영, https 면 secure cookie
#     --skip-docker · --skip-build · --no-start · --force-env · --port · --web-port · --postgres-port · --redis-port
#
# 환경변수: OMK_ROOT(~/.openmake) · OMK_REF(브랜치/태그) · OMK_REPO_URL
# 재실행 안전(idempotent): 이미 된 단계는 건너뛰거나 갱신만 한다.
# 종료 코드: 0 성공 / 1 사용법·전제조건 오류 / 2 설치 단계 실패 / 3 health check 실패
# ==============================================================================

# 전역 변수는 scripts/setup/{common,linux}/*.sh(런타임 source)가 읽는다 — shellcheck 가 파일 간 사용을 못 본다.
# shellcheck disable=SC2034
set -euo pipefail

# curl | bash 파이프 실행에서는 BASH_SOURCE 가 비어 있다 — 이때 SCRIPT_DIR 는
# 현재 디렉터리가 되고, 아래 bootstrap_source 가 레포 밖임을 감지해 소스를 받는다.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
readonly SCRIPT_DIR
readonly DEFAULT_REPO_URL="https://github.com/openmake/openmake_llm.git"
readonly NODE_MAJOR_MIN=24
readonly NODE_PINNED_VERSION="24.21.0"   # mise.toml / .node-version 과 동일
readonly TOOLCHAIN_DIR="$SCRIPT_DIR/.openmake"
readonly TOOLCHAIN_ENV="$TOOLCHAIN_DIR/toolchain.env"
readonly HEALTH_RETRIES=45
readonly HEALTH_INTERVAL=2
OMK_ROOT="${OMK_ROOT:-$HOME/.openmake}"
readonly OMK_DEFAULT_ENV="online"     # omk 의 기본(무접미사) 인스턴스
readonly OS_LABEL="Linux"

# 포트 — 빈 값이면 인스턴스별 기본값(resolve_instance)이 채운다. 셸 환경변수·플래그가 우선.
APP_PORT="${OMK_PORT:-}"
WEB_PORT="${OMK_WEB_PORT:-}"
PG_PORT="${OMK_POSTGRES_PORT:-}"
RD_PORT="${OMK_REDIS_PORT:-}"

# 인스턴스 — 같은 호스트에 설치본 여러 개를 나란히 띄우기 위한 이름표. 빈 값 = 기본 인스턴스.
# PM2 앱·docker 컨테이너·볼륨 이름에 "-$INSTANCE" 접미사가 붙고 .env 의 OMK_INSTANCE 로 고정된다.
INSTANCE="${OMK_INSTANCE:-}"
PUBLIC_URL=""
APP_NAME=""; FRONT_APP_NAME=""; PG_CONTAINER=""; RD_CONTAINER=""

ASSUME_YES=0
SKIP_DOCKER=0
SKIP_BUILD=0
NO_START=0
FORCE_ENV=0
LLM_BASE_URL=""
LLM_API_KEY=""
LLM_MODEL=""
MINIMAL=0

# 질문 답 (common/questions.sh 가 채운다 — 플래그가 있으면 그 값을 쓴다)
LLM_MODE=""            # dgx | external | keep | direct(--minimal)
DGX_VIA=""; DGX_HOST=""; VLLM_API_KEY=""; TAILSCALE_AUTHKEY=""; LLM_PROVIDER=""
APP_HOST=""; HTTPS_MODE=""
WITH_VIEWER=""; WITH_DISCORD=""; DISCORD_TOKEN=""
SANDBOX_IMAGES=1
TODO_LIST=""           # 설치 후 할 일 — summary 가 출력한다
ORIG_ARGS=()           # docker 그룹 재진입용

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

# 대화형 판정: stdin 이 tty 가 아니어도(curl | bash) 제어 터미널(/dev/tty)이
# 열리면 사용자에게 물을 수 있다. CI 처럼 둘 다 없을 때만 비대화형이다.
TTY_DEV=""
if [[ -t 0 ]] || { : < /dev/tty; } 2>/dev/null; then
    TTY_DEV="/dev/tty"
fi
readonly TTY_DEV

interactive() { [[ $ASSUME_YES -eq 0 && -n "$TTY_DEV" ]]; }

# y/N 확인 — confirm "질문" [y|n]. 기본값을 주지 않으면 종전 동작 그대로:
# 비대화형(--yes·tty 없음)은 자동 승인, 대화형은 엔터가 N. 기본값을 주면 비대화형도 그 값으로 답한다.
confirm() {
    local prompt="$1" def="${2:-}" reply=""
    if ! interactive; then
        [[ "${def:-y}" == "y" ]] && log_info "$prompt → 자동 승인"
        [[ "${def:-y}" == "y" ]]; return
    fi
    local hint="[y/N]"; [[ "$def" == "y" ]] && hint="[Y/n]"
    read -r -p "$(printf '%s%s%s %s: ' "$C_WARN" "$prompt" "$C_RESET" "$hint")" reply < "$TTY_DEV" || true
    reply="${reply:-${def:-n}}"
    case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# 값 입력 — ask VAR "질문" "기본값". 비대화형이면 기본값.
ask() {
    local __var="$1" prompt="$2" def="${3:-}" reply=""
    if interactive; then
        read -r -p "  ${prompt}${def:+ [기본 $def]}: " reply < "$TTY_DEV" || true
    fi
    printf -v "$__var" '%s' "${reply:-$def}"
}

# 비밀값 입력 — 화면에 표시하지 않는다.
ask_secret() {
    local __var="$1" prompt="$2" reply=""
    if interactive; then
        read -r -s -p "  ${prompt}: " reply < "$TTY_DEV" || true
        echo ""
    fi
    printf -v "$__var" '%s' "$reply"
}

add_todo() { TODO_LIST="${TODO_LIST}${TODO_LIST:+$'\n'}$*"; }
omk_env_name() { printf '%s' "${INSTANCE:-$OMK_DEFAULT_ENV}"; }

# sudo 비밀번호를 한 번 받고 설치가 끝날 때까지 유지한다 (기본 유효시간 < 설치 시간).
SUDO_KEEPALIVE_PID=""
sudo_begin() {
    [[ -n "$SUDO_KEEPALIVE_PID" ]] && return 0
    [[ $EUID -eq 0 ]] && return 0
    log_info "관리자 권한(sudo)이 필요합니다. 비밀번호를 한 번만 입력하세요."
    sudo -v || die "sudo 인증 실패"
    ( while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit 0; done ) &
    SUDO_KEEPALIVE_PID=$!
    trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT
}

has() { command -v "$1" >/dev/null 2>&1; }

usage() {
    # 파일 상단 주석 블록(셔뱅 다음 ~ 첫 비주석 줄 전)을 그대로 사용법으로 출력한다.
    # 헤더를 고쳐도 --help 가 자동으로 따라오도록 줄 번호를 하드코딩하지 않는다.
    local self="${BASH_SOURCE[0]:-}"
    if [[ -f "$self" ]]; then
        # 머리말 주석 블록만 — 첫 빈 줄이나 명령 줄에서 멈춘다.
        sed -nE '2,/^([^#]|$)/p' "$self" | sed '$d' | sed 's/^# \{0,1\}//'
    else
        # 파이프 실행 등 원본 파일에 접근할 수 없는 경우의 짧은 폴백.
        echo "전체 도움말: 클론된 레포에서 ./install_linux.sh --help"
    fi
}

# ── 부트스트랩 ───────────────────────────────────────────────────────────────
# 전체 설치는 소스를 omk 규칙 위치($OMK_ROOT/<환경>/llm)에서 실행한다 — omk 가 그 소스를 재사용한다.
# 다른 곳(curl 파이프·수동 클론)에서 실행되면 그 위치로 받고(있으면 재사용) 그 안의 사본으로 재진입한다.
# --minimal(omk 가 부르는 앱 본체 설치)은 어디서 실행되든 그 자리에서 진행한다 (omk dev 는 작업 클론에서 부른다).
ensure_git_for_bootstrap() {
    has git && return 0
    log_info "git 설치 (sudo 필요)"
    if   has apt-get; then sudo apt-get update -qq && sudo apt-get install -y -qq git ca-certificates curl
    elif has dnf;     then sudo dnf install -y -q git
    elif has yum;     then sudo yum install -y -q git
    elif has pacman;  then sudo pacman -Sy --noconfirm git
    elif has zypper;  then sudo zypper install -y git
    fi >/dev/null || true
    has git || die "git 을 설치할 수 없습니다 — 직접 설치한 뒤 다시 실행하세요."
}

bootstrap_source() {
    # Windows 네이티브는 detect_platform 이 WSL2 안내 후 종료한다 — 클론 낭비 방지.
    # macOS 는 소스를 받기 전에 멈춘다 (install_mac.sh 의 몫).
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
        Darwin) log_err "macOS 는 install_mac.sh 로 설치합니다:  ./install_mac.sh  (또는 ./install.sh 가 자동 선택)"; exit 1 ;;
    esac
    local a prev="" inst="$INSTANCE" minimal=0 help=0
    for a in "$@"; do
        [[ "$prev" == "--instance" ]] && inst="$a"
        [[ "$a" == "--minimal" ]] && minimal=1
        [[ "$a" == "-h" || "$a" == "--help" ]] && help=1
        prev="$a"
    done
    local in_repo=0
    [[ -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/openmake_llm.sh" ]] && in_repo=1
    [[ $in_repo -eq 1 && ( $minimal -eq 1 || $help -eq 1 ) ]] && return 0

    local target="$OMK_ROOT/${inst:-$OMK_DEFAULT_ENV}/llm"
    [[ -d "$target" ]] && target="$( cd "$target" && pwd -P )"
    [[ "$( cd "$SCRIPT_DIR" && pwd -P )" == "$target" ]] && return 0

    log_step "부트스트랩 — 소스 위치 $target"
    if [[ -f "$target/package.json" && -f "$target/install_linux.sh" && -d "$target/.git" ]]; then
        log_ok "기존 소스 재사용 — 최신화하려면: git -C \"$target\" pull"
    elif [[ -d "$target" ]] && [[ -n "$(ls -A "$target" 2>/dev/null)" ]]; then
        die "$target 이 비어있지 않은데 OpenMake LLM 소스가 아닙니다 — OMK_ROOT 로 다른 위치를 지정하세요."
    else
        local repo_url="${OMK_REPO_URL:-$DEFAULT_REPO_URL}" ref="${OMK_REF:-}" tag=""
        if [[ -z "$ref" && $in_repo -eq 1 ]] && git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
            ref="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
            [[ "$ref" == "HEAD" ]] && ref=""
        fi
        ensure_git_for_bootstrap
        # online 은 최신 릴리스 태그만 따른다(omk 규칙). omk 와 같은 모양(로컬 브랜치 'release')으로 받아 두면
        # omk 가 설치 도중 이 소스를 다른 ref 로 옮기지 않는다.
        if [[ -z "$ref" && "${inst:-$OMK_DEFAULT_ENV}" == "$OMK_DEFAULT_ENV" ]]; then
            tag="$(git ls-remote --tags --refs "$repo_url" 2>/dev/null | sed 's#.*refs/tags/##' \
                | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
        fi
        ref="${ref:-main}"
        mkdir -p "$(dirname "$target")"
        log_info "git clone $repo_url → $target"
        git clone --branch "$ref" "$repo_url" "$target" \
            || die "git clone 실패 ($repo_url @ $ref) — 브랜치가 원격에 있는지 확인하세요 (OMK_REF 로 지정 가능)"
        if [[ -n "$tag" ]]; then
            if git -C "$target" cat-file -e "$tag:install_linux.sh" 2>/dev/null \
               && git -C "$target" cat-file -e "$tag:scripts/setup/linux" 2>/dev/null; then
                git -C "$target" checkout -q -B release "$tag" || die "릴리스 $tag 체크아웃 실패"
                log_ok "최신 릴리스 $tag (로컬 브랜치 release)"
            else
                log_warn "최신 릴리스 $tag 에 이 설치 스크립트가 없어 $ref 로 설치합니다 — 이 환경은 릴리스 대신 $ref 를 따릅니다."
            fi
        fi
    fi
    log_ok "소스 준비 완료 → $target/install_linux.sh 로 재진입"
    exec bash "$target/install_linux.sh" "$@"
}

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -y|--yes)        ASSUME_YES=1 ;;
            --skip-docker)   SKIP_DOCKER=1 ;;
            --minimal)       MINIMAL=1 ;;
            --dgx-host)      DGX_HOST="${2:-}"; LLM_MODE="dgx"; shift ;;
            --dgx-via)       DGX_VIA="${2:-}"; shift ;;
            --vllm-api-key)  VLLM_API_KEY="${2:-}"; shift ;;
            --tailscale-authkey) TAILSCALE_AUTHKEY="${2:-}"; shift ;;
            --llm-provider)  LLM_PROVIDER="${2:-}"; LLM_MODE="external"; shift ;;
            --host)          APP_HOST="${2:-}"; shift ;;
            --http)          HTTPS_MODE=0 ;;
            --with-artifact-viewer) WITH_VIEWER=1 ;;
            --with-discord)  WITH_DISCORD=1 ;;
            --discord-token) DISCORD_TOKEN="${2:-}"; shift ;;
            --no-sandbox-images) SANDBOX_IMAGES=0 ;;
            --skip-build)    SKIP_BUILD=1 ;;
            --no-start)      NO_START=1 ;;
            --force-env)     FORCE_ENV=1 ;;
            --llm-base-url)  LLM_BASE_URL="${2:-}"; shift ;;
            --llm-api-key)   LLM_API_KEY="${2:-}"; shift ;;
            --llm-model)     LLM_MODEL="${2:-}"; shift ;;
            --port)          APP_PORT="${2:-}"; shift ;;
            --web-port)      WEB_PORT="${2:-}"; shift ;;
            --postgres-port) PG_PORT="${2:-}"; shift ;;
            --redis-port)    RD_PORT="${2:-}"; shift ;;
            --instance)      INSTANCE="${2:-}"; shift ;;
            --public-url)    PUBLIC_URL="${2:-}"; shift ;;
            -h|--help)       usage; exit 0 ;;
            *) log_err "알 수 없는 옵션: $1"; echo ""; usage; exit 1 ;;
        esac
        shift
    done
    case "$DGX_VIA" in ""|lan|tailscale) ;; *) log_err "--dgx-via 는 lan 또는 tailscale: $DGX_VIA"; exit 1 ;; esac
}

# ── 인스턴스 확정 ────────────────────────────────────────────────────────────
# 재실행이면 .env 의 OMK_INSTANCE 가 진실 — 플래그와 다르면 다른 인스턴스를 같은 디렉터리에
# 덮어쓰려는 것이므로 막는다. 확정 뒤 PM2 앱·컨테이너 이름과 인스턴스별 기본 포트를 정한다.
resolve_instance() {
    local from_env
    from_env="$(env_value OMK_INSTANCE)"
    if [[ -n "$from_env" ]]; then
        if [[ -n "$INSTANCE" && "$INSTANCE" != "$from_env" ]]; then
            die "이 디렉터리는 '$from_env' 인스턴스입니다 (.env OMK_INSTANCE) — '--instance $INSTANCE' 로 덮어쓸 수 없습니다. 다른 디렉터리(OMK_HOME)에 설치하세요."
        fi
        INSTANCE="$from_env"
    fi
    if [[ -n "$INSTANCE" ]] && ! [[ "$INSTANCE" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
        die "인스턴스 이름은 소문자·숫자·하이픈만 가능합니다 (예: test): '$INSTANCE'"
    fi
    [[ "$INSTANCE" == "$OMK_DEFAULT_ENV" ]] && INSTANCE=""   # omk 의 online = 기본(무접미사) 인스턴스
    local suffix="${INSTANCE:+-$INSTANCE}"
    APP_NAME="openmake-llm$suffix"
    FRONT_APP_NAME="openmake-next$suffix"
    # infra/docker-compose.yml 의 openmake${OMK_INSTANCE:+-…}-postgres 규칙과 같다.
    PG_CONTAINER="openmake$suffix-postgres"
    RD_CONTAINER="openmake$suffix-redis"

    # 인스턴스별 기본 포트 — 기본 인스턴스는 기존 값 그대로, 이름 있는 인스턴스는 한 칸 옆.
    # (점유돼 있으면 ensure_ports 가 빈 포트로 옮긴다.)
    if [[ -n "$INSTANCE" ]]; then
        : "${APP_PORT:=52417}" "${WEB_PORT:=3010}" "${PG_PORT:=5433}" "${RD_PORT:=6380}"
        log_ok "인스턴스: $INSTANCE (PM2 $APP_NAME / $FRONT_APP_NAME · docker $PG_CONTAINER / $RD_CONTAINER)"
    else
        : "${APP_PORT:=52416}" "${WEB_PORT:=3000}" "${PG_PORT:=5432}" "${RD_PORT:=6379}"
    fi
}

# .env 에 인스턴스 키가 없으면 붙인다 — 이름 있는 인스턴스인데 예전 .env 를 재사용하는 경우.
# (신규 생성은 gen-env.mjs 가 같은 키를 쓴다.) 없으면 PM2/compose 가 접미사 없는 이름으로 떠서
# 같은 호스트의 기본 인스턴스와 충돌한다.
ensure_env_instance_keys() {
    [[ -n "$INSTANCE" ]] || return 0
    local envf="$SCRIPT_DIR/.env"
    if [[ -z "$(env_value OMK_INSTANCE)" ]]; then
        printf '\n# 인스턴스 — PM2 앱·컨테이너·볼륨 이름 접미사 (install.sh --instance)\nOMK_INSTANCE=%s\n' "$INSTANCE" >> "$envf"
    fi
    if [[ -z "$(env_value COMPOSE_PROJECT_NAME)" ]]; then
        printf 'COMPOSE_PROJECT_NAME=openmake-%s\n' "$INSTANCE" >> "$envf"
    fi
}

# 공개 주소를 .env 에 반영한다 — OMK_APP_URL 교체, CORS_ORIGINS 에 추가, OMK_WEB_PORT 명시
# (주소에 포트가 없으면 resolve-ports 가 웹 포트를 역산할 수 없다), https 면 secure cookie 로.
set_env_public_url() {
    local url="${1%/}" envf="$SCRIPT_DIR/.env" tmp
    [[ "$url" =~ ^https?://[^/[:space:]]+$ ]] \
        || die "--public-url 은 스킴+호스트[:포트] 형식이어야 합니다 (예: https://chat.example.com): $url"
    tmp="$(mktemp)"
    sed -E "s|^OMK_APP_URL=.*|OMK_APP_URL=${url}|" "$envf" > "$tmp" && mv "$tmp" "$envf"
    if ! env_value CORS_ORIGINS | tr ',' '\n' | grep -qxF "$url"; then
        tmp="$(mktemp)"
        sed -E "s|^CORS_ORIGINS=(.*)|CORS_ORIGINS=\1,${url}|" "$envf" > "$tmp" && mv "$tmp" "$envf"
    fi
    if grep -qE '^OMK_WEB_PORT=' "$envf"; then
        tmp="$(mktemp)"
        sed -E "s|^OMK_WEB_PORT=.*|OMK_WEB_PORT=${WEB_PORT}|" "$envf" > "$tmp" && mv "$tmp" "$envf"
    else
        printf '\n# 웹(Next) 포트 — 공개 주소에 포트가 없으므로 명시 (scripts/resolve-ports.cjs)\nOMK_WEB_PORT=%s\n' "$WEB_PORT" >> "$envf"
    fi
    if [[ "$url" == https://* ]]; then
        tmp="$(mktemp)"
        sed -E 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|; s|^ALLOW_INSECURE_COOKIES=.*|ALLOW_INSECURE_COOKIES=false|' \
            "$envf" > "$tmp" && mv "$tmp" "$envf"
        log_ok "공개 주소 $url — HTTPS 이므로 COOKIE_SECURE=true / ALLOW_INSECURE_COOKIES=false"
        log_warn "TLS 를 종단하는 프록시(Cloudflare/Caddy 등) 뒤에서만 로그인이 됩니다 — http://localhost:$WEB_PORT 직접 접속은 쿠키가 저장되지 않습니다."
    else
        log_ok "공개 주소 $url 반영"
    fi
}

# ── 플랫폼 감지 ──────────────────────────────────────────────────────────────
OS=""          # linux | windows
ARCH=""        # x64 | arm64
PKG=""         # brew | apt | dnf | yum | pacman | zypper | ""
IS_WSL=0       # 1 이면 WSL(Windows Subsystem for Linux) 안의 Linux

# Windows 네이티브(Git Bash/MSYS/Cygwin)에서 실행된 경우 — 앱 스택(bash 운영
# 스크립트·PM2 ecosystem·Docker bind mount)이 POSIX 전제라 네이티브 Windows 는
# 지원하지 않는다. WSL2 로 가는 정확한 절차를 안내하고 종료한다.
windows_guide() {
    echo ""
    log_err "Windows 가 감지되었습니다 — 네이티브 Windows(Git Bash) 설치는 지원하지 않습니다."
    echo ""
    echo "  OpenMake LLM 은 Windows 에서 WSL2(Ubuntu) 위에 설치합니다:"
    echo ""
    echo "  1) PowerShell(관리자 권한)에서 WSL2 + Ubuntu 설치:"
    echo "       wsl --install -d Ubuntu"
    echo "     설치 후 PC 를 재부팅하고, Ubuntu 최초 실행에서 사용자 계정을 만드세요."
    echo ""
    echo "  2) Ubuntu 터미널에서 한 줄로 설치 (WSL 내부 홈 디렉터리에 받는다 — /mnt/c 는 느림):"
    echo "       curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash"
    echo "     또는 직접 클론:"
    echo "       git clone https://github.com/openmake/openmake_llm.git"
    echo "       cd openmake_llm && ./install.sh"
    echo ""
    echo "  3) Docker 는 둘 중 하나면 됩니다:"
    echo "     - install.sh 가 WSL 안에 Docker Engine 을 설치하도록 승인 (기본, 추가 설치 불필요)"
    echo "     - 또는 Windows 에 Docker Desktop 설치 후 Settings → Resources →"
    echo "       WSL integration 에서 Ubuntu 를 켜기"
    echo ""
    if has wsl.exe && [[ -n "$(wsl.exe -l -q 2>/dev/null | tr -d '\0\r' | head -1)" ]]; then
        log_info "이미 WSL 배포판이 설치되어 있습니다 — Ubuntu 터미널을 열어 2) 부터 진행하세요."
    fi
    exit 1
}

detect_platform() {
    case "$(uname -s)" in
        Darwin)
            log_err "macOS 는 install_mac.sh 로 설치합니다:  ./install_mac.sh  (또는 ./install.sh 가 자동 선택)"
            exit 1 ;;
        Linux)                     OS="linux" ;;
        MINGW*|MSYS*|CYGWIN*)      OS="windows" ;;
        *) log_err "판정할 수 없는 OS: $(uname -s) (Linux / Windows-WSL2 지원 — macOS 는 install_mac.sh)"; exit 1 ;;
    esac

    if [[ "$OS" == "windows" ]]; then
        windows_guide   # 안내 후 exit 1
    fi

    # WSL 은 uname 상 Linux — Docker 안내가 달라지므로 구분해 둔다.
    if [[ "$OS" == "linux" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
        IS_WSL=1
    fi

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

    local wsl_tag=""
    [[ $IS_WSL -eq 1 ]] && wsl_tag=" (WSL)"
    log_ok "플랫폼: $OS/$ARCH$wsl_tag${PKG:+ (패키지 관리자: $PKG)}"
}

# 클론 직후 실행이 전제지만, zip 다운로드·최소 설치 환경까지 커버한다.
# curl 은 Node/Docker 자동 설치와 health check 에 필수 — Linux 는 패키지
# 관리자로 설치를 시도한다.
ensure_basics() {
    if ! has curl && [[ "$OS" == "linux" ]] && [[ -n "$PKG" ]]; then
        if confirm "curl 미설치 — 패키지 관리자($PKG)로 설치할까요? (sudo 필요)"; then
            case "$PKG" in
                apt)    sudo apt-get update -qq && sudo apt-get install -y curl ca-certificates ;;
                dnf)    sudo dnf install -y curl ;;
                yum)    sudo yum install -y curl ;;
                pacman) sudo pacman -Sy --noconfirm curl ;;
                zypper) sudo zypper install -y curl ;;
            esac || log_warn "curl 자동 설치 실패 — 직접 설치가 필요할 수 있습니다."
        fi
    fi
    has curl || log_warn "curl 미설치 — Node/Docker 자동 설치와 health check 가 실패할 수 있습니다."
    # git 은 없어도 설치는 진행된다 (build-info 는 'unknown' 으로 fallback).
    has git || log_warn "git 미설치 — 빌드 메타(git hash)가 'unknown' 으로 기록됩니다."
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
        set +u
        # nvm.sh 경로는 런타임 결정이라 정적 추적 불가가 정상 (지시자는 바로 다음 명령에만 적용).
        # shellcheck source=/dev/null
        . "$nvm_sh"
        nvm install "$NODE_PINNED_VERSION" >/dev/null 2>&1 || true
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

# Homebrew 의 docker-compose 는 플러그인을 /opt/homebrew/lib/docker/cli-plugins 에 두는데,
# docker CLI 는 이 경로를 기본으로 보지 않는다 → `docker compose` 가 "unknown command" 로 실패.
# brew 가 caveat 로 안내하는 대로 ~/.docker/config.json 에 cliPluginsExtraDirs 를 등록한다.
register_brew_compose_plugin() {
    has brew || return 1
    local plugin_dir
    plugin_dir="$(brew --prefix)/lib/docker/cli-plugins"
    [[ -e "$plugin_dir/docker-compose" ]] || return 1

    local cfg="$HOME/.docker/config.json"
    mkdir -p "$HOME/.docker"
    # 기존 설정을 보존한 채 병합 (node 는 이 시점에 반드시 있다).
    node -e '
        const fs = require("fs");
        const [cfgPath, dir] = process.argv.slice(1);
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
        const dirs = Array.isArray(cfg.cliPluginsExtraDirs) ? cfg.cliPluginsExtraDirs : [];
        if (!dirs.includes(dir)) dirs.push(dir);
        cfg.cliPluginsExtraDirs = dirs;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    ' "$cfg" "$plugin_dir" 2>/dev/null || return 1

    log_info "docker compose 플러그인 경로 등록 → ~/.docker/config.json ($plugin_dir)"
    docker compose version >/dev/null 2>&1
}

detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker compose"
        return 0
    fi

    # Homebrew 로 방금 깔았는데 플러그인 등록만 안 된 흔한 상태 — 자동 복구를 시도.
    if register_brew_compose_plugin; then
        DOCKER_COMPOSE="docker compose"
        return 0
    fi

    if has docker-compose; then
        DOCKER_COMPOSE="docker-compose"
        # 진짜 구형 v1 일 때만 경고한다 (brew 의 standalone 바이너리는 최신 Compose 다).
        case "$(docker-compose version --short 2>/dev/null)" in
            1.*) log_warn "compose v1(docker-compose) 사용 — v2 이상 업그레이드를 권장합니다." ;;
        esac
        return 0
    fi

    return 1
}

install_docker() {
    log_err "Docker 가 없습니다."
    if [[ $IS_WSL -eq 1 ]]; then
        log_info "WSL 감지 — 대안: Windows 의 Docker Desktop 을 설치하고 Settings → Resources →"
        log_info "WSL integration 에서 이 배포판을 켜면 별도 설치 없이 docker 를 쓸 수 있습니다."
    fi
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
    sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true

    local i
    for ((i = 1; i <= 30; i++)); do
        docker info >/dev/null 2>&1 && { log_ok "Docker 데몬 준비 완료 (~$((i * 2))s)"; return 0; }
        sleep 2
    done
    if [[ $IS_WSL -eq 1 ]]; then
        log_err "WSL 에서 Docker 데몬 기동 실패. 다음 중 하나를 확인하세요:"
        echo "  - WSL 안 Docker Engine:  sudo service docker start  (systemd 미사용 배포판)"
        echo "  - Docker Desktop 사용 시: Windows 에서 Docker Desktop 실행 후"
        echo "    Settings → Resources → WSL integration 에서 이 배포판 활성화"
        exit 2
    fi
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
    # 방금 설치했으면 현재 셸이 docker 그룹이 아니다 — 데몬 대기(권한 오류로 실패) 전에 새 그룹으로 재진입한다.
    reexec_with_docker_group
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
# ── 5.5 포트 충돌 회피 ───────────────────────────────────────────────────────
# 대상 머신에 PostgreSQL/Redis 가 이미 떠 있으면 (호스트 설치본 postgres, 다른
# 컨테이너 등) compose 의 호스트 포트 바인딩이 "port is already allocated" 로
# 실패한다 — .env 생성 전에 감지해서 빈 포트로 자동 이동한다.
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# 그 포트를 점유한 것이 우리 컨테이너($1)인가 — 재실행 케이스라 충돌이 아니다.
port_owned_by() {
    has docker && docker port "$1" 2>/dev/null | grep -q ":$2\$"
}

find_free_port() {
    local p
    for ((p = $1; p < $1 + 200; p++)); do
        port_in_use "$p" || { echo "$p"; return 0; }
    done
    return 1
}

# 재실행으로 .env 가 이미 있으면 바뀐 포트를 .env 에도 반영한다 (연결 URL 포함).
update_env_port() { # $1=POSTGRES_PORT|REDIS_PORT $2=새 포트
    local envf="$SCRIPT_DIR/.env" tmp
    [[ -f "$envf" ]] || return 0
    tmp="$(mktemp)"
    if [[ "$1" == "POSTGRES_PORT" ]]; then
        sed -E "s|^POSTGRES_PORT=.*|POSTGRES_PORT=$2|; s|^(DATABASE_URL=.*@[^:/]+:)[0-9]+|\1$2|" "$envf" > "$tmp"
    else
        sed -E "s|^REDIS_PORT=.*|REDIS_PORT=$2|; s|^(REDIS_URL=redis://[^:/]+:)[0-9]+|\1$2|" "$envf" > "$tmp"
    fi
    mv "$tmp" "$envf"
}

update_env_app_port() { # API 포트 변경: PORT= 와 URL 류의 :old 를 :new 로
    local envf="$SCRIPT_DIR/.env" tmp
    [[ -f "$envf" ]] || return 0
    tmp="$(mktemp)"
    sed -E "s|^PORT=.*|PORT=$2|; /^(CORS_ORIGINS|SWAGGER_BASE_URL)=/s|:$1|:$2|g" "$envf" > "$tmp"
    mv "$tmp" "$envf"
}

update_env_web_port() { # 웹 포트 변경: 공개 주소/CORS 의 :old 를 :new 로
    local envf="$SCRIPT_DIR/.env" tmp
    [[ -f "$envf" ]] || return 0
    tmp="$(mktemp)"
    sed -E "/^(CORS_ORIGINS|OMK_APP_URL)=/s|:$1|:$2|g" "$envf" > "$tmp"
    mv "$tmp" "$envf"
}

# PM2 에 등록된 우리 앱이면 재실행 케이스 — pm2 restart 가 포트를 이어받는다.
pm2_has_app() { "${PM2_BIN:-pm2}" describe "$1" >/dev/null 2>&1; }

ensure_ports() {
    [[ $SKIP_DOCKER -eq 1 ]] && return 0

    # 재실행이면 기존 .env 에 적힌 포트가 진실 — 거기서 이어받는다.
    local v
    v="$(env_value POSTGRES_PORT)"; [[ -n "$v" ]] && PG_PORT="$v"
    v="$(env_value REDIS_PORT)";    [[ -n "$v" ]] && RD_PORT="$v"

    # 앱(API)/웹 포트 — PM2 로 도는 호스트 프로세스라 소유 판정은 PM2 등록 여부로 한다.
    v="$(env_value PORT)"; [[ -n "$v" ]] && APP_PORT="$v"
    v="$(env_value OMK_WEB_PORT)"
    [[ -n "$v" ]] || v="$(env_value OMK_APP_URL | sed -nE 's|.*:([0-9]+)/?$|\1|p')"
    [[ -n "$v" ]] && WEB_PORT="$v"

    local alt
    if port_in_use "$APP_PORT" && ! pm2_has_app "$APP_NAME"; then
        alt="$(find_free_port $((APP_PORT + 1)))" \
            || die "API 대체 포트 탐색 실패 — --port 로 직접 지정하세요."
        log_warn "호스트 포트 $APP_PORT 을 다른 프로세스가 사용 중 — API 를 $alt 로 대체합니다."
        update_env_app_port "$APP_PORT" "$alt"
        APP_PORT="$alt"
    fi
    if port_in_use "$WEB_PORT" && ! pm2_has_app "$FRONT_APP_NAME"; then
        alt="$(find_free_port 13000)" \
            || die "웹 대체 포트 탐색 실패 (13000~) — --web-port 로 직접 지정하세요."
        log_warn "호스트 포트 $WEB_PORT 을 다른 프로세스가 사용 중 — 웹 UI 를 $alt 로 대체합니다."
        update_env_web_port "$WEB_PORT" "$alt"
        WEB_PORT="$alt"
    fi

    if port_in_use "$PG_PORT" && ! port_owned_by "$PG_CONTAINER" "$PG_PORT"; then
        alt="$(find_free_port 15432)" \
            || die "PostgreSQL 대체 포트 탐색 실패 (15432~) — --postgres-port 로 직접 지정하세요."
        log_warn "호스트 포트 $PG_PORT 을 다른 프로세스가 사용 중 (기존 PostgreSQL?) — $alt 로 대체합니다."
        PG_PORT="$alt"
        update_env_port POSTGRES_PORT "$alt"
    fi
    if port_in_use "$RD_PORT" && ! port_owned_by "$RD_CONTAINER" "$RD_PORT"; then
        alt="$(find_free_port 16379)" \
            || die "Redis 대체 포트 탐색 실패 (16379~) — --redis-port 로 직접 지정하세요."
        log_warn "호스트 포트 $RD_PORT 을 다른 프로세스가 사용 중 (기존 Redis?) — $alt 로 대체합니다."
        RD_PORT="$alt"
        update_env_port REDIS_PORT "$alt"
    fi
}

# 대화형으로 LLM 엔드포인트를 고른다. --llm-* 플래그가 있으면 건너뛴다.
prompt_llm() {
    [[ -n "$LLM_BASE_URL" ]] && return 0
    if [[ $ASSUME_YES -eq 1 ]] || [[ -z "$TTY_DEV" ]]; then
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
    read -r -p "  선택 [1-4] (기본 4): " choice < "$TTY_DEV" || true
    case "${choice:-4}" in
        1)
            LLM_BASE_URL="http://localhost:11434/v1"
            LLM_API_KEY="ollama"
            read -r -p "  모델 ID (기본 qwen3:8b): " LLM_MODEL < "$TTY_DEV" || true
            LLM_MODEL="${LLM_MODEL:-qwen3:8b}"
            has ollama || log_warn "ollama 가 설치되어 있지 않습니다 — https://ollama.com 에서 설치 후 'ollama pull $LLM_MODEL'"
            ;;
        2)
            LLM_BASE_URL="https://openrouter.ai/api/v1"
            read -r -p "  OpenRouter API 키: " LLM_API_KEY < "$TTY_DEV" || true
            read -r -p "  모델 ID (기본 qwen/qwen3-235b-a22b): " LLM_MODEL < "$TTY_DEV" || true
            LLM_MODEL="${LLM_MODEL:-qwen/qwen3-235b-a22b}"
            ;;
        3)
            read -r -p "  Base URL (예: http://localhost:4000): " LLM_BASE_URL < "$TTY_DEV" || true
            read -r -p "  API 키 (없으면 엔터): " LLM_API_KEY < "$TTY_DEV" || true
            read -r -p "  모델 ID: " LLM_MODEL < "$TTY_DEV" || true
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
        [[ -n "$INSTANCE"     ]] && export OMK_INSTANCE="$INSTANCE"
        if [[ $FORCE_ENV -eq 1 ]]; then
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" --force >/dev/null
        else
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" >/dev/null
        fi
    ) || die ".env 생성 실패"
    ensure_env_instance_keys
    if [[ -n "$PUBLIC_URL" ]]; then
        set_env_public_url "$PUBLIC_URL"
        EXTERNAL_URL="$PUBLIC_URL"
    fi

    log_ok ".env 준비 완료"
}

# .env 에서 키 하나를 읽는다 (source 하지 않는다 — 값에 공백/특수문자가 있어도 안전).
# `|| true`: 키가 없으면 grep 이 1 을 반환하고 pipefail+set -e 가 스크립트를 죽인다.
env_value() {
    local key="$1"
    [[ -f "$SCRIPT_DIR/.env" ]] || return 0
    grep -E "^${key}=" "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# 키를 값으로 설정한다 — 있으면 그 줄을 바꾸고 없으면 덧붙인다. 파일 권한(600)은 유지.
set_env() {
    local envf="$SCRIPT_DIR/.env" key="$1" val="$2" tmp
    [[ -f "$envf" ]] || die ".env 가 없습니다 ($envf)"
    if grep -qE "^${key}=" "$envf"; then
        tmp="$(mktemp)"
        KEY="$key" VAL="$val" awk 'BEGIN { k = ENVIRON["KEY"] "=" }
            index($0, k) == 1 { print k ENVIRON["VAL"]; next } { print }' "$envf" > "$tmp"
        cat "$tmp" > "$envf"; rm -f "$tmp"
    else
        printf '%s=%s\n' "$key" "$val" >> "$envf"
    fi
}

# ── 5. 의존성 설치 ───────────────────────────────────────────────────────────
install_deps() {
    log_step "5/8 npm 의존성 설치 (workspaces)"
    ( cd "$SCRIPT_DIR" && npm install --no-audit --no-fund ) || die "npm install 실패"
    log_ok "의존성 설치 완료"
    # 설치 속도 때문에 install 중 audit 은 끄고, 끝에 critical 만 경고로 한 번 알린다(설치는 막지 않는다 — F28.8)
    if ! ( cd "$SCRIPT_DIR" && npm audit --omit=dev --audit-level=critical >/dev/null 2>&1 ); then
        log_warn "운영 의존성에 critical 보안 권고가 있습니다 — 'npm audit --omit=dev' 로 확인하세요(설치는 계속합니다)"
    fi
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
        up -d postgres redis \
        || die "PostgreSQL/Redis 기동 실패 — 포트 충돌(port is already allocated)이면 --postgres-port / --redis-port 로 다른 포트를 지정하세요."

    log_info "PostgreSQL 준비 대기"
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
        if docker exec "$PG_CONTAINER" pg_isready -U "$(env_value POSTGRES_USER)" \
             -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
            log_ok "PostgreSQL 준비 완료 (~$((i * HEALTH_INTERVAL))s)"
            break
        fi
        [[ $i -eq $HEALTH_RETRIES ]] && die "PostgreSQL 기동 실패 — docker logs $PG_CONTAINER 확인"
        sleep "$HEALTH_INTERVAL"
    done

    docker exec "$RD_CONTAINER" redis-cli ping >/dev/null 2>&1 \
        && log_ok "Redis 준비 완료" \
        || log_warn "Redis ping 실패 — docker logs $RD_CONTAINER 확인"
}

run_migrations() {
    log_step "7/8 DB 마이그레이션"
    # 마이그레이션 CLI(ts-node)가 @openmake/shared-types 의 dist/ 를 import 한다 —
    # 전체 빌드(8단계) 전에 워크스페이스 패키지만 먼저 빌드해 둔다.
    if [[ ! -f "$SCRIPT_DIR/packages/shared-types/dist/index.js" ]]; then
        log_info "워크스페이스 패키지 빌드 (npm run build:packages)"
        ( cd "$SCRIPT_DIR" && npm run build:packages ) || die "워크스페이스 패키지 빌드 실패"
    fi
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
    # NEXT_PUBLIC_* 는 Next 빌드 시점에 번들로 인라인된다 — 포트 충돌 회피로
    # 3000/52416 이 옮겨진 경우 프론트의 WS 직접 연결 판정이 따라오도록 주입.
    ( cd "$SCRIPT_DIR" && NEXT_PUBLIC_WEB_PORT="$WEB_PORT" NEXT_PUBLIC_WS_PORT="$APP_PORT" \
        npm run build ) || die "빌드 실패"
    log_ok "빌드 완료"
}

start_app() {
    if [[ $NO_START -eq 1 ]]; then
        log_info "--no-start — PM2 기동을 건너뜁니다. './openmake_llm.sh start' 로 직접 기동하세요."
        return 0
    fi

    log_info "PM2 기동 (ecosystem.config.js)"
    # ecosystem.config.js 는 시작 시점 셸 환경의 PORT/OMK_WEB_PORT 를 읽는다 —
    # 명시적으로 넘겨야 --port/--web-port/자동 대체 포트가 PM2 에 반영된다.
    # API_PROXY_TARGET: Next rewrites(/api, /generated)의 런타임 백엔드 주소 —
    # API 포트가 대체된 경우에도 REST 프록시가 올바른 포트를 가리키게 한다.
    ( cd "$SCRIPT_DIR" && PORT="$APP_PORT" OMK_WEB_PORT="$WEB_PORT" \
        API_PROXY_TARGET="http://localhost:$APP_PORT" \
        "$PM2_BIN" start ecosystem.config.js --update-env ) || die "PM2 기동 실패"

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
    "$PM2_BIN" logs "$APP_NAME" --lines 50 --nostream 2>/dev/null || true
    exit 3
}

# ── 외부 접속 설정 ───────────────────────────────────────────────────────────
# 설치 완료 후 다른 기기/네트워크에서 접속할지 물어본다. 승인하면 .env 의
# OMK_APP_URL(공개 주소)과 CORS_ORIGINS(허용 origin)에 외부 주소를 반영하고
# API 를 재시작한다. SERVER_HOST 는 이미 0.0.0.0 이라 바인딩은 열려 있다.
EXTERNAL_URL=""

detect_lan_ip() {
    hostname -I 2>/dev/null | awk '{print $1}' || true
}

prompt_external_access() {
    # --public-url 로 이미 정했으면 묻지 않는다.
    [[ -n "$PUBLIC_URL" ]] && return 0
    # 비대화형(--yes / tty 없음)은 로컬 전용으로 두고, 방법만 summary 에서 안내.
    [[ $ASSUME_YES -eq 1 || -z "$TTY_DEV" ]] && return 0
    echo ""
    confirm "외부(다른 기기/네트워크)에서 이 서비스에 접속하시겠습니까?" || return 0

    local lan_ip host
    lan_ip="$(detect_lan_ip)"
    read -r -p "  접속에 쓸 IP 또는 도메인 [기본 ${lan_ip:-없음}]: " host < "$TTY_DEV" || true
    host="${host:-$lan_ip}"
    if [[ -z "$host" ]]; then
        log_warn "주소가 없어 로컬 전용으로 둡니다 — 나중에 .env 의 OMK_APP_URL/CORS_ORIGINS 를 수정하세요."
        return 0
    fi

    local web_origin="http://${host}:${WEB_PORT}" api_origin="http://${host}:${APP_PORT}"
    local envf="$SCRIPT_DIR/.env" tmp
    set_env_public_url "$web_origin"
    if ! env_value CORS_ORIGINS | tr ',' '\n' | grep -qxF "$api_origin"; then
        tmp="$(mktemp)"
        sed -E "s|^CORS_ORIGINS=(.*)|CORS_ORIGINS=\1,${api_origin}|" "$envf" > "$tmp" && mv "$tmp" "$envf"
    fi
    EXTERNAL_URL="$web_origin"

    if [[ $NO_START -eq 0 ]]; then
        log_info "설정 반영을 위해 API 재시작"
        "${PM2_BIN:-pm2}" restart "$APP_NAME" --update-env >/dev/null 2>&1 \
            || log_warn "재시작 실패 — 수동으로: pm2 restart $APP_NAME"
    fi
    log_ok "외부 접속 설정 완료 — $web_origin"
    log_warn "HTTP 평문 통신입니다. 인터넷에 공개한다면 HTTPS(Caddy 등)를 앞에 두고 .env 의 COOKIE_SECURE=true / ALLOW_INSECURE_COOKIES=false 로 바꾸세요."
}

# ── 마무리 안내 ──────────────────────────────────────────────────────────────
summary_minimal() {
    local admin_pass admin_email llm_url
    admin_pass="$(env_value ADMIN_PASSWORD)"
    admin_email="$(env_value DEFAULT_ADMIN_EMAIL)"
    llm_url="$(env_value LLM_BASE_URL)"

    printf "\n%s══════════════════════════════════════════════════════%s\n" "$C_OK" "$C_RESET"
    printf "%s  OpenMake LLM 설치 완료%s\n" "$C_OK" "$C_RESET"
    printf "%s══════════════════════════════════════════════════════%s\n\n" "$C_OK" "$C_RESET"

    if [[ -n "$INSTANCE" ]]; then
        echo "  인스턴스  $INSTANCE   ($SCRIPT_DIR)"
        echo "  PM2       $APP_NAME / $FRONT_APP_NAME   docker: $PG_CONTAINER / $RD_CONTAINER"
    fi
    echo "  웹 UI     http://localhost:$WEB_PORT"
    echo "  API       http://localhost:$APP_PORT   (health: /health)"
    if [[ -n "$EXTERNAL_URL" ]]; then
        echo "  외부 접속 $EXTERNAL_URL"
    else
        printf "  %s외부 접속을 열려면: .env 의 OMK_APP_URL 과 CORS_ORIGINS 에 외부 주소를 추가 후 재시작%s\n" "$C_DIM" "$C_RESET"
    fi
    echo ""
    # 로그인 식별자는 email 이다 (auth.schema.ts loginSchema — username 필드는 없음).
    echo "  로그인    ${admin_email:-support@openmake.cc}   ← 이메일로 로그인합니다"
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
# 단계별 함수는 scripts/setup/common/(OS 공통)·scripts/setup/linux/ 에 있다 — 부트스트랩 뒤(레포 안)에서만 불러온다.
load_steps() {
    local f
    for f in "$SCRIPT_DIR"/scripts/setup/common/*.sh "$SCRIPT_DIR"/scripts/setup/linux/*.sh; do
        # 단계 파일은 이 스크립트의 전역·도우미를 공유한다 (경로는 런타임 결정).
        # shellcheck source=/dev/null
        . "$f"
    done
}

# get.docker.com 으로 방금 설치하면 현재 셸은 아직 docker 그룹이 아니라 docker 명령이 권한 오류다.
# 재로그인 대신 새 그룹으로 이 스크립트를 다시 실행한다(질문 전이라 답을 다시 받을 일이 없다).
reexec_with_docker_group() {
    [[ $SKIP_DOCKER -eq 1 ]] && return 0
    docker info >/dev/null 2>&1 && return 0
    id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker && return 0   # 이미 그룹인데 실패 — 데몬 문제(아래에서 처리)
    getent group docker 2>/dev/null | grep -qE "[:,]$USER(,|$)" || return 0
    [[ -z "${OMK_DOCKER_REEXEC:-}" ]] || return 0
    has sg || return 0
    log_info "docker 그룹 반영을 위해 설치를 새 그룹으로 이어서 실행합니다 (재로그인 불필요)"
    local cmd
    cmd="$(printf '%q ' bash "$SCRIPT_DIR/install_linux.sh" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"})"
    OMK_DOCKER_REEXEC=1 exec sg docker -c "$cmd"
}

# omk 가 부르는 앱 본체 설치 — 종전 인스톨러 흐름 그대로
main_minimal() {
    printf "\n%s╔══════════════════════════════════════════════════╗%s\n" "$C_INFO" "$C_RESET"
    printf "%s║   OpenMake LLM — 앱 본체 설치 (Linux/WSL2)        ║%s\n" "$C_INFO" "$C_RESET"
    printf "%s╚══════════════════════════════════════════════════╝%s\n" "$C_INFO" "$C_RESET"
    ensure_basics
    ensure_node
    ensure_docker
    ensure_pm2
    ensure_ports
    setup_env
    install_deps
    compose_up
    run_migrations
    build_app
    start_app
    prompt_external_access
    summary_minimal
}

main() {
    ORIG_ARGS=("$@")
    bootstrap_source "$@"
    parse_args "$@"
    resolve_instance

    # OS 판정이 가장 먼저다 — Windows 네이티브는 여기서 WSL2 안내 후 종료된다.
    detect_platform
    load_steps
    if [[ $MINIMAL -eq 1 ]]; then
        main_minimal
        return 0
    fi

    printf "\n%s╔══════════════════════════════════════════════════╗%s\n" "$C_INFO" "$C_RESET"
    printf "%s║   OpenMake LLM — Linux 원샷 설치 (내부망 구성)     ║%s\n" "$C_INFO" "$C_RESET"
    printf "%s╚══════════════════════════════════════════════════╝%s\n" "$C_INFO" "$C_RESET"

    preflight_checks          # systemd·디스크 점검                   (linux/10-prereqs)
    sudo_begin                # sudo 1회 입력 + 끝까지 유지
    ensure_host_packages      # git·poppler·tesseract·python3·setcap
    ensure_uv
    configure_power
    ensure_node
    ensure_docker             # Docker Engine — 방금 설치했으면 docker 그룹으로 재진입
    ensure_pm2
    ask_questions             # 질문 한 번에                          (common/questions)
    setup_tailscale           # DGX 가 다른 네트워크에 있을 때         (linux/40-network)
    prepare_https_proxy       # 프록시 :443 바인딩 권한                (linux/80-finish)

    run_omk_install           # 스택 + 앱 본체 (omk → install_linux.sh --minimal)  (common/stack)

    host_finalize             # 인증서 신뢰 · 백업 · 로그 회전 · 자동 시작 (linux/80-finish)
    summary
}

main "$@"
