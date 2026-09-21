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
#   omk env install <env> [--ref BR] [--bench-ref BR] [--public-url URL] [--no-bench] [--no-proxy] [--no-searxng] [--no-runtime-images]
#                         [--llm-base-url U --llm-api-key K --llm-model M] [--autoupdate|--no-autoupdate]
#   omk env update  <env> [--if-behind]       # llm(ff-only→build→migrate→restart) → bench → proxy
#   omk env reset   <env> [--keep-data] [--keep-env] [--reinstall] [--yes]
#   omk env status|start|stop|logs <env>
#   omk env expose <env> [--tailscale] [--host H]…      # 다른 기기에서 프록시 포트로 보기 — 호스트를 CORS 에 허용(.env 에 기억)
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
}
env_dir()    { printf '%s/%s' "$OMK_ROOT" "$1"; }
llm_dir()    { printf '%s/%s/llm' "$OMK_ROOT" "$1"; }
bench_dir()  { printf '%s/%s/bench' "$OMK_ROOT" "$1"; }
logs_dir()   { printf '%s/%s/logs' "$OMK_ROOT" "$1"; }
proxy_dir()  { printf '%s/caddy' "$OMK_ROOT"; }
env_suffix() { [[ "$1" == "$OMK_DEFAULT_ENV" ]] && printf '' || printf -- '-%s' "$1"; }
# 브랜치 기본값 — 장수 브랜치는 main 하나다. staging·online 은 환경 이름일 뿐이고, dev 는 --ref 로 feature/* 를 준다.
env_default_ref() { printf 'main'; }

# 이름 규칙은 install.sh / ecosystem.config.js / infra/docker-compose.yml 과 같다.
pm2_names() { # $1=env → llm next discord bench updater
    local s; s="$(env_suffix "$1")"
    printf 'openmake-llm%s openmake-next%s openmake-discord%s openmake-bench%s omk-updater-%s' "$s" "$s" "$s" "$s" "$1"
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
    [[ -f "$dir/Caddyfile" ]] && return 0
    cat > "$dir/Caddyfile" <<EOF
# omk 가 생성 — 환경별 블록은 caddy.d/<env>.caddy (omk proxy render <env>). 이 파일은 손대지 않는다.
{
	admin $OMK_CADDY_ADMIN
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
    local key; key="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
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
    after="$(grep -E '^(MCP_SANDBOX|TASK_SANDBOX|ARTIFACT_EXEC|ARTIFACT_EXPORT)_(IMAGE|ENABLED)=' "$envf" | sort)"
    [[ "$before" == "$after" ]] || RUNTIME_CHANGED=1
    log_ok "런타임 이미지 준비: $mcp · $task"
}
runtime_images_remove() { # $1=env — 환경별 태그만 지운다. :latest 는 omk 밖에서도 쓰므로 남긴다.
    [[ "$1" != "$OMK_DEFAULT_ENV" ]] && has docker || return 0
    local i; for i in $(runtime_image_names "$1"); do docker rmi "$i" >/dev/null 2>&1 && log_ok "이미지 $i 삭제" || true; done
}

cmd_env_install() {
    local env="$1"; shift
    local ref="" bench_ref="" public_url="" no_bench=0 no_proxy=0 no_searxng=0 no_images=0 auto="" llm_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ref)          ref="${2:-}"; shift ;;
            --bench-ref)    bench_ref="${2:-}"; shift ;;
            --public-url)   public_url="${2:-}"; shift ;;
            --no-bench)     no_bench=1 ;;
            --no-proxy)     no_proxy=1 ;;
            --no-searxng)   no_searxng=1 ;;
            --no-runtime-images) no_images=1 ;;
            --autoupdate)   auto=1 ;;
            --no-autoupdate) auto=0 ;;
            --llm-base-url|--llm-api-key|--llm-model) llm_args+=("$1" "${2:-}"); shift ;;
            -y|--yes)       ASSUME_YES=1 ;;
            *) usage_die "알 수 없는 옵션: $1" ;;
        esac; shift
    done
    ref="${ref:-$(env_default_ref "$env")}"; bench_ref="${bench_ref:-$ref}"
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
    restore_env_backup "$ldir" llm
    # 빈 배열 확장은 bash 4.4 미만에서 set -u 에 걸린다 — ${arr[@]+"${arr[@]}"} 관용구로 피한다.
    ( cd "$ldir" && OMK_LOG_DIR="$(logs_dir "$env")" ./install.sh --yes ${suffix_flag[@]+"${suffix_flag[@]}"} \
        ${public_url:+--public-url "$public_url"} ${llm_args[@]+"${llm_args[@]}"} ) || die "install.sh 실패 ($env)"
    dotenv_ensure "$ldir/.env" OMK_LOG_DIR "$(logs_dir "$env")"
    load_toolchain "$ldir"

    # 1.5) 웹 검색 — .env 는 install.sh 가 만든 뒤에야 있다. 값이 바뀌면 API 만 다시 띄운다.
    [[ $no_searxng -eq 1 ]] && dotenv_set "$ldir/.env" OMK_SEARXNG off
    searxng_ensure "$ldir" "$env" "$(env_dir "$env")/searxng" "$(env_dir "$env")"
    # 1.6) 런타임 이미지 — 에이전트 작업·아티팩트 내보내기·외부 MCP 격리의 전제.
    [[ $no_images -eq 1 ]] && dotenv_set "$ldir/.env" OMK_RUNTIME_IMAGES off
    runtime_images_ensure "$ldir" "$env"
    [[ $SEARCH_CHANGED -eq 0 && $RUNTIME_CHANGED -eq 0 ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"

    # 2) openmake_bench
    [[ $no_bench -eq 1 ]] || bench_install "$env" "$bench_ref" "$ldir"

    # 3) 리버스 프록시
    [[ $no_proxy -eq 1 ]] || { proxy_render "$env"; proxy_start_or_reload; }

    # 4) 래퍼 + 자동 갱신
    install_wrapper
    [[ $auto -eq 1 ]] && cmd_env_autoupdate "$env"

    env_summary "$env"
}

cmd_env_update() {
    local env="$1"; shift; local if_behind=0
    while [[ $# -gt 0 ]]; do case "$1" in --if-behind) if_behind=1 ;; -y|--yes) ASSUME_YES=1 ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift; done
    local ldir bdir; ldir="$(llm_dir "$env")"; bdir="$(bench_dir "$env")"
    [[ -d "$ldir/.git" ]] || die "$ldir 가 없습니다 — 'omk env install $env' 먼저"
    load_toolchain "$ldir"
    if [[ $if_behind -eq 1 ]]; then
        local need=0
        repo_behind "$ldir" && need=1
        [[ -d "$bdir/.git" ]] && repo_behind "$bdir" && need=1
        [[ $need -eq 1 ]] || { log_info "$env 최신 — 갱신 없음"; return 0; }
    fi
    log_step "환경 갱신: $env"
    restore_lockfiles "$ldir"; [[ -d "$bdir/.git" ]] && restore_lockfiles "$bdir"
    searxng_ensure "$ldir" "$env" "$(env_dir "$env")/searxng" "$(env_dir "$env")"   # 뒤의 update 가 재시작하며 반영
    # llm: fetch → ff-only pull → build → migrate → restart (openmake_llm.sh 가 dirty/ff 검사 포함)
    ( cd "$ldir" && ./openmake_llm.sh update --yes < /dev/null | cat ) || die "openmake_llm.sh update 실패 ($env)"
    # 새로 받은 Dockerfile 로 빌드한다(안 바뀌었으면 캐시로 수 초). .env 가 바뀐 경우에만 한 번 더 재시작.
    runtime_images_ensure "$ldir" "$env"
    [[ $RUNTIME_CHANGED -eq 0 ]] || ( cd "$ldir" && ./openmake_llm.sh restart < /dev/null | cat ) || log_warn "API 재시작 실패 — 'omk env start $env'"
    bench_update "$env"
    [[ -f "$(proxy_dir)/caddy.d/$env.caddy" ]] && { proxy_render "$env"; proxy_start_or_reload; }
    log_ok "$env 갱신 완료"
}

cmd_env_reset() {
    local env="$1"; shift; local keep_data=0 keep_env=0 reinstall=0
    while [[ $# -gt 0 ]]; do
        case "$1" in --keep-data) keep_data=1 ;; --keep-env) keep_env=1 ;; --reinstall) reinstall=1 ;; -y|--yes) ASSUME_YES=1 ;; *) usage_die "알 수 없는 옵션: $1" ;; esac; shift
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
        runtime_images_remove "$env"   # 빌드 캐시는 남으므로 재설치 때 다시 빌드해도 빠르다
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
    [[ -n "$(dotenv_get "$ldir/.env" OMK_APP_URL | grep -E '^https?://' | grep -v localhost || true)" ]] && echo "  공개 주소  $(dotenv_get "$ldir/.env" OMK_APP_URL)"
    echo "  웹 검색   $(search_line "$ldir")"
    echo ""
    if [[ -d "$bdir" && -z "$(dotenv_get "$bdir/.env" OMK_API_KEY)" ]]; then
        printf "  %s[할 일]%s bench 가 llm 모델을 부르려면 API 키가 필요합니다 (자동 발급 불가):\n" "$C_WARN" "$C_RESET"
        echo "         llm 웹 → 설정 → API 키 → chat 스코프 키 발급 → $bdir/.env 의 OMK_API_KEY 에 넣고 'omk env start $env'"
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
    [[ -d "$bdir" ]] && bench_pm2_start "$bdir" "$env"
    [[ -f "$(proxy_dir)/caddy.d/$env.caddy" ]] && proxy_start_or_reload
    return 0
}
cmd_env_stop() {
    local env="$1" ldir n; ldir="$(llm_dir "$env")"
    load_toolchain "$ldir"; require_pm2
    n="$(bench_pm2_name "$env")"; pm2 describe "$n" >/dev/null 2>&1 && pm2 stop "$n" >/dev/null && log_ok "PM2 $n 정지" || true
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
dev_compose() { ( cd "$DEV_LLM" && docker compose --env-file .env -f infra/docker-compose.yml "$@" ); }
dev_searxng() { searxng_ensure "$DEV_LLM" dev "$DEV_LLM/.openmake/searxng" "$DEV_LLM"; }
cmd_dev_setup() {
    dev_locate; ensure_git
    local no_searxng=0; [[ "${1:-}" == "--no-searxng" ]] && no_searxng=1
    log_step "dev 준비: $DEV_LLM"
    # 툴체인·.env(OMK_INSTANCE=dev)·의존성·DB·마이그레이션까지. 빌드·PM2 는 dev 에 필요 없다.
    ( cd "$DEV_LLM" && ./install.sh --yes --instance dev --skip-build --no-start ) || die "install.sh 실패"
    load_toolchain "$DEV_LLM"
    dev_build_packages
    [[ $no_searxng -eq 1 ]] && dotenv_set "$DEV_LLM/.env" OMK_SEARXNG off
    dev_searxng
    if [[ -n "$DEV_BENCH" ]]; then
        log_step "bench dev 준비: $DEV_BENCH"
        ( cd "$DEV_BENCH" && npm install --no-audit --no-fund && ( cd web && npm install --no-audit --no-fund ) ) || die "bench 의존성 설치 실패"
        mkdir -p "$DEV_BENCH/data"
        bench_ensure_env "$DEV_BENCH" dev "$(llm_api_port "$DEV_LLM")" "$(llm_web_port "$DEV_LLM")" 0 >/dev/null
    fi
    log_ok "dev 준비 완료 — 'omk dev up' 으로 기동"
}
cmd_dev_up() {
    dev_locate
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
cmd_dev_down()   { dev_locate; dev_compose stop; if searxng_owned "$(searxng_name dev)" "$DEV_LLM"; then docker stop "$(searxng_name dev)" >/dev/null 2>&1 || true; fi; log_ok "dev DB/Redis/SearXNG 정지 (데이터 유지)"; }
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
    if searxng_owned "$(searxng_name dev)" "$DEV_LLM"; then docker rm -f "$(searxng_name dev)" >/dev/null 2>&1 && log_ok "컨테이너 $(searxng_name dev) 제거" || true; fi
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
