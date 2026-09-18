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
#     | bash -s -- env install staging --public-url https://chat-staging.example.com
#
#   omk env install <env> [--ref BR] [--bench-ref BR] [--public-url URL] [--no-bench] [--no-proxy]
#                         [--llm-base-url U --llm-api-key K --llm-model M] [--autoupdate|--no-autoupdate]
#   omk env update  <env> [--if-behind]       # llm(ff-only→build→migrate→restart) → bench → proxy
#   omk env reset   <env> [--keep-data] [--keep-env] [--reinstall] [--yes]
#   omk env status|start|stop|logs <env>
#   omk env autoupdate <env> [--every 'CRON'] [--off]   # PM2 cron 앱 omk-updater-<env>
#   omk proxy status|reload|render <env>
#   omk dev setup|up|down|status|reset [api|web|bench|deps|all]
#
# 환경변수:
#   OMK_ROOT(~/.openmake)  OMK_REPO_URL  OMKB_REPO_URL  OMK_CADDY_VERSION  OMK_CADDY_ADMIN(localhost:2019)
#   OMK_AUTOUPDATE_CRON('*/10 * * * *')  OMK_DEV_LLM  OMK_DEV_BENCH  OMKB_PORT_BASE(9400)  OMK_PROXY_PORT_BASE(33000)
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
dotenv_ensure() { # $1=file $2=key $3=default — 없을 때만 붙인다 (기존 값 존중)
    [[ -n "$(dotenv_get "$1" "$2")" ]] || dotenv_set "$1" "$2" "$3"
}

# ── 환경 이름 → 경로/이름 파생 ──────────────────────────────────────────────
validate_env() {
    [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || usage_die "환경 이름은 소문자·숫자·하이픈 1~32자: '$1'"
    [[ "$1" != "dev" ]] || usage_die "'dev' 는 작업 클론에서 'omk dev …' 로 씁니다 (~/.openmake 아래에 설치하지 않음)"
}
env_dir()    { printf '%s/%s' "$OMK_ROOT" "$1"; }
llm_dir()    { printf '%s/%s/llm' "$OMK_ROOT" "$1"; }
bench_dir()  { printf '%s/%s/bench' "$OMK_ROOT" "$1"; }
logs_dir()   { printf '%s/%s/logs' "$OMK_ROOT" "$1"; }
proxy_dir()  { printf '%s/caddy' "$OMK_ROOT"; }
env_suffix() { [[ "$1" == "$OMK_DEFAULT_ENV" ]] && printf '' || printf -- '-%s' "$1"; }
# 브랜치 기본값 — online 은 main, staging 은 staging, 그 외는 main. --ref 로 언제든 덮어쓴다.
env_default_ref() { case "$1" in staging) printf 'staging' ;; *) printf 'main' ;; esac; }

# 이름 규칙은 install.sh / ecosystem.config.js / infra/docker-compose.yml 과 같다.
pm2_names() { # $1=env → llm next discord bench updater
    local s; s="$(env_suffix "$1")"
    printf 'openmake-llm%s openmake-next%s openmake-discord%s openmake-bench%s omk-updater-%s' "$s" "$s" "$s" "$s" "$1"
}
docker_containers() { local s; s="$(env_suffix "$1")"; printf 'openmake%s-postgres openmake%s-redis' "$s" "$s"; }
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
container_workdir() { docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$1" 2>/dev/null || true; }
pm2_app_cwd() { # $1=name
    has pm2 && has node || return 0
    pm2 jlist 2>/dev/null | node -e '
        const n=process.argv[1]; let l=[]; try{l=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{}
        const p=l.find(x=>x.name===n); process.stdout.write(p?String(p.pm2_env.pm_cwd||""):"")' "$1" 2>/dev/null || true
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
}
proxy_running() { has pm2 && pm2 describe "$OMK_PROXY_APP" >/dev/null 2>&1; }
proxy_start_or_reload() {
    require_pm2; proxy_ensure_binary
    local dir; dir="$(proxy_dir)"
    "$CADDY_BIN" validate --config "$dir/Caddyfile" --adapter caddyfile >/dev/null 2>&1 \
        || die "Caddyfile 검증 실패: $dir/Caddyfile"
    if proxy_running; then
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
    proxy_running && { proxy_ensure_binary; "$CADDY_BIN" reload --config "$(proxy_dir)/Caddyfile" --adapter caddyfile --address "$OMK_CADDY_ADMIN" >/dev/null 2>&1 || true; }
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
# env install / update / reset / status / start / stop / logs
# ==============================================================================
cmd_env_install() {
    local env="$1"; shift
    local ref="" bench_ref="" public_url="" no_bench=0 no_proxy=0 auto="" llm_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ref)          ref="${2:-}"; shift ;;
            --bench-ref)    bench_ref="${2:-}"; shift ;;
            --public-url)   public_url="${2:-}"; shift ;;
            --no-bench)     no_bench=1 ;;
            --no-proxy)     no_proxy=1 ;;
            --autoupdate)   auto=1 ;;
            --no-autoupdate) auto=0 ;;
            --llm-base-url|--llm-api-key|--llm-model) llm_args+=("$1" "${2:-}"); shift ;;
            -y|--yes)       ASSUME_YES=1 ;;
            *) usage_die "알 수 없는 옵션: $1" ;;
        esac; shift
    done
    ref="${ref:-$(env_default_ref "$env")}"; bench_ref="${bench_ref:-$ref}"
    # staging 은 기본으로 자동 갱신, 그 외(online 포함)는 사람이 update 한다.
    [[ -n "$auto" ]] || { [[ "$env" == "staging" ]] && auto=1 || auto=0; }

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
    # llm: fetch → ff-only pull → build → migrate → restart (openmake_llm.sh 가 dirty/ff 검사 포함)
    ( cd "$ldir" && ./openmake_llm.sh update --yes < /dev/null | cat ) || die "openmake_llm.sh update 실패 ($env)"
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
        pm2 save --force >/dev/null 2>&1 || true
    fi
    if has docker; then
        local c v
        for c in $(docker_containers "$env"); do docker rm -f "$c" >/dev/null 2>&1 && log_ok "컨테이너 $c 제거" || true; done
        if [[ $keep_data -eq 0 ]]; then
            for v in $(docker_volumes "$env"); do docker volume rm "$v" >/dev/null 2>&1 && log_ok "볼륨 $v 삭제" || true; done
        fi
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
dev_compose() { ( cd "$DEV_LLM" && docker compose --env-file .env -f infra/docker-compose.yml "$@" ); }
cmd_dev_setup() {
    dev_locate; ensure_git
    log_step "dev 준비: $DEV_LLM"
    # 툴체인·.env(OMK_INSTANCE=dev)·의존성·DB·마이그레이션까지. 빌드·PM2 는 dev 에 필요 없다.
    ( cd "$DEV_LLM" && ./install.sh --yes --instance dev --skip-build --no-start ) || die "install.sh 실패"
    load_toolchain "$DEV_LLM"
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
    local target="${1:-all}"
    [[ -f "$DEV_LLM/.env" && -d "$DEV_LLM/node_modules" ]] || cmd_dev_setup
    load_toolchain "$DEV_LLM"
    [[ "$target" == "deps" || "$target" == "all" || "$target" == "api" ]] && { log_info "PostgreSQL/Redis 기동 (docker compose)"; dev_compose up -d; }
    [[ "$target" == "deps" ]] && { cmd_dev_status; return 0; }

    # macOS 기본 bash 3.2 에는 case 의 ;;& 가 없어 if 로 나열한다.
    local names="" cmds=() api web bport=""
    api="$(llm_api_port "$DEV_LLM")"; web="$(llm_web_port "$DEV_LLM")"
    if [[ "$target" == all || "$target" == api ]]; then names="${names:+$names,}api"; cmds+=("cd '$DEV_LLM' && npm run dev:api"); fi
    if [[ "$target" == all || "$target" == web ]]; then names="${names:+$names,}web"; cmds+=("cd '$DEV_LLM' && npm run dev:frontend-next"); fi
    if [[ "$target" == all || "$target" == bench ]]; then
        if [[ -n "$DEV_BENCH" ]]; then
            [[ -f "$DEV_BENCH/.env" ]] || bench_ensure_env "$DEV_BENCH" dev "$api" "$web" 0 >/dev/null
            bport="$(dotenv_get "$DEV_BENCH/.env" OMKB_PORT)"
            names="${names:+$names,}bench,bench-web"
            cmds+=("cd '$DEV_BENCH' && npm run dev" "cd '$DEV_BENCH' && OMKB_API_TARGET=http://localhost:$bport npm run dev:web")
        elif [[ "$target" == bench ]]; then die "openmake_bench 클론이 없습니다 (OMK_DEV_BENCH)"; fi
    fi
    [[ ${#cmds[@]} -gt 0 ]] || usage_die "omk dev up [all|deps|api|web|bench]"
    local conc=("$DEV_LLM/node_modules/.bin/concurrently")
    [[ -x "${conc[0]}" ]] || conc=(npx --yes concurrently)
    echo ""; log_info "web http://localhost:$web  api http://localhost:$api${bport:+  bench http://localhost:$bport (vite 는 web/vite.config.ts 의 port)}"
    log_info "Ctrl+C 로 전부 종료. DB/Redis 는 남는다 → 'omk dev down'"
    "${conc[@]}" -k --prefix-colors auto -n "$names" "${cmds[@]}"
}
cmd_dev_down()   { dev_locate; dev_compose stop; log_ok "dev DB/Redis 정지 (데이터 유지)"; }
cmd_dev_status() {
    dev_locate; load_toolchain "$DEV_LLM"
    echo "dev  llm=$DEV_LLM  bench=${DEV_BENCH:-없음}"
    echo "  포트  api $(llm_api_port "$DEV_LLM")  web $(llm_web_port "$DEV_LLM")  pg $(dotenv_get "$DEV_LLM/.env" POSTGRES_PORT)  redis $(dotenv_get "$DEV_LLM/.env" REDIS_PORT)  bench $(dotenv_get "${DEV_BENCH:-/nonexistent}/.env" OMKB_PORT)"
    has docker && { printf "  docker "; docker ps --format '{{.Names}}={{.Status}}' 2>/dev/null | grep -E "^($(docker_containers dev | tr ' ' '|'))=" | tr '\n' ' ' || true; echo ""; }
}
cmd_dev_reset() {
    dev_locate
    local keep_data=0 flags=(--yes --keep-source) what="컨테이너·볼륨(DB 데이터)"
    if [[ "${1:-}" == "--keep-data" ]]; then keep_data=1; flags+=(--keep-data); what="컨테이너"; fi
    confirm "dev 의 ${what}를 지웁니다 (소스·.env 유지). 계속할까요?" || return 0
    ( cd "$DEV_LLM" && ./uninstall.sh "${flags[@]}" ) || die "uninstall.sh 실패"
    log_ok "dev 리셋 완료 — 'omk dev up' 으로 다시 준비"
}
cmd_dev() {
    local sub="${1:-}"; shift || true
    case "$sub" in
        setup)  cmd_dev_setup ;;
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
