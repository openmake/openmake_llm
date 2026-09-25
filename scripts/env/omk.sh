#!/usr/bin/env bash
# ==============================================================================
# omk — OpenMake 환경 매니저 (dev / staging / online)
# ==============================================================================
# openmake_llm + openmake_bench 를 한 호스트에 여러 환경으로 나란히 설치·갱신·리셋한다.
# 모든 무거운 일은 기존 도구에 위임한다 — install.sh(툴체인·.env·DB·빌드·PM2),
# openmake_llm.sh(update/deploy/start/stop), uninstall.sh(역순 제거). 이 스크립트는
# "어느 디렉터리에서, 어떤 인스턴스 이름으로, 어떤 브랜치를" 만 정하고 bench 와
# 리버스 프록시(Caddy, PM2 로 운영)를 그 옆에 붙인다.
#
# 원칙 — omk 는 값을 기억하지 않는다:
#   · 포트는 install.sh 가 할당하고 omk 는 각 환경의 .env 를 읽기만 한다
#   · PM2 앱·docker 컨테이너·볼륨 이름은 환경 이름에서 파생한다 (.env 없이도 reset 가능)
#   · 경로는 OMK_ROOT(기본 ~/.openmake) 하나에서만 파생한다
#   · 도메인·리포 URL·브랜치는 플래그/환경변수로만 받는다 (스크립트에 없음)
#
# 환경 규칙:
#   online   = install.sh 의 기본(무접미사) 인스턴스 — 소스의 기본 포트가 곧 online 포트.
#              PM2 openmake-llm / openmake-next / openmake-bench, docker openmake-postgres …
#   그 외     = 이름 있는 인스턴스 (install.sh --instance <env>) — 포트는 install.sh 규칙으로
#              한 칸 옆(52417/3010/5433/6380)부터, 점유 시 빈 포트로 자동 이동.
#              PM2 openmake-llm-<env> …, docker openmake-<env>-postgres …
#   dev      = 작업 클론 안에서 `omk dev …` 로 띄운다 (~/.openmake 아래에 두지 않음).
#
# 디렉터리:
#   $OMK_ROOT/<env>/llm      openmake_llm 클론 (.env 포함)
#   $OMK_ROOT/<env>/bench    openmake_bench 클론 (.env, data/ 포함)
#   $OMK_ROOT/<env>/logs     PM2 로그
#   $OMK_ROOT/caddy          프록시 설정 (Caddyfile + caddy.d/<env>.caddy)
#   $OMK_ROOT/bin            caddy 바이너리(필요 시), omk 래퍼
#
# 사용:
#   # 아무것도 없는 PC 에서 한 줄 (macOS / Linux / Windows→WSL2 안에서)
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
#     | bash -s -- env install staging --public-url https://staging-chat.example.com
#
#   omk env install <env> [--ref BR] [--bench-ref BR] [--public-url URL] [--no-bench] [--no-proxy] [--no-searxng] [--no-runtime-images] [--tailscale] [--host H]…
#                         [--no-litellm] [--no-default-model] [--qwen-vllm-base U --bge-vllm-base U --vllm-api-key K]
#                         [--llm-base-url U --llm-api-key K --llm-model M] [--autoupdate|--no-autoupdate]
#                         [--ops-profile] [--dgx-host H] [--https-host H] [--artifact-viewer] [--discord-token T]
#                         ↑ 운영 구성 옵션 (install_mac.sh 가 켠다 — 주지 않으면 기존 동작 그대로):
#                           --ops-profile     운영 기능 플래그(scripts/setup/profiles/ops-features.env)·웹 푸시 키·작업 공간·스크래퍼 파이썬
#                           --dgx-host H      DGX vLLM(:8002 채팅·:8003 임베딩·:8005 음악)을 게이트웨이 업스트림으로 + 연결 확인
#                           --https-host H    내부망 HTTPS (Caddy tls internal · :443) — 사내 기기는 루트 인증서를 한 번 신뢰 등록
#                           --artifact-viewer 아티팩트 공유 뷰어 (기본 인스턴스 전용) · --discord-token T  Discord 봇 (이 서버 전용 새 토큰)
#   omk env update  <env> [--if-behind] [--no-backup]       # llm(ff-only→build→migrate→restart) → bench → proxy
#   omk env reset   <env> [--keep-data] [--keep-env] [--purge-images] [--reinstall] [--yes]
#   omk env status|start|stop|logs <env>
#   omk env expose <env> [--tailscale] [--host H]…      # 다른 기기에서 프록시 포트로 보기 — 호스트를 CORS 에 허용(.env 에 기억)
#   omk env backup  <env> [--schedule ['CRON']] [--off] [--list] [--dry-run]   # DB 덤프 → $OMK_ROOT/backups/<env> (reset 에도 남는다)
#   omk env autoupdate <env> [--every 'CRON'] [--off]   # 선택 — 기본은 수동 배포. PM2 cron 앱 omk-updater-<env>
#   omk proxy status|reload|render <env>
#   omk dev setup [--no-searxng] · omk dev up|down|status|reset [api|web|bench|deps|all]
#   omk dev up [대상] [--tailscale] [--host H]…   # 다른 기기에서 보기 — 호스트를 CORS·Next·vite 에 허용(.env 에 기억)
#
# 환경변수:
#   OMK_ROOT(~/.openmake)  OMK_REPO_URL  OMKB_REPO_URL  OMK_CADDY_VERSION  OMK_CADDY_ADMIN(localhost:2019)
#   OMK_AUTOUPDATE_CRON('*/10 * * * *')  OMK_DEV_LLM  OMK_DEV_BENCH  OMKB_PORT_BASE(9400)  OMK_PROXY_PORT_BASE(33000)
#   OMK_SEARXNG_IMAGE(searxng/searxng:latest)  OMK_SEARXNG_PORT_BASE(8888)  OMK_NET_PROBE_URLS  OMK_SEARCH_PROBE_QUERY
#   OMK_FORCE_FOREIGN=1   같은 인스턴스 이름을 쓰는 다른 설치본의 컨테이너·PM2 앱도 건드린다 (기본: 거부)
#
# 종료 코드: 0 성공 / 1 사용법·전제조건 / 2 단계 실패 / 3 health check 실패
# ==============================================================================
set -euo pipefail

# ── 필수 하드코딩 (이것뿐이다) ─────────────────────────────────────────────────
readonly OMK_DEFAULT_REPO_URL="https://github.com/openmake/openmake_llm.git"
readonly OMKB_DEFAULT_REPO_URL="https://github.com/openmake/openmake_bench.git"
readonly OMK_DEFAULT_ENV="online"                 # 기본(무접미사) 인스턴스로 매핑되는 환경 이름
readonly OMK_PROXY_APP="omk-proxy"                # PM2 에 등록되는 Caddy 앱 이름 (호스트당 1개)
readonly CADDY_VERSION_FALLBACK="2.10.0"          # GitHub API 조회가 막힌 폐쇄망에서만 쓰는 최후 값

OMK_ROOT="${OMK_ROOT:-$HOME/.openmake}"
OMK_REPO_URL="${OMK_REPO_URL:-$OMK_DEFAULT_REPO_URL}"
OMKB_REPO_URL="${OMKB_REPO_URL:-$OMKB_DEFAULT_REPO_URL}"
OMKB_PORT_BASE="${OMKB_PORT_BASE:-9400}"          # bench 빈 포트 탐색 시작점 (기본 인스턴스가 비어 있으면 그대로)
OMK_PROXY_PORT_BASE="${OMK_PROXY_PORT_BASE:-33000}"
OMK_CADDY_ADMIN="${OMK_CADDY_ADMIN:-localhost:2019}"
OMK_AUTOUPDATE_CRON="${OMK_AUTOUPDATE_CRON:-*/10 * * * *}"
OMK_SEARXNG_IMAGE="${OMK_SEARXNG_IMAGE:-searxng/searxng:latest}"
OMK_SEARXNG_PORT_BASE="${OMK_SEARXNG_PORT_BASE:-8888}"   # .env.example 의 SEARXNG_URL 예시 포트. 점유 시 다음 빈 포트
OMK_BACKUP_CRON="${OMK_BACKUP_CRON:-30 3 * * *}"          # omk env backup --schedule 의 기본 주기 (매일 03:30)
OMK_LITELLM_PORT_BASE="${OMK_LITELLM_PORT_BASE:-13401}"  # LiteLLM 게이트웨이 빈 포트 탐색 시작점
OMK_LITELLM_SPEC="${OMK_LITELLM_SPEC:-litellm[proxy]}"    # pip 설치 대상 — 버전 고정: 'litellm[proxy]==X.Y.Z'
# 기본 모델 — 업스트림을 주지 않은 설치본도 바로 채팅이 되게 하는 최소 모델. 호스트당 llama.cpp 서버 하나(PM2), 환경들이 공유한다.
# 작업 클론의 핫 리로드 개발 서버('omk dev up')가 쓰는 인스턴스 이름 — 환경 'dev'(~/.openmake/dev)와 컨테이너·볼륨·포트가
# 겹치지 않게 따로 둔다. 같은 호스트에서 개발 서버와 환경 dev 를 동시에 쓸 수 있다.
OMK_LOCAL_INSTANCE="local"
OMK_LLAMACPP_APP="omk-llamacpp"
OMK_LLAMACPP_TAG="${OMK_LLAMACPP_TAG:-b10964}"                          # llama.cpp 릴리스 태그 (v0.4.1 에 대응)
OMK_LLAMACPP_PORT_BASE="${OMK_LLAMACPP_PORT_BASE:-18080}"
# 모델 선택: 명시한 환경변수 > 호스트에 기억된 값($OMK_ROOT/llamacpp/model.conf) > 아래 기본값. default_model_resolve 가 채운다.
OMK_DEFAULT_MODEL_HF="${OMK_DEFAULT_MODEL_HF:-}"       # HuggingFace GGUF (repo:quant). 기본 Qwen/Qwen3-1.7B-GGUF:Q8_0 — 도구 호출이 되는 가장 작은 선(1.8GB)
OMK_DEFAULT_MODEL_NAME="${OMK_DEFAULT_MODEL_NAME:-}"   # 앱·게이트웨이에 보이는 모델 이름. 기본 qwen3-1.7b
OMK_DEFAULT_MODEL_CTX="${OMK_DEFAULT_MODEL_CTX:-}"     # 기본 16384
# 외부 연결 점검 대상(하나라도 열리면 온라인) · 검색 동작 확인용 질의
OMK_NET_PROBE_URLS="${OMK_NET_PROBE_URLS:-https://duckduckgo.com https://www.bing.com https://www.wikipedia.org}"
OMK_SEARCH_PROBE_QUERY="${OMK_SEARCH_PROBE_QUERY:-wikipedia}"

# curl | bash 에서는 BASH_SOURCE 가 비어 있다 — 그때는 "레포 밖" 으로 취급한다.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
[[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]] && SCRIPT_DIR="$( cd "$( dirname "$SCRIPT_PATH" )" && pwd )"

# ── 출력 ─────────────────────────────────────────────────────────────────────
C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_RESET=$'\033[0m'
[[ -t 1 ]] || { C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_RESET=""; }
log_info() { printf "%s[INFO]%s  %s\n" "$C_INFO" "$C_RESET" "$*"; }
log_ok()   { printf "%s[OK]%s    %s\n" "$C_OK"   "$C_RESET" "$*"; }
log_warn() { printf "%s[WARN]%s  %s\n" "$C_WARN" "$C_RESET" "$*"; }
log_err()  { printf "%s[ERR]%s   %s\n" "$C_ERR"  "$C_RESET" "$*" >&2; }
log_step() { printf "\n%s━━ %s ━━%s\n" "$C_INFO" "$*" "$C_RESET"; }
die()      { log_err "$*"; exit 2; }
usage_die(){ log_err "$*"; echo ""; usage; exit 1; }
has()      { command -v "$1" >/dev/null 2>&1; }

ASSUME_YES=0
TTY_DEV=""; [[ -r /dev/tty ]] && TTY_DEV="/dev/tty"
confirm() {
    [[ $ASSUME_YES -eq 1 ]] && return 0
    [[ -n "$TTY_DEV" ]] || return 0          # 비대화형(CI·cron)은 자동 승인
    local reply=""
    read -r -p "$(printf '%s%s%s [y/N]: ' "$C_WARN" "$1" "$C_RESET")" reply < "$TTY_DEV" || true
    case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

usage() {
    if [[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]]; then
        sed -n '/^# 사용:/,/^# 종료 코드/p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
    else
        echo "omk env install|update|reset|status|start|stop|logs|autoupdate <env> · omk proxy render|reload|status · omk dev setup|up|down|status|reset"
    fi
}

# ── 플랫폼 ───────────────────────────────────────────────────────────────────
platform_guard() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            log_err "Windows 네이티브 셸에서는 실행할 수 없습니다 — WSL2(Ubuntu) 안에서 실행하세요."
            echo "  PowerShell 에서 (WSL2·Docker Desktop 준비 후 WSL 로 재진입):"
            echo "    irm https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.ps1 | iex"
            exit 1 ;;
    esac
}

# ── .env 읽기/쓰기 (source 하지 않는다 — 값의 공백/특수문자 안전) ──────────────
dotenv_get() { # $1=file $2=key
    [[ -f "$1" ]] || return 0
    local v
    v="$(grep -E "^${2}=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
    if [[ "$v" =~ ^\"(.*)\"$ ]] || [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
    printf '%s' "$v"
}
# 키가 없으면 붙이고, 있으면 값을 바꾼다. sed -i 는 macOS/Linux 인자가 달라 쓰지 않는다.
dotenv_set() { # $1=file $2=key $3=value
    local file="$1" key="$2" val="$3" tmp
    touch "$file"
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        tmp="$(mktemp)"
        awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k && !done {print k"="v; done=1; next} {print}' "$file" > "$tmp" && mv "$tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$val" >> "$file"
    fi
}
dotenv_unset() { # $1=file $2=key
    [[ -f "$1" ]] && grep -qE "^${2}=" "$1" || return 0
    local tmp; tmp="$(mktemp)"; grep -vE "^${2}=" "$1" > "$tmp" || true; mv "$tmp" "$1"
}
dotenv_ensure() { # $1=file $2=key $3=default — 없을 때만 붙인다 (기존 값 존중)
    [[ -n "$(dotenv_get "$1" "$2")" ]] || dotenv_set "$1" "$2" "$3"
}

# ── 환경 이름 → 경로/이름 파생 ──────────────────────────────────────────────
validate_env() {
    [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || usage_die "환경 이름은 소문자·숫자·하이픈 1~32자: '$1'"
    [[ "$1" != "$OMK_LOCAL_INSTANCE" ]] || usage_die "'$1' 은 작업 클론의 개발 서버('omk dev …')가 쓰는 이름입니다 — 다른 환경 이름을 고르세요"
}
env_dir()    { printf '%s/%s' "$OMK_ROOT" "$1"; }
llm_dir()    { printf '%s/%s/llm' "$OMK_ROOT" "$1"; }
bench_dir()  { printf '%s/%s/bench' "$OMK_ROOT" "$1"; }
logs_dir()   { printf '%s/%s/logs' "$OMK_ROOT" "$1"; }
proxy_dir()  { printf '%s/caddy' "$OMK_ROOT"; }
env_suffix() { [[ "$1" == "$OMK_DEFAULT_ENV" ]] && printf '' || printf -- '-%s' "$1"; }
# 기본 ref — 장수 브랜치는 main 하나다. staging 은 main HEAD 를, dev 는 --ref 로 feature/* 를 따른다.
# online(기본 인스턴스)은 **최신 릴리스 태그**를 따른다('release') — main 은 개발이 모이는 곳이고, staging 에서 확인하기 전의
# main 을 운영·외부 설치자가 받지 않게 한다. 어느 환경이든 --ref release 로 같은 방식을 고를 수 있다.
env_default_ref() { [[ "$1" == "$OMK_DEFAULT_ENV" ]] && printf 'release' || printf 'main'; }
latest_release_tag() { # $1=리포 URL 또는 클론 경로 → vX.Y.Z 중 가장 높은 것
    git ls-remote --tags --refs "$1" 2>/dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}
# 릴리스를 따르는 클론은 upstream 없는 로컬 브랜치 'release' 에 있다(.env 의 OMK_TRACK=release). openmake_llm.sh update 의
# `git pull --ff-only` 는 브랜치 upstream 이 있어야 하므로, omk 가 태그까지 fast-forward 한 뒤 같은 체인의 뒷부분(deploy)을 부른다.
release_checkout() { # $1=dir $2=tag
    git -C "$1" checkout -q -B release "$2" || die "릴리스 $2 체크아웃 실패: $1"
}
release_behind() { # $1=dir → 새 릴리스가 있으면 0. RELEASE_TAG 에 최신 태그
    git -C "$1" fetch -q --tags --prune 2>/dev/null || return 1
    RELEASE_TAG="$(latest_release_tag "$1")"; [[ -n "$RELEASE_TAG" ]] || return 1
    [[ "$(git -C "$1" rev-parse HEAD)" != "$(git -C "$1" rev-parse "$RELEASE_TAG^{commit}")" ]]
}
RELEASE_TAG=""

# 이름 규칙은 install.sh / ecosystem.config.js / infra/docker-compose.yml 과 같다.
pm2_names() { # $1=env → llm next discord bench litellm updater backup
    local s; s="$(env_suffix "$1")"
    printf 'openmake-llm%s openmake-next%s openmake-discord%s openmake-bench%s openmake-litellm%s omk-updater-%s omk-backup-%s' "$s" "$s" "$s" "$s" "$s" "$1" "$1"
}
docker_containers() { local s; s="$(env_suffix "$1")"; printf 'openmake%s-postgres openmake%s-redis openmake%s-searxng' "$s" "$s" "$s"; }
searxng_name()      { printf 'openmake%s-searxng' "$(env_suffix "$1")"; }
docker_volumes()    { local s; s="$(env_suffix "$1")"; printf 'openmake%s_pgdata openmake%s_redisdata' "$s" "$s"; }

# ── 소유권 가드 ──────────────────────────────────────────────────────────────
# 이름은 환경 이름에서 파생되므로, omk 밖의 설치본이 같은 인스턴스 이름을 쓰고 있으면
# (예: 구 레이아웃 ~/.openmake/chat-staging 의 OMK_INSTANCE=staging) install 은 그 DB 컨테이너를
# 가로채고 reset 은 그 볼륨을 지운다. 컨테이너의 compose 라벨과 PM2 앱의 cwd 로 주인을 확인해,
# 이 환경 디렉터리 밖의 것이면 손대지 않는다. 주인을 알 수 없으면(라벨 없음) 통과시킨다.
is_foreign_path() { # $1=실제 소유 경로 $2=이 환경의 디렉터리 → 0 이면 남의 것
    [[ -n "$1" ]] || return 1
    case "$1" in "$2"|"$2"/*) return 1 ;; *) return 0 ;; esac
}
# compose 가 띄운 것은 compose 라벨로, omk 가 docker run 으로 띄운 것(SearXNG)은 omk.owner_dir 라벨로 주인을 안다.
container_workdir() { docker inspect -f '{{ or (index .Config.Labels "com.docker.compose.project.working_dir") (index .Config.Labels "omk.owner_dir") }}' "$1" 2>/dev/null || true; }
pm2_app_cwd() { # $1=name
    has pm2 && has node || return 0
    pm2 jlist 2>/dev/null | node -e '
        const n=process.argv[1]; let l=[]; try{l=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{}
        const p=l.find(x=>x.name===n); process.stdout.write(p?String(p.pm2_env.pm_cwd||""):"")' "$1" 2>/dev/null || true
}
pm2_dump_has_any() { # $1="name name …" → 0 이면 dump 에 그중 하나가 저장돼 있다
    local dump="${PM2_HOME:-$HOME/.pm2}/dump.pm2"
    [[ -f "$dump" ]] && has node || return 1
    node -e '
        const names=new Set(process.argv[2].split(/\s+/).filter(Boolean)); let l=[];
        try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
        process.exit(l.some(p=>names.has(p.name))?0:1)' "$dump" "$1" 2>/dev/null
}
assert_env_owned() { # $1=env
    [[ "${OMK_FORCE_FOREIGN:-}" == "1" ]] && return 0
    local env="$1" edir c n owner; edir="$(env_dir "$1")"
    if has docker; then
        for c in $(docker_containers "$env"); do
            owner="$(container_workdir "$c")"
            is_foreign_path "$owner" "$edir" && die "컨테이너 $c 는 다른 설치본($owner)의 것입니다 — 환경 '$env' 와 인스턴스 이름이 겹칩니다. 다른 환경 이름을 쓰거나 그 설치본을 먼저 정리하세요(그 디렉터리에서 ./uninstall.sh). 그래도 진행하려면 OMK_FORCE_FOREIGN=1"
        done
    fi
    for n in $(pm2_names "$env"); do
        owner="$(pm2_app_cwd "$n")"
        is_foreign_path "$owner" "$edir" && die "PM2 앱 $n 은 다른 설치본($owner)의 것입니다 — 환경 '$env' 와 인스턴스 이름이 겹칩니다. OMK_FORCE_FOREIGN=1 로만 진행합니다."
    done
    return 0
}

# install.sh 가 홈에 설치한 Node/PM2 의 PATH 를 이어받는다 (시스템에 없어도 동작).
load_toolchain() { # $1=llm dir
    # shellcheck source=/dev/null
    [[ -f "$1/.openmake/toolchain.env" ]] && . "$1/.openmake/toolchain.env" || true
}
require_pm2() { has pm2 || die "pm2 를 찾을 수 없습니다 — 해당 환경의 llm 을 먼저 설치하세요 (install.sh 가 PM2 를 준비합니다)"; }

# ── 포트 ─────────────────────────────────────────────────────────────────────
port_in_use()   { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
find_free_port() { # $1=start
    local p="$1" i
    for ((i = 0; i < 200; i++)); do port_in_use "$p" || { printf '%s' "$p"; return 0; }; p=$((p + 1)); done
    return 1
}
# llm .env 에서 API/웹 포트. 웹 포트는 install.sh 규칙대로 OMK_WEB_PORT 또는 OMK_APP_URL 끝 포트.
llm_api_port() { local v; v="$(dotenv_get "$1/.env" PORT)"; printf '%s' "${v:-52416}"; }
llm_web_port() {
    local v; v="$(dotenv_get "$1/.env" OMK_WEB_PORT)"
    [[ -n "$v" ]] || v="$(dotenv_get "$1/.env" OMK_APP_URL | sed -nE 's|.*:([0-9]+)/?$|\1|p')"
    printf '%s' "${v:-3000}"
}

# ── git ──────────────────────────────────────────────────────────────────────
ensure_git() {
    has git && return 0
    log_warn "git 미설치 — 설치를 시도합니다"
    if has brew; then brew install git
    elif has apt-get; then sudo apt-get update -qq && sudo apt-get install -y git
    elif has dnf; then sudo dnf install -y git
    elif has yum; then sudo yum install -y git
    elif has pacman; then sudo pacman -Sy --noconfirm git
    elif has zypper; then sudo zypper install -y git
    else die "git 을 설치할 수 없습니다 — 직접 설치 후 재실행하세요."
    fi
    has git || die "git 설치 후에도 실행 파일을 찾을 수 없습니다."
}
# reset --keep-env 가 남긴 .env 를 **설치 전에** 되돌린다. 설치 뒤에 되돌리면 늦다 — install.sh 가 새
# POSTGRES_PASSWORD 로 DB 볼륨을 이미 초기화해서, 복원된 옛 비밀번호로는 다음 기동부터 인증이 실패한다
# (2026-09-18 검증에서 실제로 "password authentication failed" 로 깨졌다). 먼저 놓아 두면 gen-env 는
# 보수 모드로 기존 값을 지키고, 새 볼륨은 그 비밀번호로 만들어진다.
restore_env_backup() { # $1=대상 디렉터리 $2=llm|bench
    local src="${OMK_RESTORE_ENV_FROM:-}"
    [[ -n "$src" && -f "$src/$2.env" && ! -f "$1/.env" ]] || return 0
    cp "$src/$2.env" "$1/.env" && log_ok "$2 .env 복원 (설치 전) ← $src"
}
clone_or_keep() { # $1=url $2=ref $3=dir $4=label
    if [[ -f "$3/package.json" && -d "$3/.git" ]]; then
        log_ok "$4 소스 재사용: $3 ($(git -C "$3" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
    elif [[ -d "$3" ]] && [[ -n "$(ls -A "$3" 2>/dev/null)" ]]; then
        die "$3 이 비어있지 않은데 $4 소스가 아닙니다 — 'omk env reset' 으로 정리하거나 OMK_ROOT 를 바꾸세요."
    else
        log_info "git clone --branch $2 $1 → $3"
        git clone --branch "$2" "$1" "$3" || die "$4 clone 실패 ($1 @ $2)"
    fi
}
# npm install 이 다시 쓴 lock 을 되돌린다 — 그대로 두면 update 의 "미커밋 변경" 검사가 막는다.
# openmake_llm.sh update 도 같은 정리를 하지만, 그 수정 이전 ref 를 설치한 환경은 스스로 못 빠져나온다.
restore_lockfiles() { # $1=dir
    local f
    for f in $(git -C "$1" status --porcelain 2>/dev/null | awk '{print $2}'); do
        case "$f" in package-lock.json|*/package-lock.json) git -C "$1" checkout -- "$f" && log_info "lock 되돌림: $1/$f" ;; esac
    done
    return 0
}
# 원격이 앞서 있는지 (fetch 포함). 0=뒤처짐(갱신 필요) 1=최신
repo_behind() { # $1=dir
    git -C "$1" fetch -q --prune 2>/dev/null || return 0
    local h u
    h="$(git -C "$1" rev-parse HEAD 2>/dev/null || echo a)"
    u="$(git -C "$1" rev-parse '@{u}' 2>/dev/null || echo b)"
    [[ "$h" != "$u" ]]
}

# ── health ───────────────────────────────────────────────────────────────────
wait_http() { # $1=url $2=label $3=retries(기본 45) — 2초 간격
    local url="$1" label="$2" n="${3:-45}" i
    for ((i = 1; i <= n; i++)); do
        if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then log_ok "$label health OK (~$((i * 2))s)"; return 0; fi
        sleep 2
    done
    log_err "$label health 실패: $url"; return 3
}

# ==============================================================================
# bench
# ==============================================================================
bench_pm2_name() { printf 'openmake-bench%s' "$(env_suffix "$1")"; }

# bench .env 를 만들거나 보수한다 — llm 과 짝이 맞는 값만 채우고, 있는 값은 건드리지 않는다.
# OMK_API_KEY 는 자동 발급이 불가(웹 UI 에서 chat 스코프 키 발급) → 비워 두고 summary 에서 안내.
bench_ensure_env() { # $1=bench dir $2=env $3=api port $4=web port $5=auth(1|0)
    local dir="$1" env="$2" api="$3" web="$4" auth="$5" envf="$1/.env" port
    port="$(dotenv_get "$envf" OMKB_PORT)"
    if [[ -z "$port" ]]; then
        port="$(find_free_port "$OMKB_PORT_BASE")" || die "bench 빈 포트 탐색 실패 ($OMKB_PORT_BASE~)"
    fi
    [[ -f "$envf" ]] || printf '# openmake_bench — omk 가 생성. 실값은 이 파일에만 둔다 (sources.yaml 은 ${VAR} 참조만).\n' > "$envf"
    dotenv_set    "$envf" OMK_BASE_URL   "http://localhost:$api/api/v1"
    dotenv_ensure "$envf" OMK_API_KEY    ""
    dotenv_set    "$envf" OMK_WEB_PORT   "$web"
    dotenv_set    "$envf" OMKB_PORT      "$port"
    dotenv_ensure "$envf" OMKB_DATA_DIR  "./data"
    dotenv_ensure "$envf" OMKB_LOG_DIR   "$(logs_dir "$env")"
    if [[ "$env" != "$OMK_DEFAULT_ENV" ]]; then dotenv_set "$envf" OMKB_INSTANCE "$env"; fi
    [[ "$auth" -eq 1 ]] && dotenv_ensure "$envf" OMKB_AUTH openmake
    printf '%s' "$port"
}

bench_build() { # $1=dir
    log_info "bench 의존성 설치 + 빌드"
    ( cd "$1" && npm ci --no-audit --no-fund && ( cd web && npm ci --no-audit --no-fund ) && npm run build ) \
        || die "bench 빌드 실패"
}

bench_pm2_start() { # $1=dir $2=env
    require_pm2
    local name; name="$(bench_pm2_name "$2")"
    # 등록된 앱에 `pm2 start ecosystem` 을 하면 PM2 는 저장해 둔 옛 exec_path·설정으로 재시작할 뿐
    # ecosystem 의 바뀐 script 를 반영하지 않는다(2026-09-18 검증: start.js 로 바꿨는데 server.js 가 계속 떴다).
    # 지우고 새로 등록해 ecosystem 이 언제나 진실이 되게 한다 — bench 는 무상태 API 라 잠깐의 공백은 무해하다.
    if [[ -f "$1/ecosystem.config.cjs" ]]; then
        pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null 2>&1 || true
        ( cd "$1" && pm2 start ecosystem.config.cjs --update-env >/dev/null ) || die "bench PM2 기동 실패"
    else
        # 구 브랜치(ecosystem 없음) 폴백 — `npm start` 를 거친다. dist/server.js 를 PM2 로 직접 띄우면
        # server.ts 의 직접 실행 판정(process.argv[1])이 PM2 컨테이너 스크립트를 보고 거짓이 되어,
        # 서버는 안 뜨고 프로세스만 online 으로 남는다. npm 의 자식 node 는 argv[1] 이 맞다.
        if pm2 describe "$name" >/dev/null 2>&1; then pm2 restart "$name" --update-env >/dev/null
        else ( cd "$1" && pm2 start npm --name "$name" --cwd "$1" --time -- start >/dev/null ); fi
    fi
    log_ok "PM2 $name"
}

bench_install() { # $1=env $2=ref $3=llm dir
    local env="$1" ref="$2" ldir="$3" bdir api web port
    bdir="$(bench_dir "$env")"
    log_step "bench 설치 ($env @ $ref)"
    clone_or_keep "$OMKB_REPO_URL" "$ref" "$bdir" "openmake_bench"
    restore_env_backup "$bdir" bench
    bench_build "$bdir"
    api="$(llm_api_port "$ldir")"; web="$(llm_web_port "$ldir")"
    mkdir -p "$(logs_dir "$env")"
    port="$(bench_ensure_env "$bdir" "$env" "$api" "$web" 1)"
    bench_pm2_start "$bdir" "$env"
    wait_http "http://localhost:$port/api/health" "bench" 30 || exit 3
}

bench_update() { # $1=env
    local env="$1" bdir name; bdir="$(bench_dir "$env")"; name="$(bench_pm2_name "$env")"
    [[ -d "$bdir/.git" ]] || { log_info "bench 없음 — 생략"; return 0; }
    log_step "bench 갱신 ($env)"
    if [[ -n "$(git -C "$bdir" status --porcelain 2>/dev/null)" ]]; then
        die "bench 에 미커밋 로컬 변경이 있어 갱신을 중단합니다: git -C \"$bdir\" status"
    fi
    git -C "$bdir" fetch --prune -q && git -C "$bdir" pull --ff-only || die "bench git pull(ff-only) 실패"
    bench_build "$bdir"
    bench_pm2_start "$bdir" "$env"
    wait_http "http://localhost:$(dotenv_get "$bdir/.env" OMKB_PORT)/api/health" "bench" 30 || exit 3
}

# ==============================================================================
# proxy (Caddy under PM2)
# ==============================================================================
CADDY_BIN=""
caddy_platform() { # → "<os> <arch>" (caddy 릴리스 파일명 규칙)
    local os arch
    case "$(uname -s)" in Darwin) os=mac ;; Linux) os=linux ;; *) return 1 ;; esac
    case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=armv7 ;; *) return 1 ;; esac
    printf '%s %s' "$os" "$arch"
}
caddy_latest_version() {
    [[ -n "${OMK_CADDY_VERSION:-}" ]] && { printf '%s' "${OMK_CADDY_VERSION#v}"; return 0; }
    local v
    v="$(curl -fsSL --max-time 8 https://api.github.com/repos/caddyserver/caddy/releases/latest 2>/dev/null \
        | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
    printf '%s' "${v:-$CADDY_VERSION_FALLBACK}"
}
proxy_ensure_binary() {
    if has caddy; then CADDY_BIN="$(command -v caddy)"; return 0; fi
    CADDY_BIN="$OMK_ROOT/bin/caddy"
    [[ -x "$CADDY_BIN" ]] && return 0
    local plat os arch ver url tmp
    plat="$(caddy_platform)" || die "이 플랫폼용 caddy 바이너리를 자동으로 받을 수 없습니다 — caddy 를 직접 설치해 PATH 에 두세요."
    os="${plat% *}"; arch="${plat#* }"; ver="$(caddy_latest_version)"
    url="https://github.com/caddyserver/caddy/releases/download/v${ver}/caddy_${ver}_${os}_${arch}.tar.gz"
    log_info "caddy $ver 다운로드 ($os/$arch) → $CADDY_BIN"
    mkdir -p "$OMK_ROOT/bin"; tmp="$(mktemp -d)"
    curl -fsSL "$url" -o "$tmp/caddy.tgz" || die "caddy 다운로드 실패: $url (OMK_CADDY_VERSION 으로 버전 지정 가능)"
    tar -xzf "$tmp/caddy.tgz" -C "$tmp" caddy && mv "$tmp/caddy" "$CADDY_BIN" && chmod +x "$CADDY_BIN"
    rm -rf "$tmp"
}
proxy_template() {
    # 레포 안의 템플릿이 SoT. 레포 밖(curl 실행)이면 설치된 llm 의 것을 쓴다.
    local cand
    for cand in "${SCRIPT_DIR:+$SCRIPT_DIR/../caddy/instance.caddy.tmpl}" "$1/scripts/caddy/instance.caddy.tmpl"; do
        [[ -n "$cand" && -f "$cand" ]] && { printf '%s' "$cand"; return 0; }
    done
    return 1
}
proxy_root_caddyfile() {
    local dir; dir="$(proxy_dir)"; mkdir -p "$dir/caddy.d"
    # 이미 있으면 그대로 — 단 omk 가 만든 옛 파일에 skip_install_trust 가 없으면 다시 쓴다(내부 HTTPS 의
    # tls internal 이 PM2 아래에서 시스템 신뢰 저장소 설치를 시도하지 않게. 신뢰 등록은 설치 스크립트가 한다).
    if [[ -f "$dir/Caddyfile" ]]; then
        grep -q 'skip_install_trust' "$dir/Caddyfile" && return 0
        head -1 "$dir/Caddyfile" | grep -q '^# omk 가 생성' || return 0
    fi
    cat > "$dir/Caddyfile" <<EOF
# omk 가 생성 — 환경별 블록은 caddy.d/<env>.caddy (omk proxy render <env>). 이 파일은 손대지 않는다.
{
	admin $OMK_CADDY_ADMIN
	skip_install_trust
}
import $dir/caddy.d/*.caddy
EOF
}
# llm/bench .env 의 포트로 caddy.d/<env>.caddy 를 만든다. 프록시 포트는 .env(OMK_PROXY_PORT)가 진실.
proxy_render() { # $1=env
    local env="$1" ldir tmpl dir out pport api web bench_port
    ldir="$(llm_dir "$env")"; dir="$(proxy_dir)"
    [[ -f "$ldir/.env" ]] || die "$ldir/.env 없음 — llm 이 설치되지 않았습니다"
    tmpl="$(proxy_template "$ldir")" || die "instance.caddy.tmpl 을 찾을 수 없습니다"
    proxy_root_caddyfile
    pport="$(dotenv_get "$ldir/.env" OMK_PROXY_PORT)"
    if [[ -z "$pport" ]]; then
        pport="$(find_free_port "$OMK_PROXY_PORT_BASE")" || die "프록시 빈 포트 탐색 실패 ($OMK_PROXY_PORT_BASE~)"
        dotenv_set "$ldir/.env" OMK_PROXY_PORT "$pport"
    fi
    dotenv_set "$ldir/.env" OMK_PROXY_DIR "$dir"        # openmake_llm.sh sync_caddyfile 이 이 키를 보고 호스트 Caddyfile 복사를 건너뛴다
    api="$(llm_api_port "$ldir")"; web="$(llm_web_port "$ldir")"
    bench_port="$(dotenv_get "$(bench_dir "$env")/.env" OMKB_PORT)"
    out="$dir/caddy.d/$env.caddy"
    sed -e "s|{{ENV}}|$env|g" -e "s|{{PROXY_PORT}}|$pport|g" -e "s|{{API_PORT}}|$api|g" \
        -e "s|{{WEB_PORT}}|$web|g" -e "s|{{BENCH_PORT}}|${bench_port:-0}|g" "$tmpl" > "$out"
    log_ok "프록시 설정 → $out (:$pport → api :$api / web :$web)"
    env_apply_origins "$ldir"
    https_render "$env"
}
# 프록시 포트로 접속하면 브라우저의 Origin 은 http://<호스트>:<프록시포트> 이고 채팅 소켓도 그 주소로 붙는다
# (use-chat-socket.ts). 서버는 CORS_ORIGINS 와 정확히 일치하는 Origin 만 받으므로 그 주소를 넣어 둔다 —
# localhost 는 항상, 다른 기기용 호스트는 .env 의 OMK_ENV_HOSTS(CSV · `omk env expose`)에서.
ORIGINS_CHANGED=0
env_apply_origins() { # $1=llm dir
    local envf="$1/.env" pport hosts h add before after
    ORIGINS_CHANGED=0
    pport="$(dotenv_get "$envf" OMK_PROXY_PORT)"; [[ -n "$pport" ]] || return 0
    hosts="$(csv_union "localhost,127.0.0.1" "$(dotenv_get "$envf" OMK_ENV_HOSTS)")"
    add=""; for h in $(printf '%s' "$hosts" | tr ',' ' '); do add="${add:+$add,}http://$h:$pport"; done
    before="$(dotenv_get "$envf" CORS_ORIGINS)"; after="$(csv_union "$before" "$add")"
    [[ "$before" == "$after" ]] || { dotenv_set "$envf" CORS_ORIGINS "$after"; ORIGINS_CHANGED=1; }
    return 0
}
proxy_running() { has pm2 && pm2 describe "$OMK_PROXY_APP" >/dev/null 2>&1; }
# 프록시는 호스트당 하나(PM2 앱 이름·admin 포트가 고정)다. 다른 OMK_ROOT 에서 띄운 것에 이쪽 설정을 reload 하면
# 그쪽 환경들의 라우팅이 통째로 사라진다 — PM2 앱의 cwd 가 이 OMK_ROOT 의 caddy 디렉터리일 때만 우리 것이다.
proxy_is_ours() { proxy_running && [[ "$(pm2_app_cwd "$OMK_PROXY_APP")" == "$(proxy_dir)" ]]; }
proxy_start_or_reload() {
    require_pm2; proxy_ensure_binary
    local dir; dir="$(proxy_dir)"
    "$CADDY_BIN" validate --config "$dir/Caddyfile" --adapter caddyfile >/dev/null 2>&1 \
        || die "Caddyfile 검증 실패: $dir/Caddyfile"
    if proxy_running && ! proxy_is_ours; then
        die "프록시($OMK_PROXY_APP)가 다른 OMK_ROOT($(pm2_app_cwd "$OMK_PROXY_APP"))에서 돌고 있습니다 — 이쪽 설정으로 덮어쓰지 않습니다."
    fi
    if proxy_is_ours; then
        "$CADDY_BIN" reload --config "$dir/Caddyfile" --adapter caddyfile --address "$OMK_CADDY_ADMIN" >/dev/null 2>&1 \
            && { log_ok "프록시 reload"; return 0; }
        log_warn "reload 실패 — PM2 재시작으로 대체"; pm2 restart "$OMK_PROXY_APP" >/dev/null; return 0
    fi
    # 다른 caddy(brew services 등)가 같은 admin 포트를 쥐고 있으면 우리 프록시가 못 뜬다 — 먼저 알린다.
    local aport="${OMK_CADDY_ADMIN##*:}"
    if port_in_use "$aport"; then
        die "caddy admin 포트 $aport 를 다른 프로세스가 사용 중 — 기존 caddy 를 멈추거나(brew services stop caddy) OMK_CADDY_ADMIN 을 바꾸세요."
    fi
    ( cd "$dir" && pm2 start "$CADDY_BIN" --name "$OMK_PROXY_APP" --interpreter none --time \
        -- run --config "$dir/Caddyfile" --adapter caddyfile >/dev/null ) || die "프록시 PM2 기동 실패"
    log_ok "PM2 $OMK_PROXY_APP (caddy)"
}
proxy_remove() { # $1=env
    local f; f="$(proxy_dir)/caddy.d/$1.caddy"
    rm -f "$(proxy_dir)/caddy.d/$1-https.caddy"
    [[ -f "$f" ]] || return 0
    rm -f "$f"; log_ok "프록시 설정 제거: $f"
    proxy_is_ours && { proxy_ensure_binary; "$CADDY_BIN" reload --config "$(proxy_dir)/Caddyfile" --adapter caddyfile --address "$OMK_CADDY_ADMIN" >/dev/null 2>&1 || true; }
    return 0
}
cmd_proxy() {
    local sub="${1:-}"; shift || true
    case "$sub" in
        render) [[ -n "${1:-}" ]] || usage_die "omk proxy render <env>"; validate_env "$1"; load_toolchain "$(llm_dir "$1")"; proxy_render "$1"; proxy_start_or_reload ;;
        reload) load_toolchain "$(llm_dir "$OMK_DEFAULT_ENV")"; proxy_start_or_reload ;;
        status) has pm2 && pm2 describe "$OMK_PROXY_APP" 2>/dev/null | grep -E 'status|uptime' || log_info "프록시 PM2 앱 없음"
                ls -1 "$(proxy_dir)/caddy.d/" 2>/dev/null || true ;;
        *) usage_die "omk proxy render <env> | reload | status" ;;
    esac
}

# ==============================================================================
# omk 래퍼 — $OMK_ROOT/bin/omk 가 설치된 환경 중 하나의 omk.sh 로 exec 한다
# ==============================================================================
install_wrapper() {
    mkdir -p "$OMK_ROOT/bin"
    cat > "$OMK_ROOT/bin/omk" <<'EOF'
#!/usr/bin/env bash
# omk 래퍼 — 설치된 환경(online → staging → 그 외)의 scripts/env/omk.sh 로 넘긴다. omk 가 생성.
root="${OMK_ROOT:-$HOME/.openmake}"
for e in online staging $(ls -1 "$root" 2>/dev/null); do
    s="$root/$e/llm/scripts/env/omk.sh"
    [[ -f "$s" ]] && exec bash "$s" "$@"
done
echo "omk.sh 를 찾을 수 없습니다 — 먼저 환경을 설치하세요: curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh | bash -s -- env install <env>" >&2
exit 1
EOF
    chmod +x "$OMK_ROOT/bin/omk"
    case ":$PATH:" in *":$OMK_ROOT/bin:"*) ;; *) log_info "PATH 에 추가하면 어디서나 'omk' 로 실행: export PATH=\"$OMK_ROOT/bin:\$PATH\"" ;; esac
}

# ==============================================================================
# env autoupdate — PM2 cron 앱 (OS 스케줄러 대신 PM2 로 3 OS 동일)
# ==============================================================================
updater_name() { printf 'omk-updater-%s' "$1"; }
# ── DB 백업 ───────────────────────────────────────────────────────────────────
# 기준은 레포의 scripts/backups/db-backup.sh 다(pg_dump -Fc · 보존기간 정리 · 무결성 확인 · --dry-run). omk 는 "어느 환경의
# 것을 어디에"만 정한다: 기본 위치는 **환경 디렉터리 밖** $OMK_ROOT/backups/<env> — `env reset` 으로 환경을 지워도 남는다.
# 그 환경의 .env 에 BACKUP_DIR 이 있으면 그쪽을 따른다. 매일 돌리려면 --schedule(PM2 cron 앱 omk-backup-<env>).
backup_dir()  { local v; v="$(dotenv_get "$(llm_dir "$1")/.env" BACKUP_DIR)"; printf '%s' "${v:-$OMK_ROOT/backups/$1}"; }
backup_name() { printf 'omk-backup-%s' "$1"; }
env_backup_run() { # $1=env [추가 인자…]
    local env="$1" ldir; shift; ldir="$(llm_dir "$env")"
    [[ -x "$ldir/scripts/backups/db-backup.sh" ]] || { log_warn "$ldir 에 db-backup.sh 가 없습니다"; return 1; }
    ( cd "$ldir" && BACKUP_DIR="$(backup_dir "$env")" ./scripts/backups/db-backup.sh "$@" )
}
cmd_env_backup() { # env [--schedule ['CRON']] [--off] [--list] [--dry-run]
    local env="$1"; shift; local mode="run" cron="$OMK_BACKUP_CRON" ldir name
    ldir="$(llm_dir "$env")"; name="$(backup_name "$env")"
    [[ -f "$ldir/.env" ]] || die "$ldir/.env 없음 — 'omk env install $env' 먼저"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --schedule) mode="schedule"; if [[ -n "${2:-}" && "${2:-}" != --* ]]; then cron="$2"; shift; fi ;;
            --off) mode="off" ;; --list) mode="list" ;; --dry-run) mode="dry" ;;
            *) usage_die "알 수 없는 옵션: $1" ;;
        esac; shift
    done
    load_toolchain "$ldir"
    case "$mode" in
        run)  env_backup_run "$env" || die "백업 실패 ($env)"; log_ok "백업 위치: $(backup_dir "$env")" ;;
        dry)  env_backup_run "$env" --dry-run ;;
        list) ls -lh "$(backup_dir "$env")" 2>/dev/null || log_info "백업 없음: $(backup_dir "$env")" ;;
        off)  require_pm2; pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null && log_ok "$name 제거" || log_info "$name 없음" ;;
        schedule)
            require_pm2
            [[ -f "$ldir/scripts/env/omk.sh" ]] || die "$ldir 에 omk.sh 가 없습니다 (브랜치가 오래됐을 수 있음)"
            pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null 2>&1 || true
            ( cd "$ldir" && pm2 start "$ldir/scripts/env/omk.sh" --name "$name" --interpreter bash --no-autorestart \
                --cron-restart "$cron" --time -- env backup "$env" >/dev/null ) || die "$name 등록 실패"
            log_ok "$name 등록 — '$cron' 마다 백업 → $(backup_dir "$env") (pm2 logs $name)" ;;
    esac
}

cmd_env_autoupdate() { # env [--every CRON] [--off]
    local env="$1"; shift; local cron="$OMK_AUTOUPDATE_CRON" off=0
    while [[ $# -gt 0 ]]; do case "$1" in --every) cron="${2:-}"; shift ;; --off) off=1 ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift; done
    local ldir name; ldir="$(llm_dir "$env")"; name="$(updater_name "$env")"
    load_toolchain "$ldir"; require_pm2
    if [[ $off -eq 1 ]]; then
        pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null && log_ok "$name 제거" || log_info "$name 없음"
        return 0
    fi
    [[ -f "$ldir/scripts/env/omk.sh" ]] || die "$ldir 에 omk.sh 가 없습니다 (브랜치가 오래됐을 수 있음)"
    pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null 2>&1 || true
    # autorestart 끄고 cron 으로만 깨운다 — 한 번 돌고 종료하는 one-shot 잡.
    ( cd "$ldir" && pm2 start "$ldir/scripts/env/omk.sh" --name "$name" --interpreter bash --no-autorestart \
        --cron-restart "$cron" --time -- env update "$env" --if-behind --yes >/dev/null ) || die "$name 등록 실패"
    log_ok "$name 등록 — '$cron' 마다 원격이 앞서면 갱신 (pm2 logs $name)"
}

# ==============================================================================
# 웹 검색 (SearXNG) — 설치하면 바로 검색이 되게, 외부 연결이 없으면 조용히 꺼 둔다
# ==============================================================================
# 키 없는 기본 제공자(Wikipedia·뉴스·DDG)만으로는 일반 웹 검색이 거의 0건이다. 그래서 SearXNG 를
# Postgres·Redis 와 같은 급의 환경 인프라로 기본 설치한다. Base 는 .env 의 SEARXNG_URL 만 본다
# (mcp/web-search/providers.ts) — omk 는 컨테이너를 띄우고 그 한 줄을 적는다.
#   .env 키:  SEARXNG_URL            Base 가 읽는 값
#            OMK_SEARXNG_PORT       omk 가 띄웠다는 표시 겸 포트 (없는데 SEARXNG_URL 이 있으면 사용자 것 — 손대지 않음)
#            OMK_SEARXNG=off        --no-searxng 로 뺀 환경 (update 때도 다시 켜지 않음)
#            OMK_SEARCH_OFFLINE=1   외부 연결이 없어 꺼 둔 상태 (WEB_SEARCH_FETCH_TIMEOUT_MS 를 omk 가 낮춰 둠)
SEARCH_CHANGED=0   # searxng_ensure 가 .env 를 바꿨으면 1 — 호출자가 API 를 재시작한다
net_online() { local u; for u in $OMK_NET_PROBE_URLS; do curl -fsS --max-time 6 -o /dev/null "$u" 2>/dev/null && return 0; done; return 1; }
searxng_count() { # $1=url → 실제 검색 결과 건수 (실패 0)
    local n; n="$(curl -fsS --max-time 20 "$1/search?q=$OMK_SEARCH_PROBE_QUERY&format=json" 2>/dev/null | grep -o '"url": *"' | wc -l | tr -d ' ' || true)"
    printf '%s' "${n:-0}"
}
searxng_write_settings() { # $1=settings.yml — 기본 설정 위에 필요한 것만 덮는다
    local key
    # openssl 우선 — PATH 에 다른 od 가 앞서면 -An 을 모른다(실측: ~/.local/bin/od).
    if has openssl; then key="$(openssl rand -hex 32)"; else key="$(/usr/bin/od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"; fi
    # formats 에 json 이 없으면 Base 의 호출(/search?format=json)이 403 이다. limiter 는 loopback 전용이라 끈다.
    cat > "$1" <<EOF
use_default_settings: true
server:
  secret_key: "$key"
  limiter: false
  image_proxy: false
search:
  formats:
    - html
    - json
engines:
  # 응답이 불안정해 결과 지연만 만드는 엔진 (운영 실측)
  - name: brave
    disabled: true
  - name: startpage
    disabled: true
  - name: mojeek
    disabled: true
EOF
    chmod 644 "$1"   # 컨테이너 안의 비루트 사용자가 읽어야 한다
}
search_mark_offline() { # $1=.env — Base 에는 웹 검색 스위치가 없다. 제공자별 대기(기본 12초)만이라도 줄인다.
    [[ "$(dotenv_get "$1" OMK_SEARCH_OFFLINE)" == "1" ]] && return 0          # 이미 꺼 둔 상태 — 매번 경고하지 않는다
    log_warn "외부 연결이 없습니다 — 웹 검색을 꺼 둡니다 (연결되면 'omk env update' 가 다시 켭니다)"
    dotenv_set "$1" OMK_SEARCH_OFFLINE 1; SEARCH_CHANGED=1
    [[ -n "$(dotenv_get "$1" WEB_SEARCH_FETCH_TIMEOUT_MS)" ]] || dotenv_set "$1" WEB_SEARCH_FETCH_TIMEOUT_MS 2000   # 사용자가 정한 값은 존중
}
search_forget() { # $1=.env — omk 가 적은 주소를 걷어낸다. 컨테이너가 없는데 주소만 남으면 Base 가 죽은 주소를 두드린다.
    [[ -n "$(dotenv_get "$1" OMK_SEARXNG_PORT)" ]] || return 0
    dotenv_unset "$1" SEARXNG_URL; dotenv_unset "$1" OMK_SEARXNG_PORT; SEARCH_CHANGED=1
}
# SearXNG 컨테이너는 omk 만 만든다 — omk.owner_dir 라벨이 이 설치본을 가리킬 때만 우리 것(라벨 없음 = 남의 것).
searxng_owned() { # $1=name $2=소유 디렉터리
    local own; own="$(container_workdir "$1")"
    [[ -n "$own" ]] && ! is_foreign_path "$own" "$2"
}
searxng_wait() { # $1=url → 0 이면 응답
    local i; for ((i = 0; i < 30; i++)); do curl -fsS --max-time 2 -o /dev/null "$1/healthz" 2>/dev/null && return 0; sleep 2; done; return 1
}
# 검색 기능의 실패는 설치를 멈추지 않는다 — 이 함수의 모든 실패 경로는 경고 후 return 0 이다.
searxng_ensure() { # $1=llm dir $2=env $3=설정 디렉터리 $4=소유 디렉터리(가드 라벨)
    local envf="$1/.env" env="$2" conf="$3" owner="$4" name port="" url="" murl mport
    SEARCH_CHANGED=0
    name="$(searxng_name "$env")"
    if [[ "$(dotenv_get "$envf" OMK_SEARXNG)" == "off" ]]; then            # 뺀 환경 — 전에 띄운 것이 있으면 치운다
        if has docker && docker inspect "$name" >/dev/null 2>&1 && searxng_owned "$name" "$owner"; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
        search_forget "$envf"; return 0
    fi
    # omk 것인 주소는 "비어 있거나 http://127.0.0.1:<OMK_SEARXNG_PORT>" 뿐이다. 그 밖은 사용자가 넣은 것 — 손대지 않는다.
    murl="$(dotenv_get "$envf" SEARXNG_URL)"; mport="$(dotenv_get "$envf" OMK_SEARXNG_PORT)"
    if [[ -n "$murl" && "$murl" != "http://127.0.0.1:$mport" ]]; then
        [[ -z "$mport" ]] || dotenv_unset "$envf" OMK_SEARXNG_PORT
        log_info "SEARXNG_URL 이 직접 지정돼 있습니다 ($murl) — 그대로 씁니다"; return 0
    fi
    has docker || { log_warn "docker 가 없어 SearXNG 를 띄우지 못했습니다 — 웹 검색 제한"; search_forget "$envf"; return 0; }

    if docker inspect "$name" >/dev/null 2>&1; then
        searxng_owned "$name" "$owner" || { log_warn "컨테이너 $name 은 다른 설치본의 것입니다 — 손대지 않습니다 (웹 검색 제한)"; search_forget "$envf"; return 0; }
        docker start "$name" >/dev/null 2>&1 || true
        # 정지·재시작 루프 중인 컨테이너에는 docker port 가 실패한다 — pipefail 로 설치가 죽지 않게 한다.
        port="$(docker port "$name" 8080/tcp 2>/dev/null | head -1 | sed -E 's/.*:([0-9]+)$/\1/' || true)"
        if [[ -z "$port" ]] || ! searxng_wait "http://127.0.0.1:$port"; then
            log_warn "기존 SearXNG 컨테이너가 응답하지 않습니다 — 지우고 새로 만듭니다"
            docker rm -f "$name" >/dev/null 2>&1 || true; port=""
        fi
    fi
    if [[ -z "$port" ]]; then
        net_online || { search_mark_offline "$envf"; search_forget "$envf"; return 0; }
        # 심볼릭 링크를 푼 실제 경로로 마운트한다 (macOS 의 /var→/private/var 처럼 docker 가 공유하지 않는 별칭 회피)
        { mkdir -p "$conf" && conf="$( cd "$conf" && pwd -P )"; } || { log_warn "SearXNG 설정 디렉터리를 만들지 못했습니다: $conf"; search_forget "$envf"; return 0; }
        [[ -f "$conf/settings.yml" ]] || searxng_write_settings "$conf/settings.yml" || { log_warn "SearXNG 설정을 쓰지 못했습니다"; search_forget "$envf"; return 0; }
        port="$mport"
        { [[ -n "$port" ]] && ! port_in_use "$port"; } || port="$(find_free_port "$OMK_SEARXNG_PORT_BASE")" \
            || { log_warn "SearXNG 용 빈 포트를 찾지 못했습니다 — 웹 검색 없이 계속합니다"; search_forget "$envf"; return 0; }
        log_info "SearXNG 기동: $name → 127.0.0.1:$port  ($OMK_SEARXNG_IMAGE)"
        docker image inspect "$OMK_SEARXNG_IMAGE" >/dev/null 2>&1 || docker pull -q "$OMK_SEARXNG_IMAGE" >/dev/null \
            || { log_warn "SearXNG 이미지를 받지 못했습니다 — 웹 검색 없이 계속합니다"; search_forget "$envf"; return 0; }
        # :z — SELinux(Fedora·RHEL) 에서 컨테이너가 설정 파일을 읽게 한다. 다른 플랫폼에서는 무해.
        docker run -d --name "$name" --restart unless-stopped -p "127.0.0.1:$port:8080" \
            -v "$conf/settings.yml:/etc/searxng/settings.yml:ro,z" --label "omk.owner_dir=$owner" \
            "$OMK_SEARXNG_IMAGE" >/dev/null || { log_warn "SearXNG 기동 실패 — 웹 검색 없이 계속합니다"; docker rm -f "$name" >/dev/null 2>&1 || true; search_forget "$envf"; return 0; }
        if ! searxng_wait "http://127.0.0.1:$port"; then
            log_warn "SearXNG 가 응답하지 않습니다 ($name) — 웹 검색 없이 계속합니다. 마지막 로그:"
            docker logs --tail 5 "$name" 2>&1 | sed 's/^/         /' || true
            docker rm -f "$name" >/dev/null 2>&1 || true; search_forget "$envf"; return 0
        fi
    fi
    url="http://127.0.0.1:$port"
    if [[ "$murl" != "$url" || "$mport" != "$port" ]]; then
        dotenv_set "$envf" SEARXNG_URL "$url"; dotenv_set "$envf" OMK_SEARXNG_PORT "$port"; SEARCH_CHANGED=1
    fi
    if [[ "$(dotenv_get "$envf" OMK_SEARCH_OFFLINE)" == "1" ]]; then       # 연결 복구 — omk 가 낮춘 값(2000)일 때만 걷어낸다
        dotenv_unset "$envf" OMK_SEARCH_OFFLINE; SEARCH_CHANGED=1
        [[ "$(dotenv_get "$envf" WEB_SEARCH_FETCH_TIMEOUT_MS)" != "2000" ]] || dotenv_unset "$envf" WEB_SEARCH_FETCH_TIMEOUT_MS
    fi
    return 0
}
search_line() { # $1=llm dir → 상태 한 줄 (실제로 검색을 한 번 돌려 본다)
    local envf="$1/.env" url n
    url="$(dotenv_get "$envf" SEARXNG_URL)"
    if   [[ "$(dotenv_get "$envf" OMK_SEARXNG)" == "off" ]];        then printf '꺼짐 (--no-searxng — 키 없는 기본 제공자만)'
    elif [[ "$(dotenv_get "$envf" OMK_SEARCH_OFFLINE)" == "1" ]];   then printf '꺼짐 (외부 연결 없음 — 연결 후 omk env update)'
    elif [[ -z "$url" ]];                                           then printf 'SearXNG 없음 (키 없는 기본 제공자만 — 일반 웹 검색은 거의 0건)'
    else n="$(searxng_count "$url")"
        if [[ "$n" -gt 0 ]]; then printf '동작 확인 (SearXNG %s · %s건)' "$url" "$n"
        else printf '결과 0건 (SearXNG %s) — 컨테이너·외부 연결 확인: docker logs …-searxng' "$url"; fi
    fi
}

# ==============================================================================
# env install / update / reset / status / start / stop / logs
# ==============================================================================
# ── 기본 모델 (llama.cpp) ─────────────────────────────────────────────────────
# 업스트림(--llm-base-url·--qwen-vllm-base)을 주지 않아도 앱 → 게이트웨이 → 모델이 끝까지 돌게 한다. vLLM 은 GPU 가 필요하므로
# 저사양·macOS 에서도 도는 llama.cpp 의 llama-server(OpenAI 호환)를 쓴다 — 게이트웨이 입장에서는 vLLM 과 같은 종류의 업스트림이다.
# 호스트당 하나(PM2 omk-llamacpp, 127.0.0.1 전용), $OMK_ROOT/llamacpp/{bin,models,start.sh,port}. 환경을 reset 해도 남는다.
# 작은 모델이다 — 배선 확인·가벼운 대화용. 에이전트 작업·검색 품질은 더 큰 업스트림을 지정해야 한다.
llamacpp_dir() { printf '%s/llamacpp' "$OMK_ROOT"; }
llamacpp_platform() {
    case "$(uname -s)/$(uname -m)" in
        Darwin/arm64) printf 'macos-arm64' ;; Darwin/x86_64) printf 'macos-x64' ;;
        Linux/x86_64|Linux/amd64) printf 'ubuntu-x64' ;; Linux/aarch64|Linux/arm64) printf 'ubuntu-arm64' ;; *) return 1 ;;
    esac
}
LLAMA_SERVER_BIN=""
llamacpp_ensure_binary() {
    if has llama-server; then LLAMA_SERVER_BIN="$(command -v llama-server)"; return 0; fi
    local d plat url tmp; d="$(llamacpp_dir)/bin/$OMK_LLAMACPP_TAG"
    LLAMA_SERVER_BIN="$d/llama-server"; [[ -x "$LLAMA_SERVER_BIN" ]] && return 0
    plat="$(llamacpp_platform)" || { log_warn "이 플랫폼용 llama.cpp 바이너리가 없습니다 — llama-server 를 PATH 에 두세요"; return 1; }
    url="https://github.com/ggml-org/llama.cpp/releases/download/$OMK_LLAMACPP_TAG/llama-$OMK_LLAMACPP_TAG-bin-$plat.tar.gz"
    log_info "llama.cpp $OMK_LLAMACPP_TAG 다운로드 ($plat)"
    tmp="$(mktemp -d)"; mkdir -p "$d"
    curl -fsSL "$url" | tar -xz -C "$tmp" || { rm -rf "$tmp"; log_warn "llama.cpp 다운로드 실패: $url"; return 1; }
    # 아카이브는 llama-<tag>/ 한 디렉터리 — 공유 라이브러리가 실행 파일 옆에 있어야 하므로 통째로 옮긴다.
    cp -R "$tmp"/*/. "$d/" && rm -rf "$tmp"
    [[ -x "$LLAMA_SERVER_BIN" ]] || { log_warn "llama-server 를 찾을 수 없습니다: $d"; return 1; }
}
default_model_resolve() { # 호스트에 하나뿐인 서버라 선택을 기억한다 — 옵션 없이 다시 설치해도 고른 모델이 유지된다
    local conf; conf="$(llamacpp_dir)/model.conf"
    [[ -n "$OMK_DEFAULT_MODEL_HF" ]]   || OMK_DEFAULT_MODEL_HF="$(dotenv_get "$conf" HF)"
    [[ -n "$OMK_DEFAULT_MODEL_NAME" ]] || OMK_DEFAULT_MODEL_NAME="$(dotenv_get "$conf" NAME)"
    [[ -n "$OMK_DEFAULT_MODEL_CTX" ]]  || OMK_DEFAULT_MODEL_CTX="$(dotenv_get "$conf" CTX)"
    OMK_DEFAULT_MODEL_HF="${OMK_DEFAULT_MODEL_HF:-Qwen/Qwen3-1.7B-GGUF:Q8_0}"
    OMK_DEFAULT_MODEL_NAME="${OMK_DEFAULT_MODEL_NAME:-qwen3-1.7b}"
    OMK_DEFAULT_MODEL_CTX="${OMK_DEFAULT_MODEL_CTX:-16384}"
}
default_model_base() { local p; p="$(cat "$(llamacpp_dir)/port" 2>/dev/null || true)"; [[ -z "$p" ]] || printf 'http://127.0.0.1:%s/v1' "$p"; }
DEFAULT_MODEL_BASE=""
default_model_ensure() { # 성공하면 DEFAULT_MODEL_BASE 에 OpenAI 호환 주소(/v1)
    local d port i before; d="$(llamacpp_dir)"; DEFAULT_MODEL_BASE=""
    default_model_resolve
    require_pm2
    if pm2 describe "$OMK_LLAMACPP_APP" >/dev/null 2>&1 && [[ "$(pm2_app_cwd "$OMK_LLAMACPP_APP")" != "$d" ]]; then
        log_warn "기본 모델 서버($OMK_LLAMACPP_APP)가 다른 OMK_ROOT 에서 돌고 있습니다 — 건드리지 않습니다"; return 1
    fi
    log_step "기본 모델: $OMK_DEFAULT_MODEL_NAME ($OMK_DEFAULT_MODEL_HF · llama.cpp)"
    llamacpp_ensure_binary || return 1
    mkdir -p "$d/models"
    port="$(cat "$d/port" 2>/dev/null || true)"
    if [[ -z "$port" ]]; then port="$(find_free_port "$OMK_LLAMACPP_PORT_BASE")" || return 1; printf '%s' "$port" > "$d/port"; fi
    printf 'HF=%s\nNAME=%s\nCTX=%s\n' "$OMK_DEFAULT_MODEL_HF" "$OMK_DEFAULT_MODEL_NAME" "$OMK_DEFAULT_MODEL_CTX" > "$d/model.conf"
    before="$(cat "$d/start.sh" 2>/dev/null || true)"
    cat > "$d/start.sh" <<LLAMA_START
#!/usr/bin/env bash
# omk 가 만든 파일 — 모델·컨텍스트는 OMK_DEFAULT_MODEL_* 로 바꾸고 다시 설치한다.
export LLAMA_CACHE="$d/models"
exec "$LLAMA_SERVER_BIN" -hf "$OMK_DEFAULT_MODEL_HF" --alias "$OMK_DEFAULT_MODEL_NAME" --jinja \\
    --host 127.0.0.1 --port $port -c $OMK_DEFAULT_MODEL_CTX
LLAMA_START
    chmod 700 "$d/start.sh"
    # 떠 있어도 모델·옵션이 바뀌었으면 다시 띄운다 — 같은 서버를 쓰는 다른 환경의 게이트웨이는 'omk env install <env>' 로 이름을 맞춘다.
    if [[ "$before" != "$(cat "$d/start.sh")" || "$(curl -s -m 3 "http://127.0.0.1:$port/health" 2>/dev/null)" != *'"ok"'* ]]; then
        pm2 describe "$OMK_LLAMACPP_APP" >/dev/null 2>&1 && pm2 delete "$OMK_LLAMACPP_APP" >/dev/null 2>&1 || true
        pm2 start "$d/start.sh" --name "$OMK_LLAMACPP_APP" --cwd "$d" --interpreter bash --time >/dev/null || { log_warn "PM2 $OMK_LLAMACPP_APP 기동 실패"; return 1; }
        log_info "모델을 받는 중일 수 있습니다 (첫 실행 · 수 GB) — 최대 20분 기다립니다"
        for ((i = 0; i < 400; i++)); do
            [[ "$(curl -s -m 3 "http://127.0.0.1:$port/health" 2>/dev/null)" == *'"ok"'* ]] && break; sleep 3
        done
        [[ $i -lt 400 ]] || { log_warn "기본 모델 서버가 응답하지 않습니다 — 'pm2 logs $OMK_LLAMACPP_APP'"; return 1; }
    fi
    DEFAULT_MODEL_BASE="http://127.0.0.1:$port/v1"
    log_ok "기본 모델 준비: $OMK_DEFAULT_MODEL_NAME → $DEFAULT_MODEL_BASE (PM2 $OMK_LLAMACPP_APP)"
}

# ── LiteLLM 게이트웨이 (환경별) ──────────────────────────────────────────────
# 앱은 LLM_BASE_URL 하나만 본다. 그 뒤에서 로컬 vLLM·BYOK 업스트림을 묶는 게이트웨이를 환경마다 따로 띄운다 —
# <env>/litellm/{venv,litellm.config.yaml,litellm.env,start_litellm.sh}, PM2 openmake-litellm[-env], 127.0.0.1 전용.
# config 는 레포의 scripts/vllm/litellm.config.yaml 그대로다(호스트별 값은 전부 os.environ) — 호스트마다 다른 것은
# litellm.env(600) 뿐이다: QWEN_VLLM_API_BASE · BGE_VLLM_API_BASE · VLLM_API_KEY · LITELLM_MASTER_KEY(=앱의 LLM_API_KEY).
# --llm-base-url/--llm-api-key/--llm-model 은 "게이트웨이 뒤의 업스트림"이다 — 앱은 언제나 자기 환경의 게이트웨이만 본다.
# 빼려면 --no-litellm. 실패는 설치를 멈추지 않는다.
litellm_dir()      { printf '%s/%s/litellm' "$OMK_ROOT" "$1"; }
litellm_pm2_name() { printf 'openmake-litellm%s' "$(env_suffix "$1")"; }
gen_secret()       { if has openssl; then openssl rand -hex 24; else LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 48; fi; }
litellm_pm2_start() { # $1=env
    local d n; d="$(litellm_dir "$1")"; n="$(litellm_pm2_name "$1")"
    [[ -x "$d/start_litellm.sh" ]] || return 0
    require_pm2
    pm2 describe "$n" >/dev/null 2>&1 && pm2 delete "$n" >/dev/null 2>&1 || true
    pm2 start "$d/start_litellm.sh" --name "$n" --cwd "$d" --interpreter bash --time \
        -o "$(logs_dir "$1")/$n-out.log" -e "$(logs_dir "$1")/$n-error.log" >/dev/null || { log_warn "PM2 $n 기동 실패"; return 1; }
    log_ok "PM2 $n"
}
# 환경의 config = 레포 config 그대로 + (litellm.env 에 OMK_UPSTREAM_MODEL 이 있으면) 그 모델 한 항목.
# vLLM 이 없는 호스트(예: Ollama 만 있는 개발 PC)도 자기 게이트웨이를 거쳐 쓰게 한다. 주소·키는 os.environ 참조라 config 에 값이 남지 않는다.
litellm_render_config() { # $1=레포 config $2=litellm.env $3=출력
    local model; model="$(dotenv_get "$2" OMK_UPSTREAM_MODEL)"
    [[ -n "$model" ]] || { cp "$1" "$3"; return 0; }
    awk -v m="$model" '{ print } /^model_list:[[:space:]]*$/ && !done {
        print "  # ── omk: 이 환경의 업스트림 (litellm.env 의 OMK_UPSTREAM_*) ──"
        print "  - model_name: \"" m "\""
        print "    litellm_params:"
        print "      model: \"openai/" m "\""
        print "      api_base: os.environ/OMK_UPSTREAM_API_BASE"
        print "      api_key: os.environ/OMK_UPSTREAM_API_KEY"
        done = 1 }' "$1" > "$3"
}
LITELLM_CHANGED=0
litellm_ensure() { # $1=llm dir $2=env [$3=QWEN base $4=BGE base $5=vLLM key $6=업스트림 base $7=업스트림 key $8=업스트림 model]
    local ldir="$1" env="$2" envf="$1/.env" d lenv port key url i
    LITELLM_CHANGED=0
    [[ "$(dotenv_get "$envf" OMK_LITELLM)" != "off" ]] || { log_info "LiteLLM 생략 (OMK_LITELLM=off)"; return 0; }
    [[ -f "$ldir/scripts/vllm/litellm.config.yaml" ]] || { log_warn "litellm.config.yaml 없음 — LiteLLM 을 건너뜁니다"; return 0; }
    d="$(litellm_dir "$env")"; lenv="$d/litellm.env"; mkdir -p "$d"; chmod 700 "$d"
    log_step "LiteLLM 게이트웨이: $d"
    if [[ ! -x "$d/venv/bin/litellm" ]]; then
        if has uv; then uv venv -q --python 3.12 "$d/venv" && uv pip install -q --python "$d/venv/bin/python" "$OMK_LITELLM_SPEC"
        else python3 -m venv "$d/venv" && "$d/venv/bin/pip" install -q --upgrade pip "$OMK_LITELLM_SPEC"; fi \
            || { log_warn "LiteLLM 설치 실패 — 건너뜁니다 (나중에 'omk env update $env')"; rm -rf "$d/venv"; return 0; }
    fi
    [[ -f "$lenv" ]] || { : > "$lenv"; }
    chmod 600 "$lenv"
    dotenv_ensure "$lenv" LITELLM_MASTER_KEY "sk-$(gen_secret)"
    dotenv_ensure "$lenv" DUMMY_UPSTREAM_KEY "sk-byok-forwarded-per-request"
    [[ -z "${3:-}" ]] || dotenv_set "$lenv" QWEN_VLLM_API_BASE "$3"
    [[ -z "${4:-}" ]] || dotenv_set "$lenv" BGE_VLLM_API_BASE "$4"
    [[ -z "${5:-}" ]] || dotenv_set "$lenv" VLLM_API_KEY "$5"
    if [[ -n "${6:-}" && -n "${8:-}" ]]; then
        dotenv_set "$lenv" OMK_UPSTREAM_API_BASE "$6"; dotenv_set "$lenv" OMK_UPSTREAM_API_KEY "${7:-none}"; dotenv_set "$lenv" OMK_UPSTREAM_MODEL "$8"
    fi
    litellm_render_config "$ldir/scripts/vllm/litellm.config.yaml" "$lenv" "$d/litellm.config.yaml"
    port="$(dotenv_get "$envf" OMK_LITELLM_PORT)"
    if [[ -z "$port" ]]; then port="$(find_free_port "$OMK_LITELLM_PORT_BASE")" || { log_warn "LiteLLM 빈 포트 탐색 실패"; return 0; }; fi
    cat > "$d/start_litellm.sh" <<LITELLM_START
#!/usr/bin/env bash
# omk 가 만든 파일 — 직접 고치지 말 것 ('omk env update $env' 가 다시 쓴다). 값은 litellm.env 에.
set -euo pipefail
set -a; . "$lenv"; set +a
: "\${QWEN_VLLM_API_BASE:=http://127.0.0.1:9/v1}" "\${BGE_VLLM_API_BASE:=http://127.0.0.1:9/v1}" "\${VLLM_API_KEY:=unset}"
: "\${ACESTEP_API_BASE:=http://127.0.0.1:9/v1}" "\${ACESTEP_CHAT_URL:=http://127.0.0.1:9/v1/chat/completions}"
export QWEN_VLLM_API_BASE BGE_VLLM_API_BASE VLLM_API_KEY ACESTEP_API_BASE ACESTEP_CHAT_URL
exec "$d/venv/bin/litellm" --config "$d/litellm.config.yaml" --host 127.0.0.1 --port $port
LITELLM_START
    chmod 700 "$d/start_litellm.sh"
    litellm_pm2_start "$env" || return 0
    for ((i = 0; i < 45; i++)); do
        [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$port/health/liveliness" 2>/dev/null)" == "200" ]] && break; sleep 2
    done
    [[ $i -lt 45 ]] && log_ok "LiteLLM liveliness 200 (:$port)" || log_warn "LiteLLM 이 응답하지 않습니다 — 'omk env logs $env'"
    key="$(dotenv_get "$lenv" LITELLM_MASTER_KEY)"; url="http://127.0.0.1:$port"
    if [[ "$(dotenv_get "$envf" LLM_BASE_URL)|$(dotenv_get "$envf" LLM_API_KEY)|$(dotenv_get "$envf" OMK_LITELLM_PORT)" != "$url|$key|$port" ]]; then
        dotenv_set "$envf" LLM_BASE_URL "$url"; dotenv_set "$envf" LLM_API_KEY "$key"; dotenv_set "$envf" OMK_LITELLM_PORT "$port"; LITELLM_CHANGED=1
    fi
}
litellm_line() { # $1=env $2=llm dir
    local port lenv; port="$(dotenv_get "$2/.env" OMK_LITELLM_PORT)"; lenv="$(litellm_dir "$1")/litellm.env"
    [[ -n "$port" ]] || return 0
    printf 'http://127.0.0.1:%s  (%s)' "$port" "$(litellm_dir "$1")"
    [[ -n "$(dotenv_get "$lenv" QWEN_VLLM_API_BASE)$(dotenv_get "$lenv" OMK_UPSTREAM_MODEL)" ]] || printf '  ※ 업스트림 미설정'
}

# ── 런타임 이미지 (외부 MCP 격리 · 에이전트 작업 · 아티팩트 실행/내보내기) ─────────────
# 레포에는 Dockerfile 만 있고 빌드는 "사용자 직접"이라, 설치 직후에는 에이전트 작업과 아티팩트 내보내기가
# 동작하지 않는다. omk 가 환경별 태그로 빌드하고 .env 에 이미지 이름을 적는다 — 같은 호스트의 dev·staging 이
# 서로의 이미지를 덮어쓰지 않는다. 기본 인스턴스(online)는 소스의 기본 태그 :latest 를 그대로 쓴다.
# 크다(mcp ~1GB, task ~6GB · 첫 빌드 수 분) — --no-runtime-images 로 뺀다(.env 의 OMK_RUNTIME_IMAGES=off 로 기억).
# 빌드 실패는 설치를 멈추지 않는다. 켜기/끄기 스위치(*_ENABLED)는 이미 값이 있으면 존중한다.
runtime_image_tag()   { [[ "$1" == "$OMK_DEFAULT_ENV" ]] && printf 'latest' || printf '%s' "$1"; }
runtime_image_names() { local t; t="$(runtime_image_tag "$1")"; printf 'openmake-mcp-runtime:%s openmake-task-runtime:%s' "$t" "$t"; }
RUNTIME_CHANGED=0
runtime_images_ensure() { # $1=llm dir $2=env
    local ldir="$1" env="$2" envf="$1/.env" mcp task before after
    RUNTIME_CHANGED=0
    [[ "$(dotenv_get "$envf" OMK_RUNTIME_IMAGES)" != "off" ]] || { log_info "런타임 이미지 생략 (OMK_RUNTIME_IMAGES=off)"; return 0; }
    has docker && docker info >/dev/null 2>&1 || { log_warn "docker 를 쓸 수 없어 런타임 이미지를 건너뜁니다"; return 0; }
    mcp="openmake-mcp-runtime:$(runtime_image_tag "$env")"; task="openmake-task-runtime:$(runtime_image_tag "$env")"
    log_step "런타임 이미지 빌드: $mcp · $task (첫 빌드는 수 분)"
    docker build -q -t "$mcp" "$ldir/infra/mcp-runtime" >/dev/null \
        || { log_warn "$mcp 빌드 실패 — 건너뜁니다 (나중에 'omk env update $env')"; return 0; }
    docker build -q -t "$task" --build-arg "BASE_IMAGE=$mcp" "$ldir/infra/task-runtime" >/dev/null \
        || { log_warn "$task 빌드 실패 — 건너뜁니다 (나중에 'omk env update $env')"; return 0; }
    before="$(grep -E '^(MCP_SANDBOX|TASK_SANDBOX|ARTIFACT_EXEC|ARTIFACT_EXPORT)_(IMAGE|ENABLED)=' "$envf" 2>/dev/null | sort || true)"
    dotenv_set "$envf" MCP_SANDBOX_IMAGE "$mcp";    dotenv_set "$envf" ARTIFACT_EXEC_IMAGE "$mcp"
    dotenv_set "$envf" TASK_SANDBOX_IMAGE "$task";  dotenv_set "$envf" ARTIFACT_EXPORT_IMAGE "$task"
    dotenv_ensure "$envf" MCP_SANDBOX_ENABLED true; dotenv_ensure "$envf" TASK_SANDBOX_ENABLED true
    dotenv_ensure "$envf" ARTIFACT_EXPORT_ENABLED true   # 내보내기(PDF·DOCX 등)는 task-runtime 이미지에서 돈다 — 이미지가 있어야 켤 수 있다
    after="$(grep -E '^(MCP_SANDBOX|TASK_SANDBOX|ARTIFACT_EXEC|ARTIFACT_EXPORT)_(IMAGE|ENABLED)=' "$envf" | sort)"
    [[ "$before" == "$after" ]] || RUNTIME_CHANGED=1
    log_ok "런타임 이미지 준비: $mcp · $task"
}
runtime_images_remove() { # $1=env — 환경별 태그만 지운다. :latest 는 omk 밖에서도 쓰므로 남긴다.
    [[ "$1" != "$OMK_DEFAULT_ENV" ]] && has docker || return 0
    local i; for i in $(runtime_image_names "$1"); do docker rmi "$i" >/dev/null 2>&1 && log_ok "이미지 $i 삭제" || true; done
}

# ==============================================================================
# 운영 구성 옵션 — install_mac.sh 가 켠다. 주지 않으면 기존 동작 그대로다.
# ==============================================================================
# 운영 서버와 같은 구성을 새 호스트에 만들 때 필요한 것들이다. 전부 멱등이고, 실패는 설치를 멈추지 않는다.
#   .env 키:  OMK_OPS_PROFILE=1      --ops-profile 로 설치한 환경 (update 때 프로필의 새 키를 덧붙인다)
#            OMK_HTTPS_HOST=<host>   --https-host 로 켠 내부망 HTTPS (proxy_render 가 caddy.d/<env>-https.caddy 를 쓴다)
#            OMK_ARTIFACT_VIEWER=1   --artifact-viewer 로 켠 환경
readonly OPS_PROFILE_REL="scripts/setup/profiles/ops-features.env"
readonly DGX_CHAT_PORT=8002 DGX_EMBED_PORT=8003 DGX_MUSIC_PORT=8005
readonly OMK_DGX_MODEL="${OMK_DGX_MODEL:-qwen3.8-27b}"   # DGX 채팅 vLLM 의 served-model-name (LiteLLM 항목 이름과 같다)
readonly VIEWER_PORT=8088 VIEWER_HTTPS_PORT=8443
readonly VIEWER_API_PORT=52416   # infra/artifact-viewer/nginx.conf 의 인가 호출 대상 — 기본 인스턴스만 맞는다
readonly HTTPS_PORT=443
OPS_CHANGED=0

# 웹 푸시 VAPID 키 쌍 (P-256, base64url) — 없을 때만 만든다.
vapid_ensure() { # $1=.env
    [[ -n "$(dotenv_get "$1" VAPID_PUBLIC_KEY)" && -n "$(dotenv_get "$1" VAPID_PRIVATE_KEY)" ]] && return 0
    has node || { log_warn "node 가 없어 웹 푸시 키를 만들지 못했습니다"; return 0; }
    local pair
    pair="$(node -e '
        const c = require("crypto"); const e = c.createECDH("prime256v1"); e.generateKeys();
        const priv = Buffer.alloc(32); const raw = e.getPrivateKey(); raw.copy(priv, 32 - raw.length);
        console.log(e.getPublicKey().toString("base64url") + " " + priv.toString("base64url"));' 2>/dev/null)" \
        || { log_warn "웹 푸시 키 생성 실패"; return 0; }
    dotenv_set "$1" VAPID_PUBLIC_KEY "${pair%% *}"
    dotenv_set "$1" VAPID_PRIVATE_KEY "${pair##* }"
    dotenv_ensure "$1" VAPID_SUBJECT "mailto:$(dotenv_get "$1" DEFAULT_ADMIN_EMAIL)"
    log_ok "웹 푸시 VAPID 키 생성"
}

# 차단 우회 스크래핑(curl_cffi) 전용 파이썬 — SCRAPER_PYTHON_BIN
scraper_venv_ensure() { # $1=.env $2=env
    local d py; d="$(env_dir "$2")/venvs/scraper"; py="$d/bin/python3"
    if ! "$py" -c 'import curl_cffi' >/dev/null 2>&1; then
        if has uv; then uv venv -q --python 3.12 "$d" && uv pip install -q --python "$d/bin/python" curl_cffi
        elif has python3; then python3 -m venv "$d" && "$d/bin/pip" install -q curl_cffi
        else false; fi || { log_warn "스크래퍼 파이썬(curl_cffi) 설치 실패 — 차단 우회 스크래핑 없이 계속합니다"; return 0; }
    fi
    dotenv_set "$1" SCRAPER_PYTHON_BIN "$py"
}

# 운영 기능 프로필 — .env 에 없는 키만 덧붙인다(사용자가 고친 값은 건드리지 않는다).
ops_profile_apply() { # $1=llm dir $2=env
    local ldir="$1" env="$2" envf="$1/.env" prof line key added=0 before
    prof="$ldir/$OPS_PROFILE_REL"
    [[ -f "$prof" ]] || { log_warn "운영 기능 프로필이 없습니다: $prof — 건너뜁니다"; return 0; }
    log_step "운영 기능 프로필"
    before="$(cksum < "$envf")"
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        key="${line%%=*}"
        grep -qE "^${key}=" "$envf" || { printf '%s\n' "$line" >> "$envf"; added=$((added + 1)); }
    done < "$prof"
    dotenv_set "$envf" OMK_OPS_PROFILE 1
    # 기본값(/tmp)은 재부팅 때 사라진다 — 환경 디렉터리 안에 둔다.
    dotenv_ensure "$envf" TASK_SANDBOX_ROOT "$(env_dir "$env")/task-workspaces"
    mkdir -p "$(dotenv_get "$envf" TASK_SANDBOX_ROOT)"
    vapid_ensure "$envf"
    scraper_venv_ensure "$envf" "$env"
    [[ "$before" == "$(cksum < "$envf")" ]] || OPS_CHANGED=1
    log_ok "운영 기능 프로필 적용 ($added 개 키 추가)"
}

# 프로필이 켠 샌드박스 스위치를, 런타임 이미지가 없으면 끈다 — 켜진 채 이미지가 없으면 호출마다 실패한다.
ops_sandbox_guard() { # $1=llm dir
    local envf="$1/.env" img k
    [[ "$(dotenv_get "$envf" OMK_OPS_PROFILE)" == "1" ]] || return 0
    img="$(dotenv_get "$envf" TASK_SANDBOX_IMAGE)"
    if [[ "$(dotenv_get "$envf" OMK_RUNTIME_IMAGES)" == "off" ]] || ! { has docker && docker image inspect "$img" >/dev/null 2>&1; }; then
        for k in MCP_SANDBOX_ENABLED TASK_SANDBOX_ENABLED ARTIFACT_EXEC_ENABLED ARTIFACT_EXPORT_ENABLED; do
            [[ "$(dotenv_get "$envf" "$k")" == "false" ]] || { dotenv_set "$envf" "$k" false; OPS_CHANGED=1; }
        done
        log_warn "런타임 이미지($img)가 없어 샌드박스 기능을 껐습니다 — 이미지를 빌드한 뒤('omk env update') .env 에서 다시 켜세요"
    fi
    return 0
}

# ── DGX vLLM ─────────────────────────────────────────────────────────────────
DGX_LINE=""
dgx_http_code() { # $1=host $2=port $3=path $4=key → HTTP 코드 (000 = 연결 불가)
    local a=(); [[ -n "${4:-}" ]] && a=(-H "Authorization: Bearer $4")
    curl -s -m 6 -o /dev/null -w '%{http_code}' ${a[@]+"${a[@]}"} "http://$1:$2$3" 2>/dev/null || true
}
# 게이트웨이의 음악 주소 · 앱의 DGX 파생값(정확 토큰 재계산·GPU 지표·SSRF 허용) · 연결 확인.
# 채팅·임베딩 주소는 호출자가 litellm_ensure 에 넘긴다(--qwen-vllm-base/--bge-vllm-base 와 같은 경로).
dgx_apply() { # $1=llm dir $2=env $3=host $4=vLLM key
    local envf="$1/.env" host="$3" key="${4:-}" d lenv chat embed music
    log_step "DGX vLLM: $host"
    d="$(litellm_dir "$2")"; lenv="$d/litellm.env"
    mkdir -p "$d"; chmod 700 "$d"; [[ -f "$lenv" ]] || : > "$lenv"; chmod 600 "$lenv"
    dotenv_set "$lenv" ACESTEP_API_BASE "http://$host:$DGX_MUSIC_PORT/v1"
    dotenv_set "$lenv" ACESTEP_CHAT_URL "http://$host:$DGX_MUSIC_PORT/v1/chat/completions"
    dotenv_set "$envf" LLM_DEFAULT_MODEL "$OMK_DGX_MODEL"
    dotenv_set "$envf" LLM_TOKENIZE_URL "http://$host:$DGX_CHAT_PORT/tokenize"
    [[ -z "$key" ]] || dotenv_set "$envf" LLM_TOKENIZE_API_KEY "$key"
    dotenv_set "$envf" VLLM_METRICS_URLS "http://$host:$DGX_CHAT_PORT/metrics,http://$host:$DGX_EMBED_PORT/metrics"
    dotenv_set "$envf" SSRF_ALLOWED_HOSTS "$(csv_union "$(dotenv_get "$envf" SSRF_ALLOWED_HOSTS)" "$host")"
    chat="$(dgx_http_code "$host" "$DGX_CHAT_PORT" /v1/models "$key")"
    embed="$(dgx_http_code "$host" "$DGX_EMBED_PORT" /v1/models "$key")"
    music="$(dgx_http_code "$host" "$DGX_MUSIC_PORT" / "")"
    DGX_LINE="채팅 :$DGX_CHAT_PORT=$chat · 임베딩 :$DGX_EMBED_PORT=$embed · 음악 :$DGX_MUSIC_PORT=$music"
    case "$chat" in
        200) log_ok "DGX 연결 확인 ($DGX_LINE)" ;;
        401) log_warn "DGX vLLM 키 불일치(401) — --vllm-api-key 를 확인하세요 ($DGX_LINE)" ;;
        *)   log_warn "DGX 채팅 모델에 연결하지 못했습니다 ($DGX_LINE) — LAN 이면 DGX vLLM 바인딩·방화벽, Tailscale 이면 ACL 을 확인하세요" ;;
    esac
    return 0
}

# ── 내부망 HTTPS (Caddy tls internal) ────────────────────────────────────────
# 사내망에는 공인 인증서를 받을 도메인이 없다 — Caddy 의 내부 인증기관이 발급하고, 사용자 기기는 그 루트를
# 한 번 신뢰 등록한다. 프록시(omk-proxy)가 :443 에서 같은 라우팅(웹·REST·WebSocket 한 origin)을 한다.
https_template() { # $1=llm dir
    local cand
    for cand in "${SCRIPT_DIR:+$SCRIPT_DIR/../caddy/internal.caddy.tmpl}" "$1/scripts/caddy/internal.caddy.tmpl"; do
        [[ -n "$cand" && -f "$cand" ]] && { printf '%s' "$cand"; return 0; }
    done
    return 1
}
caddy_root_ca() { # Caddy 가 사용자 권한(PM2)으로 돌 때 내부 인증기관 루트 위치
    case "$(uname -s)" in
        Darwin) printf '%s' "$HOME/Library/Application Support/Caddy/pki/authorities/local/root.crt" ;;
        *)      printf '%s' "${XDG_DATA_HOME:-$HOME/.local/share}/caddy/pki/authorities/local/root.crt" ;;
    esac
}
https_root_ca_out() { printf '%s/https/openmake-internal-root.crt' "$OMK_ROOT"; }
https_render() { # $1=env — .env 의 OMK_HTTPS_HOST 가 있을 때만 caddy.d/<env>-https.caddy
    local env="$1" ldir envf host tmpl out api web url
    ldir="$(llm_dir "$env")"; envf="$ldir/.env"; out="$(proxy_dir)/caddy.d/$env-https.caddy"
    host="$(dotenv_get "$envf" OMK_HTTPS_HOST)"
    [[ -n "$host" ]] || { rm -f "$out"; return 0; }
    tmpl="$(https_template "$ldir")" || { log_warn "internal.caddy.tmpl 을 찾을 수 없어 HTTPS 를 건너뜁니다"; return 0; }
    if port_in_use "$HTTPS_PORT" && [[ ! -f "$out" ]] && ! proxy_is_ours; then
        log_warn "포트 $HTTPS_PORT 을 다른 프로세스가 쓰고 있어 내부망 HTTPS 를 건너뜁니다 (brew services 의 caddy 등)"
        return 0
    fi
    api="$(llm_api_port "$ldir")"; web="$(llm_web_port "$ldir")"
    sed -e "s|{{HOST}}|$host|g" -e "s|{{API_PORT}}|$api|g" -e "s|{{WEB_PORT}}|$web|g" "$tmpl" > "$out"
    if [[ "$(dotenv_get "$envf" OMK_ARTIFACT_VIEWER)" == "1" ]]; then
        printf '\n# artifact-viewer — 별도 origin(포트)\n%s:%s {\n\ttls internal\n\treverse_proxy localhost:%s\n}\n' \
            "$host" "$VIEWER_HTTPS_PORT" "$VIEWER_PORT" >> "$out"
    fi
    url="https://$host"
    dotenv_set "$envf" OMK_APP_URL "$url"
    dotenv_set "$envf" SWAGGER_BASE_URL "$url"
    dotenv_set "$envf" CORS_ORIGINS "$(csv_union "$(dotenv_get "$envf" CORS_ORIGINS)" "$url")"
    dotenv_set "$envf" COOKIE_SECURE true
    dotenv_set "$envf" ALLOW_INSECURE_COOKIES false
    log_ok "내부망 HTTPS 설정 → $out ($url → api :$api / web :$web)"
}
# 프록시가 인증서를 발급한 뒤 루트를 꺼내 둔다 — 사용자 기기에 나눠 줄 파일.
https_export_root_ca() {
    ls "$(proxy_dir)"/caddy.d/*-https.caddy >/dev/null 2>&1 || return 0
    local src out i; src="$(caddy_root_ca)"; out="$(https_root_ca_out)"
    for ((i = 0; i < 20; i++)); do [[ -f "$src" ]] && break; sleep 1; done
    [[ -f "$src" ]] || { log_warn "Caddy 내부 인증기관 루트를 찾지 못했습니다: $src"; return 0; }
    mkdir -p "$(dirname "$out")"; cp "$src" "$out"; chmod 644 "$out"
    log_ok "내부 루트 인증서 → $out (사용자 기기마다 한 번 신뢰 등록)"
}

# ── artifact-viewer (선택) ───────────────────────────────────────────────────
viewer_ensure() { # $1=llm dir
    local ldir="$1" envf="$1/.env" host origin
    [[ "$(dotenv_get "$envf" OMK_ARTIFACT_VIEWER)" == "1" ]] || return 0
    if [[ "$(llm_api_port "$ldir")" != "$VIEWER_API_PORT" ]]; then
        log_warn "artifact-viewer 는 백엔드 :$VIEWER_API_PORT 를 전제로 합니다(nginx.conf) — API :$(llm_api_port "$ldir") 인 이 환경은 건너뜁니다"
        return 0
    fi
    has docker && docker info >/dev/null 2>&1 || { log_warn "docker 를 쓸 수 없어 artifact-viewer 를 건너뜁니다"; return 0; }
    log_step "artifact-viewer"
    ( cd "$ldir" && bash infra/artifact-viewer/fetch-vendor.sh >/dev/null ) || { log_warn "artifact-viewer 라이브러리 준비 실패 — 건너뜁니다"; return 0; }
    ( cd "$ldir" && ARTIFACT_VIEWER_PORT="$VIEWER_PORT" docker compose -p openmake-artifact-viewer \
        -f infra/artifact-viewer/docker-compose.yml up -d >/dev/null ) || { log_warn "artifact-viewer 기동 실패 — 건너뜁니다"; return 0; }
    host="$(dotenv_get "$envf" OMK_HTTPS_HOST)"
    if [[ -n "$host" ]]; then
        origin="https://$host:$VIEWER_HTTPS_PORT"
    else
        host="$(dotenv_get "$envf" OMK_ENV_HOSTS | cut -d, -f1)"
        origin="http://${host:-localhost}:$VIEWER_PORT"
    fi
    dotenv_set "$envf" ARTIFACT_VIEWER_ENABLED true
    dotenv_set "$envf" ARTIFACT_VIEWER_ORIGIN "$origin"
    dotenv_ensure "$envf" ARTIFACT_VIEWER_SIGNING_KEY "$(gen_secret)"
    log_ok "artifact-viewer → $origin"
}

# ── Discord 봇 (선택) ────────────────────────────────────────────────────────
# 앱 API 키(discord 스코프)는 앱이 떠야 발급할 수 있어 summary 가 할 일로 안내한다 — 키가 없으면 봇은
# exit 78 로 스스로 내려가고 PM2 가 재시작하지 않는다(ecosystem stop_exit_codes).
discord_ensure() { # $1=llm dir $2=env $3=token(선택)
    local ldir="$1" envf="$1/.env" name
    [[ -z "${3:-}" ]] || dotenv_set "$envf" DISCORD_BOT_TOKEN "$3"
    [[ -n "$(dotenv_get "$envf" DISCORD_BOT_TOKEN)" ]] || return 0
    name="openmake-discord$(env_suffix "$2")"
    log_step "Discord 봇"
    ( cd "$ldir" && npm run build:discord-bot >/dev/null ) || { log_warn "Discord 봇 빌드 실패 — 건너뜁니다"; return 0; }
    ( cd "$ldir" && pm2 start ecosystem.config.js --only "$name" --update-env >/dev/null ) || log_warn "PM2 $name 등록 실패"
    log_ok "PM2 $name"
}

cmd_env_install() {
    local env="$1"; shift
    local ref="" bench_ref="" public_url="" no_bench=0 no_proxy=0 no_searxng=0 no_images=0 no_litellm=0 no_default_model=0 qwen_base="" bge_base="" vllm_key="" up_base="" up_key="" up_model="" auto="" llm_args=() expose_args=()
    local ops=0 dgx_host="" https_host="" viewer=0 discord_token=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ref)          ref="${2:-}"; shift ;;
            --bench-ref)    bench_ref="${2:-}"; shift ;;
            --public-url)   public_url="${2:-}"; shift ;;
            --no-bench)     no_bench=1 ;;
            --no-proxy)     no_proxy=1 ;;
            --no-searxng)   no_searxng=1 ;;
            --no-runtime-images) no_images=1 ;;
            --no-litellm)   no_litellm=1 ;;
            --no-default-model) no_default_model=1 ;;
            --tailscale)    expose_args+=(--tailscale) ;;          # 설치 끝에 'omk env expose' — reset 후 재설치해도 다른 기기에서 보인다
            --host)         expose_args+=(--host "${2:-}"); shift ;;
            --qwen-vllm-base) qwen_base="${2:-}"; shift ;;
            --bge-vllm-base)  bge_base="${2:-}"; shift ;;
            --vllm-api-key)   vllm_key="${2:-}"; shift ;;
            --autoupdate)   auto=1 ;;
            --no-autoupdate) auto=0 ;;
            --ops-profile)  ops=1 ;;
            --dgx-host)     dgx_host="${2:-}"; shift ;;
            --https-host)   https_host="${2:-}"; shift ;;
            --artifact-viewer) viewer=1 ;;
            --discord-token) discord_token="${2:-}"; shift ;;
            # 게이트웨이 뒤에 둘 업스트림(OpenAI 호환 — Ollama·vLLM·외부 API). install.sh 에도 넘겨 LLM_DEFAULT_MODEL 을 맞춘다.
            --llm-base-url) up_base="${2:-}"; llm_args+=("$1" "${2:-}"); shift ;;
            --llm-api-key)  up_key="${2:-}";  llm_args+=("$1" "${2:-}"); shift ;;
            --llm-model)    up_model="${2:-}"; llm_args+=("$1" "${2:-}"); shift ;;
            -y|--yes)       ASSUME_YES=1 ;;
            *) usage_die "알 수 없는 옵션: $1" ;;
        esac; shift
    done
    ref="${ref:-$(env_default_ref "$env")}"
    local track="" ; if [[ "$ref" == "release" ]]; then
        track="release"; ref="$(latest_release_tag "$OMK_REPO_URL")"; [[ -n "$ref" ]] || die "릴리스 태그(vX.Y.Z)를 찾을 수 없습니다: $OMK_REPO_URL — --ref main 으로 설치하세요"
        bench_ref="${bench_ref:-main}"   # openmake_bench 는 릴리스 태그가 없다
    fi
    bench_ref="${bench_ref:-$ref}"
    [[ -z "$dgx_host" || "$dgx_host" =~ ^[A-Za-z0-9._-]+$ ]] || usage_die "--dgx-host 형식이 올바르지 않습니다: $dgx_host"
    [[ -z "$https_host" || "$https_host" =~ ^[A-Za-z0-9._-]+$ ]] || usage_die "--https-host 형식이 올바르지 않습니다: $https_host"
    if [[ -n "$https_host" && $no_proxy -eq 1 ]]; then usage_die "--https-host 는 프록시가 필요합니다 (--no-proxy 와 함께 쓸 수 없음)"; fi
    # 배포는 수동이다 — staging·online 모두 사람이 `omk env update` 로 올린다. 자동 갱신은 명시적으로
    # 켠 환경만(--autoupdate 또는 `omk env autoupdate <env>`).
    [[ -n "$auto" ]] || auto=0

    local ldir suffix_flag=()
    ldir="$(llm_dir "$env")"
    [[ "$env" == "$OMK_DEFAULT_ENV" ]] || suffix_flag=(--instance "$env")

    log_step "환경 설치: $env  (ref $ref · $(env_dir "$env"))"
    assert_env_owned "$env"
    ensure_git
    mkdir -p "$(env_dir "$env")" "$(logs_dir "$env")"

    # 1) openmake_llm — 툴체인·.env·DB·마이그레이션·빌드·PM2 전부 install.sh 가 한다.
    clone_or_keep "$OMK_REPO_URL" "$ref" "$ldir" "openmake_llm"
    [[ -z "$track" ]] || [[ "$(git -C "$ldir" rev-parse --abbrev-ref HEAD)" == "release" ]] || release_checkout "$ldir" "$ref"
    restore_env_backup "$ldir" llm
    # 빈 배열 확장은 bash 4.4 미만에서 set -u 에 걸린다 — ${arr[@]+"${arr[@]}"} 관용구로 피한다.
    ( cd "$ldir" && OMK_LOG_DIR="$(logs_dir "$env")" ./install.sh --yes --minimal ${suffix_flag[@]+"${suffix_flag[@]}"} \
        ${public_url:+--public-url "$public_url"} ${llm_args[@]+"${llm_args[@]}"} ) || die "install.sh 실패 ($env)"
    dotenv_ensure "$ldir/.env" OMK_LOG_DIR "$(logs_dir "$env")"
    [[ -z "$track" ]] || dotenv_set "$ldir/.env" OMK_TRACK release
    load_toolchain "$ldir"

    # 1.5~1.7 은 .env 를 고친다 — 어느 단계든 내용이 바뀌었으면 끝에 API 를 한 번 재시작한다(단계별 플래그는 빠뜨리기 쉽다).
    local env_before; env_before="$(cksum < "$ldir/.env")"

    # 1.4) 운영 구성 옵션 — 프로필·DGX·HTTPS·뷰어 표시는 뒤 단계(런타임 이미지·게이트웨이·프록시)가 읽는다.
    OPS_CHANGED=0
    [[ $ops -eq 1 ]] && ops_profile_apply "$ldir" "$env"
    if [[ -n "$dgx_host" ]]; then
        qwen_base="${qwen_base:-http://$dgx_host:$DGX_CHAT_PORT/v1}"; bge_base="${bge_base:-http://$dgx_host:$DGX_EMBED_PORT/v1}"
        dgx_apply "$ldir" "$env" "$dgx_host" "$vllm_key"
    fi
    [[ -z "$https_host" ]] || dotenv_set "$ldir/.env" OMK_HTTPS_HOST "$https_host"
    [[ $viewer -eq 0 ]] || dotenv_set "$ldir/.env" OMK_ARTIFACT_VIEWER 1

    # 1.5) 웹 검색 — .env 는 install.sh 가 만든 뒤에야 있다. 값이 바뀌면 API 만 다시 띄운다.
    [[ $no_searxng -eq 1 ]] && dotenv_set "$ldir/.env" OMK_SEARXNG off
    searxng_ensure "$ldir" "$env" "$(env_dir "$env")/searxng" "$(env_dir "$env")"
    # 1.6) 런타임 이미지 — 에이전트 작업·아티팩트 내보내기·외부 MCP 격리의 전제.
    [[ $no_images -eq 1 ]] && dotenv_set "$ldir/.env" OMK_RUNTIME_IMAGES off
    runtime_images_ensure "$ldir" "$env"
    ops_sandbox_guard "$ldir"
    # 1.7) LiteLLM 게이트웨이 — 앱의 LLM_BASE_URL·LLM_API_KEY 를 채운다.
    [[ $no_litellm -eq 1 ]] && dotenv_set "$ldir/.env" OMK_LITELLM off
    # 업스트림을 주지 않았고 이 환경에 기억된 업스트림도 없으면 기본 모델(llama.cpp)을 게이트웨이 뒤에 둔다.
    # 나중에 --llm-base-url/--qwen-vllm-base 로 다시 설치하거나 litellm.env 를 채우면 그쪽을 따른다.
    local lenv_prev; lenv_prev="$(litellm_dir "$env")/litellm.env"
    if [[ $no_litellm -eq 0 && $no_default_model -eq 0 && -z "$up_base$qwen_base" \
          && -z "$(dotenv_get "$lenv_prev" QWEN_VLLM_API_BASE)" ]] \
       && { [[ -z "$(dotenv_get "$lenv_prev" OMK_UPSTREAM_MODEL)" ]] || [[ "$(dotenv_get "$lenv_prev" OMK_UPSTREAM_API_BASE)" == "$(default_model_base)" ]]; }; then
        if default_model_ensure; then
            up_base="$DEFAULT_MODEL_BASE"; up_key="none"; up_model="$OMK_DEFAULT_MODEL_NAME"
            dotenv_set "$ldir/.env" LLM_DEFAULT_MODEL "$up_model"
            # CPU·Metal 의 작은 모델은 앱의 큰 프롬프트(수천 토큰)를 읽는 데만 10~20초가 든다 — 기본 fast-fail(5초+보정)에 걸려
            # "LLM 호출 실패"가 된다. 값이 없을 때만 넉넉히 둔다(.env.example 도 단일 모델 운영에 30초 이상을 권장).
            dotenv_ensure "$ldir/.env" LLM_FAST_FAIL_TIMEOUT_MS 60000
            dotenv_ensure "$ldir/.env" LLM_FAST_FAIL_PREFILL_MS_PER_1K_TOKENS 4000
        else log_warn "기본 모델을 준비하지 못했습니다 — 업스트림을 직접 지정하세요 (--llm-base-url … --llm-model …)"; fi
    fi
    litellm_ensure "$ldir" "$env" "$qwen_base" "$bge_base" "$vllm_key" "$up_base" "$up_key" "$up_model"
    [[ "$env_before" == "$(cksum < "$ldir/.env")" && $SEARCH_CHANGED -eq 0 && $RUNTIME_CHANGED -eq 0 && $LITELLM_CHANGED -eq 0 ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"

    # 2) openmake_bench
    [[ $no_bench -eq 1 ]] || bench_install "$env" "$bench_ref" "$ldir"

    # 2.5) 선택 기능 — 뷰어 주소는 HTTPS 여부에 따라 정해진다(OMK_HTTPS_HOST 는 1.4 에서 기록).
    local env_before_proxy; env_before_proxy="$(cksum < "$ldir/.env")"
    viewer_ensure "$ldir"
    discord_ensure "$ldir" "$env" "$discord_token"

    # 3) 리버스 프록시 (--https-host 면 :443 내부망 HTTPS 블록도)
    [[ $no_proxy -eq 1 ]] || { proxy_render "$env"; proxy_start_or_reload; https_export_root_ca; }
    # 프록시·선택 기능이 .env(CORS·공개 주소·뷰어)를 바꿨으면 API 가 다시 읽게 한다.
    [[ "$env_before_proxy" == "$(cksum < "$ldir/.env")" ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"

    # 3.5) 다른 기기에서 보기 — 프록시가 있어야 의미가 있다.
    if [[ ${#expose_args[@]} -gt 0 && $no_proxy -eq 0 ]]; then cmd_env_expose "$env" "${expose_args[@]}" || log_warn "expose 실패 — 'omk env expose $env --tailscale'"; fi

    # 4) 래퍼 + 자동 갱신
    install_wrapper
    [[ $auto -eq 1 ]] && cmd_env_autoupdate "$env"

    env_summary "$env"
}

cmd_env_update() {
    local env="$1"; shift; local if_behind=0 no_backup=0
    while [[ $# -gt 0 ]]; do case "$1" in --no-backup) no_backup=1 ;; --if-behind) if_behind=1 ;; -y|--yes) ASSUME_YES=1 ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift; done
    local ldir bdir; ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    [[ -d "$ldir/.git" ]] || die "$ldir 가 없습니다 — 'omk env install $env' 먼저"
    load_toolchain "$ldir"
    local track; track="$(dotenv_get "$ldir/.env" OMK_TRACK)"
    if [[ $if_behind -eq 1 ]]; then
        local need=0
        if [[ "$track" == "release" ]]; then release_behind "$ldir" && need=1; else repo_behind "$ldir" && need=1; fi
        [[ -d "$bdir/.git" ]] && repo_behind "$bdir" && need=1
        [[ $need -eq 1 ]] || { log_info "$env 최신 — 갱신 없음"; return 0; }
    fi
    log_step "환경 갱신: $env"
    restore_lockfiles "$ldir"; [[ -d "$bdir/.git" ]] && restore_lockfiles "$bdir"
    searxng_ensure "$ldir" "$env" "$(env_dir "$env")/searxng" "$(env_dir "$env")"   # 뒤의 update 가 재시작하며 반영
    # llm: fetch → ff-only pull → build → migrate → restart (openmake_llm.sh 가 dirty/ff 검사 포함)
    if [[ "$track" == "release" ]]; then
        if release_behind "$ldir"; then
            [[ -z "$(git -C "$ldir" status --porcelain)" ]] || die "$ldir 에 커밋되지 않은 변경이 있습니다 — 정리한 뒤 다시 실행하세요"
            # 릴리스를 따르는 환경은 실사용 데이터를 갖는다 — 새 버전(마이그레이션)을 올리기 전에 덤프를 떠 둔다.
            if [[ $no_backup -eq 0 ]]; then
                env_backup_run "$env" || die "올리기 전 백업 실패 — 고친 뒤 다시 실행하세요 (건너뛰려면 --no-backup)"
            fi
            git -C "$ldir" merge -q --ff-only "$RELEASE_TAG" || die "릴리스 $RELEASE_TAG 로 fast-forward 할 수 없습니다 ($ldir)"
            log_ok "릴리스 $RELEASE_TAG 로 갱신"
            ( cd "$ldir" && ./openmake_llm.sh deploy --yes < /dev/null | cat ) || die "openmake_llm.sh deploy 실패 ($env)"
        else log_info "$env 는 최신 릴리스입니다 (${RELEASE_TAG:-?})"; fi
    else
        ( cd "$ldir" && ./openmake_llm.sh update --yes < /dev/null | cat ) || die "openmake_llm.sh update 실패 ($env)"
    fi
    # 운영 프로필로 설치한 환경은 새 버전 프로필에 추가된 키를 덧붙인다(있는 값은 그대로).
    OPS_CHANGED=0
    [[ "$(dotenv_get "$ldir/.env" OMK_OPS_PROFILE)" != "1" ]] || ops_profile_apply "$ldir" "$env"
    # 새로 받은 Dockerfile 로 빌드한다(안 바뀌었으면 캐시로 수 초). .env 가 바뀐 경우에만 한 번 더 재시작.
    runtime_images_ensure "$ldir" "$env"
    ops_sandbox_guard "$ldir"
    # 이미 게이트웨이가 있는 환경만 갱신한다(새 config 복사 + 재기동, litellm.env 는 그대로) — update 가 기존 환경의
    # LLM_BASE_URL 을 가로채지 않게. 새로 붙이려면 'omk env install <env>' 를 다시 실행한다(멱등).
    LITELLM_CHANGED=0; [[ ! -d "$(litellm_dir "$env")" ]] || litellm_ensure "$ldir" "$env"
    [[ $RUNTIME_CHANGED -eq 0 && $LITELLM_CHANGED -eq 0 && $OPS_CHANGED -eq 0 ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"
    bench_update "$env"
    [[ -f "$(proxy_dir)/caddy.d/$env.caddy" ]] && { proxy_render "$env"; proxy_start_or_reload; https_export_root_ca; }
    log_ok "$env 갱신 완료"
}

cmd_env_reset() {
    local env="$1"; shift; local keep_data=0 keep_env=0 reinstall=0 purge_images=0
    while [[ $# -gt 0 ]]; do
        case "$1" in --purge-images) purge_images=1 ;; --keep-data) keep_data=1 ;; --keep-env) keep_env=1 ;; --reinstall) reinstall=1 ;; -y|--yes) ASSUME_YES=1 ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift
    done
    local edir ldir bdir ref="" bref=""
    edir="$(env_dir "$env")"; ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    # 데이터만 남기고 .env 를 버리면 쓸 수 없다 — 볼륨은 옛 POSTGRES_PASSWORD 로, DB 안의 암호화된 값은
    # 옛 TOKEN_ENCRYPTION_KEY 로 묶여 있다. 그래서 --keep-data 는 .env 보존을 함의한다.
    if [[ $keep_data -eq 1 && $keep_env -eq 0 ]]; then keep_env=1; log_info "--keep-data → .env 도 함께 보존합니다 (DB 비밀번호·암호화 키가 데이터와 짝)"; fi
    log_step "환경 리셋: $env"
    load_toolchain "$ldir"; assert_env_owned "$env"
    echo "  PM2      $(pm2_names "$env")"
    echo "  docker   $(docker_containers "$env")  볼륨: $(docker_volumes "$env")$([[ $keep_data -eq 1 ]] && printf ' (유지)')"
    echo "  디렉터리 $edir"
    confirm "위 항목을 전부 지웁니다. 계속할까요?" || { log_info "취소"; return 0; }

    # 재설치용 정보는 지우기 전에 확보
    [[ -d "$ldir/.git" ]] && ref="$(git -C "$ldir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [[ -d "$bdir/.git" ]] && bref="$(git -C "$bdir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    local bk=""
    if [[ $keep_env -eq 1 ]]; then
        bk="$OMK_ROOT/.backup/$env-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$bk"
        [[ -f "$ldir/.env" ]] && cp "$ldir/.env" "$bk/llm.env"
        [[ -f "$bdir/.env" ]] && cp "$bdir/.env" "$bk/bench.env"
        log_ok ".env 백업 → $bk"
    fi

    load_toolchain "$ldir"
    if has pm2; then
        local n; for n in $(pm2_names "$env"); do
            pm2 describe "$n" >/dev/null 2>&1 && { pm2 delete "$n" >/dev/null 2>&1 && log_ok "PM2 $n 삭제" || log_warn "PM2 $n 삭제 실패"; }
        done
        # pm2 save 는 호스트 전체의 부팅 복구 목록(~/.pm2/dump.pm2)을 통째로 다시 쓴다 — 이 환경과
        # 무관한 저장 항목까지 바뀐다. 그래서 지운 앱이 그 목록에 들어 있을 때만(안 지우면 재부팅 때
        # 되살아난다) 다시 저장하고, 아니면 건드리지 않는다.
        if pm2_dump_has_any "$(pm2_names "$env")"; then
            pm2 save --force >/dev/null 2>&1 && log_info "PM2 부팅 복구 목록 갱신 (지운 앱이 저장돼 있었음)" || true
        fi
    fi
    if has docker; then
        local c v
        for c in $(docker_containers "$env"); do docker rm -f "$c" >/dev/null 2>&1 && log_ok "컨테이너 $c 제거" || true; done
        if [[ $keep_data -eq 0 ]]; then
            for v in $(docker_volumes "$env"); do docker volume rm "$v" >/dev/null 2>&1 && log_ok "볼륨 $v 삭제" || true; done
        fi
        # 런타임 이미지(약 7GB)는 기본으로 남긴다 — 구형 docker 빌더는 이미지를 지우면 캐시도 사라져 재설치마다 수 분이 든다.
        [[ $purge_images -eq 0 ]] || runtime_images_remove "$env"
    fi
    proxy_remove "$env"
    [[ -d "$edir" ]] && { rm -rf "$edir"; log_ok "삭제: $edir"; }
    log_ok "$env 리셋 완료"

    if [[ $reinstall -eq 1 ]]; then
        OMK_RESTORE_ENV_FROM="$bk" cmd_env_install "$env" ${ref:+--ref "$ref"} ${bref:+--bench-ref "$bref"} --yes
    elif [[ -n "$bk" ]]; then
        log_info "보존한 .env 로 다시 설치하려면: OMK_RESTORE_ENV_FROM=\"$bk\" omk env install $env"
    fi
}

pm2_status_of() { # $1=name → online|stopped|errored|-(없음)
    has pm2 || { printf -- '-'; return 0; }
    pm2 jlist 2>/dev/null | node -e '
        const n=process.argv[1]; let l=[]; try{l=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{}
        const p=l.find(x=>x.name===n); process.stdout.write(p?p.pm2_env.status:"-")' "$1" 2>/dev/null || printf -- '-'
}
env_summary() { # $1=env
    local env="$1" ldir bdir api web pport bport
    ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    api="$(llm_api_port "$ldir")"; web="$(llm_web_port "$ldir")"
    pport="$(dotenv_get "$ldir/.env" OMK_PROXY_PORT)"; bport="$(dotenv_get "$bdir/.env" OMKB_PORT)"
    printf "\n%s══════════════════════════════════════════════════════%s\n" "$C_OK" "$C_RESET"
    printf "%s  환경 %s 준비 완료%s\n" "$C_OK" "$env" "$C_RESET"
    printf "%s══════════════════════════════════════════════════════%s\n\n" "$C_OK" "$C_RESET"
    echo "  llm       $ldir  ($(git -C "$ldir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') @ $(git -C "$ldir" rev-parse --short HEAD 2>/dev/null || echo '?'))"
    echo "            web http://localhost:$web   api http://localhost:$api"
    [[ -d "$bdir" ]] && echo "  bench     $bdir  → http://localhost:${bport:-?}"
    [[ -n "$pport" ]] && echo "  proxy     http://localhost:$pport  (외부 공개는 터널/DNS 를 이 포트로: scripts/cloudflared/config.yml.example)"
    local eh; for eh in $(dotenv_get "$ldir/.env" OMK_ENV_HOSTS | tr ',' ' '); do [[ -z "$pport" ]] || echo "  다른 기기  http://$eh:$pport"; done
    [[ -n "$(dotenv_get "$ldir/.env" OMK_APP_URL | grep -E '^https?://' | grep -v localhost || true)" ]] && echo "  공개 주소  $(dotenv_get "$ldir/.env" OMK_APP_URL)"
    [[ -z "$(dotenv_get "$ldir/.env" OMK_HTTPS_HOST)" ]] || echo "  HTTPS     https://$(dotenv_get "$ldir/.env" OMK_HTTPS_HOST)  (루트 인증서: $(https_root_ca_out))"
    echo "  웹 검색   $(search_line "$ldir")"
    [[ -z "$(litellm_line "$env" "$ldir")" ]] || echo "  LiteLLM   $(litellm_line "$env" "$ldir")"
    [[ -z "$DGX_LINE" ]] || echo "  DGX       $DGX_LINE"
    [[ "$(dotenv_get "$ldir/.env" ARTIFACT_VIEWER_ENABLED)" != "true" ]] || echo "  뷰어      $(dotenv_get "$ldir/.env" ARTIFACT_VIEWER_ORIGIN)"
    if [[ -n "$(default_model_base)" && "$(dotenv_get "$(litellm_dir "$env")/litellm.env" OMK_UPSTREAM_API_BASE)" == "$(default_model_base)" ]]; then
        echo "  모델      $(dotenv_get "$(litellm_dir "$env")/litellm.env" OMK_UPSTREAM_MODEL) (호스트 기본 모델 · llama.cpp) — 배선 확인·가벼운 대화용. 더 큰 모델: --llm-base-url … --llm-model … 로 재설치"
    fi
    echo ""
    if [[ -n "$(dotenv_get "$ldir/.env" OMK_LITELLM_PORT)" && -z "$(dotenv_get "$(litellm_dir "$env")/litellm.env" QWEN_VLLM_API_BASE)$(dotenv_get "$(litellm_dir "$env")/litellm.env" OMK_UPSTREAM_MODEL)" ]]; then
        printf "  %s[할 일]%s 로컬 모델 업스트림이 비어 있습니다 — $(litellm_dir "$env")/litellm.env 의\n" "$C_WARN" "$C_RESET"
        echo "         QWEN_VLLM_API_BASE / BGE_VLLM_API_BASE / VLLM_API_KEY 를 넣고 'omk env start $env' (또는 --llm-base-url … --llm-model … 로 재설치)"
    fi
    if [[ -d "$bdir" && -z "$(dotenv_get "$bdir/.env" OMK_API_KEY)" ]]; then
        printf "  %s[할 일]%s bench 가 llm 모델을 부르려면 API 키가 필요합니다 (자동 발급 불가):\n" "$C_WARN" "$C_RESET"
        echo "         llm 웹 → 설정 → API 키 → chat 스코프 키 발급 → $bdir/.env 의 OMK_API_KEY 에 넣고 'omk env start $env'"
    fi
    if [[ -n "$(dotenv_get "$ldir/.env" DISCORD_BOT_TOKEN)" && -z "$(dotenv_get "$ldir/.env" DISCORD_BOT_API_KEY)" ]]; then
        printf "  %s[할 일]%s Discord 봇: llm 웹 → 설정 → API 키 → discord 스코프 키 발급 → $ldir/.env 의\n" "$C_WARN" "$C_RESET"
        echo "         DISCORD_BOT_API_KEY 에 넣고 'pm2 restart openmake-discord$(env_suffix "$env") --update-env'"
    fi
    if [[ "$(dotenv_get "$ldir/.env" LLM_BASE_URL)" == "http://localhost:4000" ]]; then
        printf "  %s[할 일]%s LLM 엔드포인트가 자리표시자입니다 — $ldir/.env 의 LLM_BASE_URL / LLM_API_KEY / LLM_DEFAULT_MODEL\n" "$C_WARN" "$C_RESET"
    fi
    echo "  명령      omk env status|update|start|stop|logs|reset $env"
    echo ""
}
cmd_env_status() {
    local env="$1" ldir bdir edir n s
    edir="$(env_dir "$env")"; ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    [[ -d "$edir" ]] || { log_info "$env: 설치되지 않음 ($edir)"; return 0; }
    load_toolchain "$ldir"
    echo "환경 $env  ($edir)"
    for d in "$ldir" "$bdir"; do
        [[ -d "$d/.git" ]] && echo "  $(basename "$d")  $(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$d" rev-parse --short HEAD 2>/dev/null)  $(git -C "$d" log -1 --format='%cs %s' 2>/dev/null | cut -c1-70)"
    done
    echo "  포트  api $(llm_api_port "$ldir")  web $(llm_web_port "$ldir")  pg $(dotenv_get "$ldir/.env" POSTGRES_PORT)  redis $(dotenv_get "$ldir/.env" REDIS_PORT)  bench $(dotenv_get "$bdir/.env" OMKB_PORT)  proxy $(dotenv_get "$ldir/.env" OMK_PROXY_PORT)"
    printf "  PM2   "; for n in $(pm2_names "$env") "$OMK_PROXY_APP"; do s="$(pm2_status_of "$n")"; [[ "$s" == "-" ]] || printf '%s=%s  ' "$n" "$s"; done; echo ""
    if has docker; then printf "  docker "; docker ps --format '{{.Names}}={{.Status}}' 2>/dev/null | grep -E "^($(docker_containers "$env" | tr ' ' '|'))=" | tr '\n' ' ' || true; echo ""; fi
    printf "  health "
    curl -fsS --max-time 3 "http://localhost:$(llm_api_port "$ldir")/health" >/dev/null 2>&1 && printf 'llm=OK ' || printf 'llm=FAIL '
    [[ -d "$bdir" ]] && { curl -fsS --max-time 3 "http://localhost:$(dotenv_get "$bdir/.env" OMKB_PORT)/api/health" >/dev/null 2>&1 && printf 'bench=OK ' || printf 'bench=FAIL '; }
    echo ""
    echo "  검색  $(search_line "$ldir")"
}
cmd_env_start() {
    local env="$1" ldir bdir; ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    load_toolchain "$ldir"
    # openmake_llm.sh start 는 tty 면 로그를 계속 스트리밍한다 — 파이프로 끊는다.
    ( cd "$ldir" && ./openmake_llm.sh start < /dev/null | cat ) || die "llm 기동 실패"
    litellm_pm2_start "$env" || true
    [[ -d "$bdir" ]] && bench_pm2_start "$bdir" "$env"
    [[ -f "$(proxy_dir)/caddy.d/$env.caddy" ]] && proxy_start_or_reload
    return 0
}
cmd_env_stop() {
    local env="$1" ldir n; ldir="$(llm_dir "$env")"
    load_toolchain "$ldir"; require_pm2
    for n in "$(bench_pm2_name "$env")" "$(litellm_pm2_name "$env")"; do
        pm2 describe "$n" >/dev/null 2>&1 && pm2 stop "$n" >/dev/null && log_ok "PM2 $n 정지" || true
    done
    ( cd "$ldir" && ./openmake_llm.sh stop < /dev/null | cat ) || die "llm 정지 실패"
}
cmd_env_logs() {
    local env="$1"; load_toolchain "$(llm_dir "$env")"; require_pm2
    # pm2 logs 는 /regex/ 로 여러 앱을 한 번에 본다.
    pm2 logs "/^($(pm2_names "$env" | tr ' ' '|'))$/" --lines 50
}
cmd_env_expose() { # env [--tailscale] [--host H]… — 다른 기기에서 프록시 포트로 접속할 호스트를 허용한다
    local env="$1"; shift; local ldir hosts add="" use_ts=0 pport h
    ldir="$(llm_dir "$env")"; [[ -f "$ldir/.env" ]] || die "$ldir/.env 없음 — 'omk env install $env' 먼저"
    while [[ $# -gt 0 ]]; do
        case "$1" in --tailscale) use_ts=1 ;; --host) add="$(csv_union "$add" "${2:-}")"; shift ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift
    done
    load_toolchain "$ldir"
    hosts="$(dotenv_get "$ldir/.env" OMK_ENV_HOSTS)"
    if [[ $use_ts -eq 1 ]]; then local ts; ts="$(tailscale_hosts)"; [[ -n "$ts" ]] || die "tailscale 주소를 읽을 수 없습니다"; hosts="$(csv_union "$hosts" "$ts")"; fi
    hosts="$(csv_union "$hosts" "$add")"
    [[ -n "$hosts" ]] || usage_die "omk env expose <env> --tailscale | --host <이름>"
    dotenv_set "$ldir/.env" OMK_ENV_HOSTS "$hosts"
    env_apply_origins "$ldir"
    [[ $ORIGINS_CHANGED -eq 0 ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"
    pport="$(dotenv_get "$ldir/.env" OMK_PROXY_PORT)"
    for h in $(printf '%s' "$hosts" | tr ',' ' '); do log_info "다른 기기에서:  http://$h:$pport"; done
}
cmd_env() {
    local sub="${1:-}" env="${2:-}"
    [[ -n "$sub" && -n "$env" ]] || usage_die "omk env <install|update|reset|status|start|stop|logs|autoupdate> <env>"
    validate_env "$env"; shift 2
    case "$sub" in
        install)    cmd_env_install "$env" "$@" ;;
        update)     cmd_env_update "$env" "$@" ;;
        reset)      cmd_env_reset "$env" "$@" ;;
        status)     cmd_env_status "$env" ;;
        start)      cmd_env_start "$env" ;;
        stop)       cmd_env_stop "$env" ;;
        logs)       cmd_env_logs "$env" ;;
        autoupdate) cmd_env_autoupdate "$env" "$@" ;;
        backup)     cmd_env_backup "$env" "$@" ;;
        expose)     cmd_env_expose "$env" "$@" ;;
        *) usage_die "알 수 없는 env 명령: $sub" ;;
    esac
}

# ==============================================================================
# dev — 작업 클론에서 개발 서버를 띄운다 (PM2 아님, 포그라운드 concurrently)
# ==============================================================================
DEV_LLM=""; DEV_BENCH=""
dev_locate() {
    DEV_LLM="${OMK_DEV_LLM:-}"
    if [[ -z "$DEV_LLM" ]]; then
        local top; top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
        if [[ -n "$top" && -f "$top/openmake_llm.sh" ]]; then DEV_LLM="$top"
        elif [[ -f "$PWD/openmake_llm/openmake_llm.sh" ]]; then DEV_LLM="$PWD/openmake_llm"
        elif [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../../openmake_llm.sh" ]]; then DEV_LLM="$( cd "$SCRIPT_DIR/../.." && pwd )"
        fi
    fi
    [[ -n "$DEV_LLM" && -f "$DEV_LLM/openmake_llm.sh" ]] || die "openmake_llm 작업 클론을 찾을 수 없습니다 — 클론 안에서 실행하거나 OMK_DEV_LLM 을 지정하세요."
    case "$DEV_LLM" in "$OMK_ROOT"/*) die "dev 는 ~/.openmake 아래 설치본이 아니라 작업 클론에서 씁니다: $DEV_LLM" ;; esac
    DEV_BENCH="${OMK_DEV_BENCH:-}"
    [[ -n "$DEV_BENCH" ]] || { [[ -f "$DEV_LLM/../openmake_bench/package.json" ]] && DEV_BENCH="$( cd "$DEV_LLM/../openmake_bench" && pwd )"; }
    [[ -z "$DEV_BENCH" || -f "$DEV_BENCH/package.json" ]] || die "OMK_DEV_BENCH 가 openmake_bench 가 아닙니다: $DEV_BENCH"
}
# 백엔드는 CommonJS 라 워크스페이스 패키지(shared-types·config·api-client·local-bridge-core)를 dist 로
# 소비한다 — dist 가 없으면 `npm run dev:api`(ts-node)가 모듈을 못 찾는다. 앱 빌드(--skip-build)와는 별개다.
dev_build_packages() {
    log_info "워크스페이스 패키지 빌드 (packages/*/dist)"
    ( cd "$DEV_LLM" && npm run build:packages >/dev/null ) || die "build:packages 실패"
}
# ── dev 를 다른 기기에서 보기 ───────────────────────────────────────────────
# 웹 클라이언트는 채팅 소켓을 "접속한 호스트명:API 포트"로 붙이고(use-chat-socket.ts), 서버는 Origin 이
# CORS_ORIGINS 와 정확히 일치할 때만 받는다(security/cors-policy.ts — REST·WS 공통). 그래서 접속에 쓸
# 호스트마다 웹·API origin 을 CORS_ORIGINS 에 넣어야 하고, Next dev(allowedDevOrigins)와 vite(allowedHosts)도
# 그 호스트를 알아야 한다(모르면 HMR 이 막혀 hydration 이 죽는다). 호스트 목록은 .env 의 OMK_DEV_HOSTS 가 진실.
tailscale_hosts() { # → "짧은이름,FQDN,IPv4" (MagicDNS 기준. OS 호스트명은 쓰지 않는다)
    has tailscale && has node || return 0
    tailscale status --json 2>/dev/null | node -e '
        let j={}; try{j=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{}
        const s=j.Self||{}; const fqdn=String(s.DNSName||"").replace(/\.$/,"");
        const ip=(s.TailscaleIPs||[]).find(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x))||"";
        process.stdout.write([fqdn.split(".")[0],fqdn,ip].filter(Boolean).join(","))' 2>/dev/null || true
}
csv_union() { # $1,$2 = CSV → 순서 유지 합집합
    printf '%s,%s' "$1" "$2" | tr ',' '\n' | awk 'NF && !seen[$0]++' | paste -sd, -
}
dev_apply_hosts() { # $1=llm dir $2=hosts CSV — CORS_ORIGINS 에 호스트별 웹·API origin 을 더한다(있는 것은 그대로)
    local envf="$1/.env" hosts="$2" api web h add=""
    [[ -n "$hosts" ]] || return 0
    api="$(llm_api_port "$1")"; web="$(llm_web_port "$1")"
    for h in $(printf '%s' "$hosts" | tr ',' ' '); do add="${add:+$add,}http://$h:$web,http://$h:$api"; done
    dotenv_set "$envf" CORS_ORIGINS "$(csv_union "$(dotenv_get "$envf" CORS_ORIGINS)" "$add")"
    dotenv_set "$envf" OMK_DEV_HOSTS "$hosts"
}
dev_instance() { local v; v="$(dotenv_get "$DEV_LLM/.env" OMK_INSTANCE)"; printf '%s' "${v:-$OMK_LOCAL_INSTANCE}"; }
dev_warn_legacy() { # 예전에 'dev' 로 준비한 작업 클론 — 동작은 하지만 환경 dev 와 이름이 겹친다
    [[ "$(dev_instance)" == "dev" ]] || return 0
    log_warn "이 작업 클론은 옛 인스턴스 이름 'dev' 를 씁니다 — 환경 dev(~/.openmake/dev)와 컨테이너·포트가 겹칩니다."
    log_warn "옮기기: 'omk dev reset'(컨테이너·볼륨 삭제, 이름을 '$OMK_LOCAL_INSTANCE' 로 바꿈) → 'omk dev setup'"
}
dev_compose() { ( cd "$DEV_LLM" && docker compose --env-file .env -f infra/docker-compose.yml "$@" ); }
dev_searxng() { searxng_ensure "$DEV_LLM" "$(dev_instance)" "$DEV_LLM/.openmake/searxng" "$DEV_LLM"; }
cmd_dev_setup() {
    dev_locate; ensure_git
    local no_searxng=0; [[ "${1:-}" == "--no-searxng" ]] && no_searxng=1
    log_step "dev 준비: $DEV_LLM"
    # 툴체인·.env(OMK_INSTANCE=local)·의존성·DB·마이그레이션까지. 빌드·PM2 는 개발 서버에 필요 없다.
    # 이미 준비된 클론은 .env 의 이름을 그대로 쓴다(install.sh 는 .env 와 다른 --instance 를 거부한다).
    dev_warn_legacy
    ( cd "$DEV_LLM" && ./install.sh --yes --minimal --instance "$(dev_instance)" --skip-build --no-start ) || die "install.sh 실패"
    load_toolchain "$DEV_LLM"
    dev_build_packages
    [[ $no_searxng -eq 1 ]] && dotenv_set "$DEV_LLM/.env" OMK_SEARXNG off
    dev_searxng
    if [[ -n "$DEV_BENCH" ]]; then
        log_step "bench dev 준비: $DEV_BENCH"
        ( cd "$DEV_BENCH" && npm install --no-audit --no-fund && ( cd web && npm install --no-audit --no-fund ) ) || die "bench 의존성 설치 실패"
        mkdir -p "$DEV_BENCH/data"
        bench_ensure_env "$DEV_BENCH" "$(dev_instance)" "$(llm_api_port "$DEV_LLM")" "$(llm_web_port "$DEV_LLM")" 0 >/dev/null
    fi
    log_ok "dev 준비 완료 — 'omk dev up' 으로 기동"
}
cmd_dev_up() {
    dev_locate; dev_warn_legacy
    local target="all" hosts_arg="" use_ts=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --tailscale) use_ts=1 ;;
            --host)      hosts_arg="$(csv_union "$hosts_arg" "${2:-}")"; shift ;;
            -*)          usage_die "알 수 없는 옵션: $1" ;;
            *)           target="$1" ;;
        esac; shift
    done
    [[ -f "$DEV_LLM/.env" && -d "$DEV_LLM/node_modules" ]] || cmd_dev_setup
    load_toolchain "$DEV_LLM"
    [[ -d "$DEV_LLM/packages/shared-types/dist" ]] || dev_build_packages
    # 접속 호스트 — 이번에 준 것(--host·--tailscale)을 .env 에 기억된 것과 합친다. 한 번 주면 다음부터는 생략 가능.
    local hosts; hosts="$(dotenv_get "$DEV_LLM/.env" OMK_DEV_HOSTS)"
    [[ $use_ts -eq 1 ]] && { local ts; ts="$(tailscale_hosts)"; [[ -n "$ts" ]] || die "tailscale 주소를 읽을 수 없습니다 (tailscale CLI·로그인 확인)"; hosts="$(csv_union "$hosts" "$ts")"; }
    hosts="$(csv_union "$hosts" "$hosts_arg")"
    dev_apply_hosts "$DEV_LLM" "$hosts"
    [[ "$target" == "deps" || "$target" == "all" || "$target" == "api" ]] && { log_info "PostgreSQL/Redis 기동 (docker compose)"; dev_compose up -d; dev_searxng; }
    [[ "$target" == "deps" ]] && { cmd_dev_status; return 0; }

    # macOS 기본 bash 3.2 에는 case 의 ;;& 가 없어 if 로 나열한다.
    local names="" cmds=() api web bport=""
    api="$(llm_api_port "$DEV_LLM")"; web="$(llm_web_port "$DEV_LLM")"
    if [[ "$target" == all || "$target" == api ]]; then names="${names:+$names,}api"; cmds+=("cd '$DEV_LLM' && npm run dev:api"); fi
    # next dev 는 루트 .env 의 웹 포트를 모른다(기본 3000) → -p 로 준다. 그런데 next 는 -p 를 받으면 자기
    # 프로세스에 PORT=<웹포트> 를 세팅하고, resolve-ports.cjs 는 PORT 를 "API 포트"로 읽는다 — 그대로 두면
    # 채팅 소켓이 웹 포트로 붙는다. OMK_API_PORT 로 API 포트를 명시해 PORT 보다 앞서게 한다.
    # /api 프록시 대상도 기본값이 52416 고정이라, 주지 않으면 다른 인스턴스의 API 를 가리킨다.
    if [[ "$target" == all || "$target" == web ]]; then names="${names:+$names,}web"; cmds+=("cd '$DEV_LLM/apps/web' && OMK_API_PORT=$api OMK_DEV_HOSTS='$hosts' API_PROXY_TARGET=http://localhost:$api npm run dev -- -p $web"); fi
    if [[ "$target" == all || "$target" == bench ]]; then
        if [[ -n "$DEV_BENCH" ]]; then
            [[ -f "$DEV_BENCH/.env" ]] || bench_ensure_env "$DEV_BENCH" dev "$api" "$web" 0 >/dev/null
            bport="$(dotenv_get "$DEV_BENCH/.env" OMKB_PORT)"
            names="${names:+$names,}bench,bench-web"
            cmds+=("cd '$DEV_BENCH' && npm run dev" "cd '$DEV_BENCH' && OMKB_DEV_HOSTS='$hosts' OMKB_API_TARGET=http://localhost:$bport npm run dev:web")
        elif [[ "$target" == bench ]]; then die "openmake_bench 클론이 없습니다 (OMK_DEV_BENCH)"; fi
    fi
    [[ ${#cmds[@]} -gt 0 ]] || usage_die "omk dev up [all|deps|api|web|bench]"
    local conc=("$DEV_LLM/node_modules/.bin/concurrently")
    [[ -x "${conc[0]}" ]] || conc=(npx --yes concurrently)
    echo ""; log_info "web http://localhost:$web  api http://localhost:$api${bport:+  bench http://localhost:$bport (vite 는 web/vite.config.ts 의 port)}"
    if [[ -n "$hosts" ]]; then
        local h; for h in $(printf '%s' "$hosts" | tr ',' ' '); do log_info "다른 기기에서:  web http://$h:$web${bport:+   bench http://$h:9401}"; done
    fi
    log_info "Ctrl+C 로 전부 종료. DB/Redis 는 남는다 → 'omk dev down'"
    "${conc[@]}" -k --prefix-colors auto -n "$names" "${cmds[@]}"
}
cmd_dev_down()   { dev_locate; dev_compose stop; if searxng_owned "$(searxng_name "$(dev_instance)")" "$DEV_LLM"; then docker stop "$(searxng_name "$(dev_instance)")" >/dev/null 2>&1 || true; fi; log_ok "dev DB/Redis/SearXNG 정지 (데이터 유지)"; }
cmd_dev_status() {
    dev_locate; load_toolchain "$DEV_LLM"
    echo "dev  llm=$DEV_LLM  bench=${DEV_BENCH:-없음}"
    echo "  포트  api $(llm_api_port "$DEV_LLM")  web $(llm_web_port "$DEV_LLM")  pg $(dotenv_get "$DEV_LLM/.env" POSTGRES_PORT)  redis $(dotenv_get "$DEV_LLM/.env" REDIS_PORT)  bench $(dotenv_get "${DEV_BENCH:-/nonexistent}/.env" OMKB_PORT)"
    has docker && { printf "  docker "; docker ps --format '{{.Names}}={{.Status}}' 2>/dev/null | grep -E "^($(docker_containers dev | tr ' ' '|'))=" | tr '\n' ' ' || true; echo ""; }
    echo "  검색  $(search_line "$DEV_LLM")"
}
cmd_dev_reset() {
    dev_locate
    local keep_data=0 flags=(--yes --keep-source) what="컨테이너·볼륨(DB 데이터)"
    if [[ "${1:-}" == "--keep-data" ]]; then keep_data=1; flags+=(--keep-data); what="컨테이너"; fi
    confirm "dev 의 ${what}를 지웁니다 (소스·.env 유지). 계속할까요?" || return 0
    ( cd "$DEV_LLM" && ./uninstall.sh "${flags[@]}" ) || die "uninstall.sh 실패"
    # uninstall.sh 는 compose 것만 안다. 이름이 호스트에 하나뿐이라 다른 작업 클론의 것일 수 있다 — 라벨로 확인한다.
    if searxng_owned "$(searxng_name "$(dev_instance)")" "$DEV_LLM"; then docker rm -f "$(searxng_name "$(dev_instance)")" >/dev/null 2>&1 && log_ok "컨테이너 $(searxng_name "$(dev_instance)") 제거" || true; fi
    # 옛 이름 'dev' 는 환경 dev 와 겹친다 — 컨테이너·볼륨을 지운 김에 이름을 옮긴다(데이터는 어차피 방금 지웠다).
    if [[ "$(dev_instance)" == "dev" && $keep_data -eq 0 ]]; then dotenv_set "$DEV_LLM/.env" OMK_INSTANCE "$OMK_LOCAL_INSTANCE"; log_ok "인스턴스 이름: dev → $OMK_LOCAL_INSTANCE — 'omk dev setup' 으로 다시 준비하세요"; fi
    log_ok "dev 리셋 완료 — 'omk dev up' 으로 다시 준비"
}
cmd_dev() {
    local sub="${1:-}"; shift || true
    case "$sub" in
        setup)  cmd_dev_setup "$@" ;;
        up)     cmd_dev_up "$@" ;;
        down)   cmd_dev_down ;;
        status) cmd_dev_status ;;
        reset)  cmd_dev_reset "$@" ;;
        *) usage_die "omk dev setup|up|down|status|reset" ;;
    esac
}

# ==============================================================================
main() {
    platform_guard
    local group="${1:-}"; shift || true
    case "$group" in
        env)   cmd_env "$@" ;;
        dev)   cmd_dev "$@" ;;
        proxy) cmd_proxy "$@" ;;
        -h|--help|help|"") usage; exit 0 ;;
        *) usage_die "알 수 없는 명령: $group" ;;
    esac
}
# 테스트에서 함수만 불러 쓸 수 있게 한다 (scripts/env/omk.test.sh).
[[ "${OMK_SOURCE_ONLY:-}" == "1" ]] || main "$@"
