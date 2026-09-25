#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — macOS 원샷 설치 (단일 내부망 구성)
# ==============================================================================
# 순정 Mac 에서 이 스크립트 하나로 운영과 같은 구성을 만든다. 역할은 셋으로 나뉜다:
#
#   1) 이 스크립트  — macOS 사전 준비: 질문(한 번에) → Xcode 명령줄 도구 → Homebrew·도구
#                     → 절전 해제 → Node 24 · PM2 · Docker Desktop → (선택) Tailscale
#   2) omk          — 스택 (scripts/env/omk.sh env install): LiteLLM 게이트웨이 · SearXNG ·
#                     샌드박스 이미지 · 운영 기능 프로필 · DGX 연결 · 내부망 HTTPS · 뷰어 · Discord
#   3) 이 스크립트 --minimal — omk 가 부르는 앱 본체: .env · PostgreSQL/Redis(빈 DB) · 빌드 · PM2
#   … 끝으로 호스트 마무리: 루트 인증서 신뢰 · DB 백업 예약 · 로그 회전 · 재부팅 자동 시작
#
# 전제: Mac·DGX·사용자 PC 가 하나의 내부망에 있고 외부에는 공개하지 않는다.
#       설치·운영 중 인터넷으로 나가는 연결은 가능하다 (brew·npm·Docker 이미지·검색).
#       DGX 는 같은 LAN(직접) 또는 다른 네트워크(Tailscale) 둘 다 지원한다.
#       소스는 omk 규칙 위치($OMK_ROOT/<환경>/llm, 기본 ~/.openmake/online/llm)에 둔다.
#
# 사용:
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install_mac.sh | bash
#   ./install_mac.sh                         # 대화형 — 처음에 질문을 모두 받고 이후 무인 진행
#   ./install_mac.sh --yes --dgx-host 192.168.0.50 --vllm-api-key <키>
#   ./install_mac.sh --yes --llm-provider openrouter --llm-model qwen/qwen3-235b-a22b:free --llm-api-key sk-or-...
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
#     --llm-base-url URL      custom 일 때 OpenAI 호환 주소
#   접속:
#     --host NAME|IP          접속 주소 (기본 <컴퓨터이름>.local)
#     --http                  HTTPS 없이 HTTP 로만 (복사 버튼·웹 푸시가 동작하지 않음)
#   선택 항목:
#     --with-artifact-viewer  아티팩트 공유 뷰어 (별도 포트 origin)
#     --with-discord          Discord 봇 (--discord-token 필요)
#     --discord-token TOKEN   이 서버 전용 새 봇 토큰 (운영 봇 토큰 재사용 금지)
#     --no-sandbox-images     MCP·작업 샌드박스 이미지 빌드 생략 (샌드박스 기능 꺼짐)
#   기타:
#     --instance NAME         환경 이름 (기본 online) — 같은 호스트에 나란히 설치
#     --minimal               앱 본체만 (omk 가 부르는 모드 — 직접 쓸 일은 드물다)
#     --public-url URL        (--minimal) 공개 주소 — OMK_APP_URL/CORS 반영, https 면 secure cookie
#     --skip-build · --no-start · --force-env · --port · --web-port · --postgres-port · --redis-port
#
# 환경변수: OMK_ROOT(~/.openmake) · OMK_REF(브랜치/태그) · OMK_REPO_URL
# 재실행 안전(idempotent): 이미 된 단계는 건너뛰거나 갱신만 한다.
# 종료 코드: 0 성공 / 1 사용법·전제조건 오류 / 2 설치 단계 실패 / 3 health check 실패
# ==============================================================================

# 전역 변수는 scripts/setup/{common,mac}/*.sh(런타임 source)가 읽는다 — shellcheck 가 파일 간 사용을 못 본다.
# shellcheck disable=SC2034
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd -P )"
readonly SCRIPT_DIR
readonly DEFAULT_REPO_URL="https://github.com/openmake/openmake_llm.git"
readonly NODE_MAJOR=24
readonly TOOLCHAIN_DIR="$SCRIPT_DIR/.openmake"
readonly TOOLCHAIN_ENV="$TOOLCHAIN_DIR/toolchain.env"
OMK_ROOT="${OMK_ROOT:-$HOME/.openmake}"
readonly OMK_DEFAULT_ENV="online"     # omk 의 기본(무접미사) 인스턴스
readonly HEALTH_RETRIES=45
readonly HEALTH_INTERVAL=2

# ── 옵션 기본값 ──────────────────────────────────────────────────────────────
ASSUME_YES=0; MINIMAL=0
SKIP_BUILD=0; NO_START=0; FORCE_ENV=0; SKIP_DOCKER=0
APP_PORT="${OMK_PORT:-}"; WEB_PORT="${OMK_WEB_PORT:-}"
PG_PORT="${OMK_POSTGRES_PORT:-}"; RD_PORT="${OMK_REDIS_PORT:-}"
INSTANCE="${OMK_INSTANCE:-}"
APP_NAME=""; FRONT_APP_NAME=""; PG_CONTAINER=""; RD_CONTAINER=""

# 질문 답 (common/questions.sh 가 채운다 — 플래그가 있으면 그 값을 쓴다)
LLM_MODE=""            # dgx | external | keep(기존 게이트웨이 설정 유지) | direct(--minimal)
DGX_VIA=""             # lan | tailscale
DGX_HOST=""; VLLM_API_KEY=""; TAILSCALE_AUTHKEY=""
LLM_PROVIDER=""; LLM_MODEL=""; LLM_API_KEY=""; LLM_BASE_URL=""
APP_HOST=""; HTTPS_MODE=""   # 1 | 0
PUBLIC_URL=""                # --minimal 전용
WITH_VIEWER=""; WITH_DISCORD=""; DISCORD_TOKEN=""
SANDBOX_IMAGES=1

# 설치 후 할 일 — 줄바꿈으로 누적해 summary 가 출력한다.
TODO_LIST=""

# ── 출력 ─────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_INFO=$'\033[1;34m'; C_OK=$'\033[1;32m'
    C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'
else
    C_RESET=""; C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""
fi

log_info() { printf "%s[INFO]%s  %s\n" "$C_INFO" "$C_RESET" "$*"; }
log_ok()   { printf "%s[OK]%s    %s\n" "$C_OK"   "$C_RESET" "$*"; }
log_warn() { printf "%s[WARN]%s  %s\n" "$C_WARN" "$C_RESET" "$*"; }
log_err()  { printf "%s[ERR]%s   %s\n" "$C_ERR"  "$C_RESET" "$*" >&2; }
log_step() { printf "\n%s━━ %s ━━%s\n" "$C_INFO" "$*" "$C_RESET"; }
die()      { log_err "$*"; exit 2; }
add_todo() { TODO_LIST="${TODO_LIST}${TODO_LIST:+$'\n'}$*"; }
has()      { command -v "$1" >/dev/null 2>&1; }

# 대화형 판정: stdin 이 파이프여도(curl | bash) /dev/tty 가 열리면 물을 수 있다.
TTY_DEV=""
if [[ -t 0 ]] || { : < /dev/tty; } 2>/dev/null; then
    TTY_DEV="/dev/tty"
fi
readonly TTY_DEV
interactive() { [[ $ASSUME_YES -eq 0 && -n "$TTY_DEV" ]]; }

# y/N 확인 — 비대화형이면 기본값($2: y|n, 기본 y)으로 답한다.
confirm() {
    local prompt="$1" def="${2:-y}" reply=""
    if ! interactive; then
        [[ "$def" == "y" ]]; return
    fi
    local hint="[y/N]"; [[ "$def" == "y" ]] && hint="[Y/n]"
    read -r -p "$(printf '%s%s%s %s: ' "$C_WARN" "$prompt" "$C_RESET" "$hint")" reply < "$TTY_DEV" || true
    reply="${reply:-$def}"
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

# ── .env 도우미 (source 하지 않는다 — 값에 공백·특수문자가 있어도 안전) ─────────
ENV_FILE="$SCRIPT_DIR/.env"

env_value() {
    [[ -f "$ENV_FILE" ]] || return 0
    grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# 키를 값으로 설정한다 — 있으면 그 줄을 바꾸고 없으면 덧붙인다. 파일 권한(600)은 유지.
set_env() {
    local key="$1" val="$2" tmp
    [[ -f "$ENV_FILE" ]] || die ".env 가 없습니다 ($ENV_FILE)"
    if grep -qE "^${key}=" "$ENV_FILE"; then
        tmp="$(mktemp)"
        KEY="$key" VAL="$val" awk 'BEGIN { k = ENVIRON["KEY"] "=" }
            index($0, k) == 1 { print k ENVIRON["VAL"]; next } { print }' "$ENV_FILE" > "$tmp"
        cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
    else
        printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    fi
}

# 설치 중에만 유효한 PATH 를 파일로 남겨 openmake_llm.sh·omk 가 이어받게 한다.
persist_path() {
    local dir="$1"
    mkdir -p "$TOOLCHAIN_DIR"
    if [[ -f "$TOOLCHAIN_ENV" ]] && grep -qF "$dir" "$TOOLCHAIN_ENV" 2>/dev/null; then
        return 0
    fi
    {
        [[ -f "$TOOLCHAIN_ENV" ]] || echo "# install_mac.sh 가 생성 — openmake_llm.sh·omk 가 자동으로 source 한다."
        echo "export PATH=\"$dir:\$PATH\""
    } >> "$TOOLCHAIN_ENV"
}

# sudo 비밀번호를 한 번 받고 설치가 끝날 때까지 유지한다 (기본 유효시간 5분 < 설치 시간).
# 전체 설치는 질문 직후 호출하고, --minimal 은 sudo 가 실제로 필요한 단계에서만 호출된다.
SUDO_KEEPALIVE_PID=""
sudo_begin() {
    [[ -n "$SUDO_KEEPALIVE_PID" ]] && return 0
    log_info "관리자 권한(sudo)이 필요합니다. 비밀번호를 한 번만 입력하세요."
    sudo -v || die "sudo 인증 실패"
    ( while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit 0; done ) &
    SUDO_KEEPALIVE_PID=$!
    trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT
}

# ── Xcode 명령줄 도구 ────────────────────────────────────────────────────────
# 순정 macOS 의 /usr/bin/git·python3 는 실제 도구가 아니라 설치 창을 띄우는 대체 실행 파일이다
# — `command -v git` 은 성공하지만 실행하면 실패한다. 판정은 xcode-select -p 로 한다.
clt_installed() { xcode-select -p >/dev/null 2>&1; }

ensure_clt() {
    clt_installed && return 0
    log_step "Xcode 명령줄 도구 설치"
    log_info "git·컴파일러가 들어 있는 Apple 명령줄 도구를 설치합니다 (5~15분, sudo 필요)."
    # Homebrew 설치기와 같은 방식: 설치 요청 표시 파일을 만들면 softwareupdate 목록에 나타난다.
    local marker="/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress" label=""
    sudo_begin
    touch "$marker"
    label="$(softwareupdate -l 2>/dev/null | grep -E '^[[:space:]]*\* Label: Command Line Tools' \
        | sed -E 's/^[[:space:]]*\* Label: //' | tail -1 || true)"
    if [[ -n "$label" ]]; then
        log_info "softwareupdate 로 설치: $label"
        sudo softwareupdate -i "$label" --verbose || log_warn "softwareupdate 설치 실패 — 설치 창으로 다시 시도합니다."
    fi
    rm -f "$marker"
    if ! clt_installed; then
        xcode-select --install >/dev/null 2>&1 || true
        log_warn "화면에 뜬 '명령줄 개발자 도구' 설치 창에서 [설치] → [동의] 를 눌러 주세요. 끝날 때까지 기다립니다."
        local i
        for ((i = 1; i <= 360; i++)); do
            clt_installed && break
            (( i % 6 == 0 )) && log_info "명령줄 도구 설치 대기 중… ($((i * 10 / 60))분)"
            sleep 10
        done
    fi
    clt_installed || die "Xcode 명령줄 도구 설치를 확인하지 못했습니다 — 'xcode-select --install' 완료 후 재실행하세요."
    log_ok "Xcode 명령줄 도구: $(xcode-select -p)"
}

# ── 부트스트랩 ───────────────────────────────────────────────────────────────
# 전체 설치는 소스를 omk 규칙 위치($OMK_ROOT/<환경>/llm)에서 실행한다 — omk 가 그 소스를 재사용한다.
# 다른 곳(curl 파이프·수동 클론)에서 실행되면 그 위치로 받고(있으면 재사용) 그 안의 사본으로 재진입한다.
# --minimal(omk 가 부르는 앱 본체 설치)은 어디서 실행되든 그 자리에서 진행한다 (omk dev 는 작업 클론에서 부른다).
bootstrap_source() {
    # 다른 OS 면 소스를 받기 전에 멈춘다.
    [[ "$(uname -s)" == "Darwin" ]] || { log_err "macOS 전용입니다 — Linux/WSL 은 ./install_linux.sh (또는 ./install.sh 가 자동 선택)"; exit 1; }
    local a prev="" inst="$INSTANCE" minimal=0
    for a in "$@"; do
        [[ "$prev" == "--instance" ]] && inst="$a"
        [[ "$a" == "--minimal" ]] && minimal=1
        prev="$a"
    done
    local in_repo=0
    [[ -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/openmake_llm.sh" ]] && in_repo=1
    [[ $minimal -eq 1 && $in_repo -eq 1 ]] && return 0

    local target="$OMK_ROOT/${inst:-$OMK_DEFAULT_ENV}/llm"
    [[ -d "$target" ]] && target="$( cd "$target" && pwd -P )"
    [[ "$SCRIPT_DIR" == "$target" ]] && return 0

    log_step "부트스트랩 — 소스 위치 $target"
    if [[ -f "$target/package.json" && -f "$target/install_mac.sh" && -d "$target/.git" ]]; then
        log_ok "기존 소스 재사용 — 최신화하려면: git -C \"$target\" pull"
    elif [[ -d "$target" ]] && [[ -n "$(ls -A "$target" 2>/dev/null)" ]]; then
        die "$target 이 비어있지 않은데 OpenMake LLM 소스가 아닙니다 — OMK_ROOT 로 다른 위치를 지정하세요."
    else
        local repo_url="${OMK_REPO_URL:-$DEFAULT_REPO_URL}" ref="${OMK_REF:-}" tag=""
        # 클론에서 실행했으면 그 브랜치를 받는다 (원격에 있어야 한다).
        if [[ -z "$ref" && $in_repo -eq 1 ]] && git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
            ref="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
            [[ "$ref" == "HEAD" ]] && ref=""
        fi
        ensure_clt   # git 은 명령줄 도구가 있어야 진짜로 동작한다 (대체 실행 파일 함정)
        # online 은 최신 릴리스 태그만 따른다(omk 규칙 — main HEAD 를 운영에 올리지 않는다). omk 와 같은 모양
        # (로컬 브랜치 'release')으로 받아 두면 omk 가 설치 도중 이 소스를 다른 ref 로 옮기지 않는다.
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
            if git -C "$target" cat-file -e "$tag:install_mac.sh" 2>/dev/null; then
                git -C "$target" checkout -q -B release "$tag" || die "릴리스 $tag 체크아웃 실패"
                log_ok "최신 릴리스 $tag (로컬 브랜치 release)"
            else
                log_warn "최신 릴리스 $tag 에 install_mac.sh 가 없어 $ref 로 설치합니다 — 이 환경은 릴리스 대신 $ref 를 따릅니다."
            fi
        fi
    fi
    log_ok "소스 준비 완료 → $target/install_mac.sh 로 재진입"
    exec bash "$target/install_mac.sh" "$@"
}

usage() {
    local self="${BASH_SOURCE[0]:-}"
    if [[ -f "$self" ]]; then
        # 머리말 주석 블록만 — 첫 빈 줄이나 명령 줄에서 멈춘다.
        sed -nE '2,/^([^#]|$)/p' "$self" | sed '$d' | sed 's/^# \{0,1\}//'
    else
        echo "전체 도움말: 클론된 레포에서 ./install_mac.sh --help"
    fi
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -y|--yes)               ASSUME_YES=1 ;;
            --minimal)              MINIMAL=1 ;;
            --dgx-host)             DGX_HOST="${2:-}"; LLM_MODE="dgx"; shift ;;
            --dgx-via)              DGX_VIA="${2:-}"; shift ;;
            --vllm-api-key)         VLLM_API_KEY="${2:-}"; shift ;;
            --tailscale-authkey)    TAILSCALE_AUTHKEY="${2:-}"; shift ;;
            --llm-provider)         LLM_PROVIDER="${2:-}"; LLM_MODE="external"; shift ;;
            --llm-model)            LLM_MODEL="${2:-}"; shift ;;
            --llm-api-key)          LLM_API_KEY="${2:-}"; shift ;;
            --llm-base-url)         LLM_BASE_URL="${2:-}"; shift ;;
            --host)                 APP_HOST="${2:-}"; shift ;;
            --public-url)           PUBLIC_URL="${2:-}"; shift ;;
            --http)                 HTTPS_MODE=0 ;;
            --with-artifact-viewer) WITH_VIEWER=1 ;;
            --with-discord)         WITH_DISCORD=1 ;;
            --discord-token)        DISCORD_TOKEN="${2:-}"; shift ;;
            --no-sandbox-images)    SANDBOX_IMAGES=0 ;;
            --skip-docker)          SKIP_DOCKER=1 ;;
            --skip-build)           SKIP_BUILD=1 ;;
            --no-start)             NO_START=1 ;;
            --force-env)            FORCE_ENV=1 ;;
            --port)                 APP_PORT="${2:-}"; shift ;;
            --web-port)             WEB_PORT="${2:-}"; shift ;;
            --postgres-port)        PG_PORT="${2:-}"; shift ;;
            --redis-port)           RD_PORT="${2:-}"; shift ;;
            --instance)             INSTANCE="${2:-}"; shift ;;
            -h|--help)              usage; exit 0 ;;
            *) log_err "알 수 없는 옵션: $1"; echo ""; usage; exit 1 ;;
        esac
        shift
    done
    case "$DGX_VIA" in ""|lan|tailscale) ;; *) log_err "--dgx-via 는 lan 또는 tailscale: $DGX_VIA"; exit 1 ;; esac
}

# 재실행이면 .env 의 OMK_INSTANCE 가 진실 — 다른 인스턴스를 같은 디렉터리에 덮어쓰지 않게 막는다.
resolve_instance() {
    local from_env
    from_env="$(env_value OMK_INSTANCE)"
    if [[ -n "$from_env" ]]; then
        if [[ -n "$INSTANCE" && "$INSTANCE" != "$from_env" ]]; then
            die "이 디렉터리는 '$from_env' 인스턴스입니다 (.env OMK_INSTANCE) — '--instance $INSTANCE' 로 덮어쓸 수 없습니다."
        fi
        INSTANCE="$from_env"
    fi
    if [[ -n "$INSTANCE" ]] && ! [[ "$INSTANCE" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
        die "인스턴스 이름은 소문자·숫자·하이픈만 가능합니다 (예: test): '$INSTANCE'"
    fi
    [[ "$INSTANCE" == "$OMK_DEFAULT_ENV" ]] && INSTANCE=""
    local suffix="${INSTANCE:+-$INSTANCE}"
    APP_NAME="openmake-llm$suffix"
    FRONT_APP_NAME="openmake-next$suffix"
    PG_CONTAINER="openmake$suffix-postgres"
    RD_CONTAINER="openmake$suffix-redis"
    if [[ -n "$INSTANCE" ]]; then
        : "${APP_PORT:=52417}" "${WEB_PORT:=3010}" "${PG_PORT:=5433}" "${RD_PORT:=6380}"
    else
        : "${APP_PORT:=52416}" "${WEB_PORT:=3000}" "${PG_PORT:=5432}" "${RD_PORT:=6379}"
    fi
}
# omk 환경 이름 — 기본 인스턴스는 online
omk_env_name() { printf '%s' "${INSTANCE:-$OMK_DEFAULT_ENV}"; }

ARCH=""
check_platform() {
    [[ "$(uname -s)" == "Darwin" ]] || { log_err "macOS 전용입니다 — Linux/WSL 은 ./install_linux.sh"; exit 1; }
    case "$(uname -m)" in
        arm64)  ARCH="arm64" ;;
        x86_64) ARCH="x64" ;;
        *) log_err "지원하지 않는 아키텍처: $(uname -m)"; exit 1 ;;
    esac
    log_ok "플랫폼: macOS $(sw_vers -productVersion) / $ARCH"
}

# 단계별 함수는 scripts/setup/common/(OS 공통)·scripts/setup/mac/ 에 있다 — 부트스트랩 뒤(레포 안)에서만 불러온다.
readonly OS_LABEL="macOS"
load_steps() {
    local f
    for f in "$SCRIPT_DIR"/scripts/setup/common/*.sh "$SCRIPT_DIR"/scripts/setup/mac/*.sh; do
        # 단계 파일은 이 스크립트의 전역·도우미를 공유한다 (경로는 런타임 결정).
        # shellcheck source=/dev/null
        . "$f"
    done
}

# omk 가 부르는 앱 본체 설치 — .env · DB · 빌드 · PM2 (스택은 omk 가 붙인다)
main_minimal() {
    ask_questions
    ensure_clt
    ensure_homebrew
    ensure_brew_tools
    ensure_node
    ensure_pm2
    ensure_docker
    ensure_ports
    setup_env
    install_deps
    compose_up
    run_migrations
    build_app
    start_app
    summary_minimal
}

main() {
    bootstrap_source "$@"
    parse_args "$@"
    resolve_instance

    if [[ $MINIMAL -eq 0 ]]; then
        printf "\n%s╔══════════════════════════════════════════════════╗%s\n" "$C_INFO" "$C_RESET"
        printf "%s║   OpenMake LLM — macOS 원샷 설치 (내부망 구성)     ║%s\n" "$C_INFO" "$C_RESET"
        printf "%s╚══════════════════════════════════════════════════╝%s\n" "$C_INFO" "$C_RESET"
    fi
    check_platform
    load_steps
    if [[ $MINIMAL -eq 1 ]]; then
        main_minimal
        return 0
    fi

    preflight_checks          # FileVault·자동 로그인 안내            (10-prereqs)
    ask_questions             # 질문 한 번에                          (common/questions)
    sudo_begin                # sudo 1회 입력 + 끝까지 유지

    ensure_clt
    ensure_homebrew           # Homebrew · 호스트 도구 · 전원 설정     (10-prereqs)
    ensure_brew_tools
    configure_power
    ensure_node               # Node 24 · PM2 · Docker Desktop        (30-toolchain)
    ensure_pm2
    ensure_docker
    setup_tailscale           # DGX 가 다른 네트워크에 있을 때         (40-network)

    run_omk_install           # 스택 + 앱 본체 (omk → install_mac.sh --minimal)  (common/stack)

    host_finalize             # 인증서 신뢰 · 백업 · 로그 회전 · 자동 시작 (80-finish)
    summary
}

main "$@"
