#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM 통합 서비스 매니저
# ==============================================================================
# 3계층 의존성을 순차 기동/정지/상태확인:
#   Layer 1: PostgreSQL      (docker 컨테이너 — DATABASE_URL=127.0.0.1:5432)
#   Layer 2: Redis           (docker 컨테이너 — REDIS_URL=localhost:6379)
#   Layer 3: OpenMake LLM    (PM2 — ecosystem.config.js, PORT=52416)
#
# NOTE: LLM 추론은 외부 서버(vLLM/LiteLLM, OpenAI 호환 API)로 위임되어
#       로컬 Ollama 데몬은 더 이상 기동하지 않는다. `LLM_*` 환경변수 참조.
#
# 사용법:
#   ./openmake_llm.sh install    # 최초 1회 원샷 설치 (install.sh 위임)
#   ./openmake_llm.sh start      # 의존성 → 앱 순서로 기동 (빌드/마이그레이션 X)
#                                # 기동 후 실시간 로그 스트리밍 지속 (Ctrl+C로 종료)
#   ./openmake_llm.sh stop       # 앱 → 의존성 역순으로 정지
#   ./openmake_llm.sh restart    # PM2 앱만 재시작 (코드 반영 X — 환경변수 변경 등)
#                                # 재시작 후 실시간 로그 스트리밍 지속 (Ctrl+C로 종료)
#   ./openmake_llm.sh build      # npm run build (backend tsc + frontend Next.js build 산출물 생성)
#   ./openmake_llm.sh migrate    # DB 마이그레이션 적용 (status로 사전 확인 권장)
#   ./openmake_llm.sh deploy     # build + migrate + restart + Caddy 설정 동기화 (코드 변경 운영 반영)
#                                # 옵션: --yes (확인 skip), --no-migrate (마이그 생략)
#   ./openmake_llm.sh status     # 모든 계층 상태 확인
#   ./openmake_llm.sh logs       # OpenMake LLM 실시간 로그
#   ./openmake_llm.sh health     # /health 엔드포인트 응답 확인
#   ./openmake_llm.sh db-dump [파일]     # DB 전체 덤프 (pg_dump -Fc) — 다른 호스트로 옮길 때
#   ./openmake_llm.sh db-restore <파일>  # 덤프를 이 인스턴스 DB 에 복원 → 마이그레이션 → 앱 재시작
#
# 인스턴스: .env 의 OMK_INSTANCE(install.sh --instance NAME)가 있으면 PM2 앱 이름이
#   openmake-llm-<이름>/openmake-next-<이름>, 컨테이너가 openmake-<이름>-postgres 가 된다.
#   이 스크립트는 자기 디렉터리의 .env 만 보므로 설치본 각각의 디렉터리에서 실행하면 된다.
#
# 환경 가정 (Linux / macOS 공통):
#   - PostgreSQL/Redis는 docker compose 로 관리 (2026-06-21 brew postgresql@16 제거 → docker 단독)
#     · compose 위치: ./infra/docker-compose.yml (COMPOSE_FILE env 로 override 가능)
#   - OpenMake LLM 앱은 PM2로 관리
#   - Node 24+ 활성화 상태 (mise / nvm / fnm, 또는 install.sh 가 준비한 .openmake/toolchain.env)
#
# 종료 코드:
#   0  성공
#   1  의존성 누락 (docker/pm2/curl 미설치)
#   2  서비스 기동/정지 실패
#   3  health check 실패
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
readonly SCRIPT_DIR

# install.sh 가 홈 디렉터리에 Node/PM2 를 설치한 경우 그 PATH 를 이어받는다.
# (시스템에 Node 24 / pm2 가 없어도 이 스크립트가 그대로 동작하도록.)
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/.openmake/toolchain.env" ]] && . "$SCRIPT_DIR/.openmake/toolchain.env"

# .env 에서 키 하나만 추출한다 (전체 source 안 함 — 값에 공백/특수문자가 있어도 안전).
# `|| true` 필수: 키가 없으면 grep 이 1 로 끝나고 pipefail+set -e 가 스크립트를 즉시 종료시킨다.
env_line() {
    [[ -f "$SCRIPT_DIR/.env" ]] || return 0
    grep -E "^$1=" "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ' || true
}

# 인스턴스 접미사 — ecosystem.config.js(resolve-ports.cjs)·infra/docker-compose.yml 과 같은 규칙으로
# PM2 앱·docker 컨테이너 이름을 만든다 (.env 의 OMK_INSTANCE 하나가 단일 출처).
_instance="$(env_line OMK_INSTANCE)"
readonly INSTANCE="$_instance"
readonly APP_NAME="openmake-llm${INSTANCE:+-$INSTANCE}"
readonly FRONT_APP_NAME="openmake-next${INSTANCE:+-$INSTANCE}"
readonly PG_CONTAINER="openmake${INSTANCE:+-$INSTANCE}-postgres"

# Caddy 리버스 프록시 설정 — 이 레포가 SoT.
#
# ⚠️ 운영 경로(/opt/homebrew/etc/Caddyfile)는 원래 이 파일로의 심링크였으나, launchd
# 서비스가 외장 볼륨(/Volumes/...)을 읽지 못해(TCC: "operation not permitted") 실파일로
# 교체했다. 그래서 레포 변경이 더는 자동 반영되지 않는다 — 배포마다 여기서 복사한다.
# 단, .env 에 OMK_PROXY_DIR 이 있으면(scripts/env/omk.sh 가 관리하는 인스턴스) 이 동기화는 건너뛴다 — sync_caddyfile 참고.
readonly CADDYFILE_SRC_REL="scripts/caddy/Caddyfile"
CADDYFILE_DEST="${CADDYFILE_DEST:-/opt/homebrew/etc/Caddyfile}"

# .env 의 KEY=VALUE 를 현재 셸에 export 한다 — `pm2 restart --update-env` 가 .env 편집을 실제로
# 반영하게 하는 유일한 경로. PM2 는 최초 `pm2 start` 시점의 env 스냅샷을 프로세스에 계속 주입하고
# 앱의 dotenv 는 이미 있는 값을 덮어쓰지 않으므로, 여기서 export 하지 않으면 .env 를 고쳐도 재시작
# 뒤에 옛 값이 남는다 (2026-09-04: LLM_REASONING_EFFORTS_JSON 이 하루 넘게 stale → B.AI 400).
# `source .env` 대신 줄 단위 파싱 — 값의 공백/특수문자에 셸 해석이 걸리지 않는다. 주석·빈 줄은
# 건너뛰고, 값 전체를 감싼 한 쌍의 따옴표만 벗긴다(dotenv 와 같은 규칙).
export_dotenv_for_pm2() {
    local file="$SCRIPT_DIR/.env" line key val
    [[ -f "$file" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line#export }"
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        [[ "$line" == *=* ]] || continue
        key="${line%%=*}"
        val="${line#*=}"
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
            val="${BASH_REMATCH[1]}"
        fi
        # 이 스크립트가 readonly 로 선언한 이름(COMPOSE_FILE·APP_NAME 등)은 export 가 실패하고
        # set -e 가 deploy 를 재시작 직전에 조용히 끝낸다(2026-09-04 실사고: 빌드·마이그레이션만 되고
        # pm2 미재시작). 그런 키는 건너뛴다 — 스크립트 내부 상수라 pm2 에 넘길 대상도 아니다.
        if readonly -p 2>/dev/null | grep -q " $key="; then
            continue
        fi
        export "$key=$val"
    done < "$file"
}

# 포트 우선순위: 셸 환경변수 > .env > 기본값.
# .env 를 봐야 하는 이유 — 기본 포트가 이미 점유돼 install.sh --postgres-port 등으로
# 다른 포트에 띄운 경우, .env 를 무시하면 status/기동대기가 엉뚱한 포트를 본다.
_app_port="${PORT:-$(env_line PORT)}"
_pg_port="${POSTGRES_PORT:-$(env_line POSTGRES_PORT)}"
_rd_port="${REDIS_PORT:-$(env_line REDIS_PORT)}"
readonly APP_PORT="${_app_port:-52416}"
readonly POSTGRES_PORT="${_pg_port:-5432}"
readonly REDIS_PORT="${_rd_port:-6379}"

# DB/Redis 는 docker compose 로 운영 (2026-06-21 brew postgresql@16 제거 → docker 단독).
# COMPOSE_FILE 로 compose 위치 지정. 우선순위: 셸 환경변수 > .env > 기본값(레포의 infra/docker-compose.yml).
_compose_file="${COMPOSE_FILE:-$(env_line COMPOSE_FILE)}"
readonly COMPOSE_FILE="${_compose_file:-$SCRIPT_DIR/infra/docker-compose.yml}"
readonly HEALTH_RETRIES=15
readonly HEALTH_INTERVAL=2

# canary-deploy 전용 설정 — 새 빌드를 실제 트래픽 포트에 반영하기 전에
# 별도 포트에서 임시로 띄워 헬스체크한다 (S4 배포·운영 자동화, 아래 cmd_canary_deploy 참고).
_canary_port="${CANARY_HEALTH_PORT:-$(env_line CANARY_HEALTH_PORT)}"
readonly CANARY_HEALTH_PORT="${_canary_port:-$((APP_PORT + 1000))}"
_canary_retries="${CANARY_HEALTH_RETRIES:-$(env_line CANARY_HEALTH_RETRIES)}"
readonly CANARY_HEALTH_RETRIES="${_canary_retries:-20}"
_canary_interval="${CANARY_HEALTH_INTERVAL:-$(env_line CANARY_HEALTH_INTERVAL)}"
readonly CANARY_HEALTH_INTERVAL="${_canary_interval:-3}"
_canary_release_dir="${CANARY_RELEASE_DIR:-$(env_line CANARY_RELEASE_DIR)}"
readonly CANARY_RELEASE_DIR="${_canary_release_dir:-$SCRIPT_DIR/.releases}"
_canary_keep="${CANARY_KEEP_RELEASES:-$(env_line CANARY_KEEP_RELEASES)}"
readonly CANARY_KEEP_RELEASES="${_canary_keep:-3}"

# ── 색상 출력 ────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    readonly C_RESET=$'\033[0m'
    readonly C_INFO=$'\033[1;34m'    # 파란색
    readonly C_OK=$'\033[1;32m'      # 초록색
    readonly C_WARN=$'\033[1;33m'    # 노란색
    readonly C_ERR=$'\033[1;31m'     # 빨간색
    readonly C_DIM=$'\033[2m'
else
    readonly C_RESET=""
    readonly C_INFO=""
    readonly C_OK=""
    readonly C_WARN=""
    readonly C_ERR=""
    readonly C_DIM=""
fi

log_info()  { printf "%s[INFO]%s  %s\n"  "$C_INFO" "$C_RESET" "$*"; }
log_ok()    { printf "%s[OK]%s    %s\n"  "$C_OK"   "$C_RESET" "$*"; }
log_warn()  { printf "%s[WARN]%s  %s\n"  "$C_WARN" "$C_RESET" "$*"; }
log_err()   { printf "%s[ERR]%s   %s\n"  "$C_ERR"  "$C_RESET" "$*" >&2; }
log_step()  { printf "\n%s━━ %s ━━%s\n"  "$C_INFO" "$*" "$C_RESET"; }

# ── 사전 점검 ────────────────────────────────────────────────────────────────
require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        log_err "필수 명령 미설치: $cmd"
        return 1
    fi
}

preflight() {
    local missing=0
    # lsof 는 필수가 아니다 — 리눅스 최소 이미지에는 없는 경우가 많아
    # port_listening 이 ss/netstat//dev/tcp 로 대체한다.
    for cmd in docker pm2 curl node npm; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_err "필수 명령 미설치: $cmd"
            missing=1
        fi
    done
    if [[ $missing -ne 0 ]]; then
        log_info "최초 설치라면 './install.sh' 를 먼저 실행하세요."
        exit 1
    fi
}

# ── 포트 점검 헬퍼 ────────────────────────────────────────────────────────────
# 도구 가용성이 배포판마다 달라 4단계로 폴백한다:
#   lsof(macOS 기본) → ss(최신 리눅스) → netstat(구형) → bash /dev/tcp(무도구)
port_listening() {
    local port="$1"
    # 각 도구의 "못 찾음"은 단정이 아니다 — 비루트 lsof 는 root 소유
    # docker-proxy 소켓을 못 봐서, 여기서 return 1 로 끊으면 컨테이너 포트가
    # 항상 미응답으로 오판된다 (start 가 postgres 대기에서 죽던 원인).
    # 긍정(발견)만 즉시 반환하고, 부정은 다음 도구로 계속 내려간다.
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN && return 0
    fi
    if command -v netstat >/dev/null 2>&1; then
        netstat -an 2>/dev/null | grep -qE "[.:]${port}[[:space:]].*LISTEN" && return 0
    fi
    # 최종 판정 — 실제 연결을 시도한다 (localhost 바인딩만 감지 가능).
    (exec 3<>/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1 && return 0
    return 1
}

wait_for_port() {
    local port="$1"
    local label="$2"
    local i
    for ((i=1; i<=HEALTH_RETRIES; i++)); do
        if port_listening "$port"; then
            log_ok "$label 포트 $port LISTEN 확인 (${i}회 시도)"
            return 0
        fi
        sleep "$HEALTH_INTERVAL"
    done
    log_err "$label 포트 $port 응답 없음 (${HEALTH_RETRIES}회 시도 실패)"
    return 1
}

# PM2 앱 부팅 중 로그를 스트리밍하면서 포트 LISTEN을 대기.
# 실패 시 최근 로그 덤프로 즉시 진단 가능하게 한다.
wait_for_app_with_logs() {
    local port="$1"
    local label="$2"
    local max_seconds=$((HEALTH_RETRIES * HEALTH_INTERVAL))

    log_info "$label 시작 로그 스트리밍 (포트 $port 대기, 최대 ${max_seconds}s)"
    printf "%s──────── PM2 logs (stream) ────────%s\n" "$C_DIM" "$C_RESET"

    # 백그라운드 스트리밍 — restart 시 잔여 라인 5줄 + 신규 출력
    pm2 logs "$APP_NAME" --lines 5 &
    local tail_pid=$!

    local i ok=0
    for ((i=1; i<=HEALTH_RETRIES; i++)); do
        if port_listening "$port"; then
            ok=1
            break
        fi
        sleep "$HEALTH_INTERVAL"
    done

    # 스트리밍 종료 — set -e 환경에서 SIGTERM 종료코드(143) 가드
    kill "$tail_pid" 2>/dev/null || true
    wait "$tail_pid" 2>/dev/null || true
    printf "%s──────── PM2 logs (end) ───────────%s\n" "$C_DIM" "$C_RESET"

    if [[ $ok -eq 1 ]]; then
        log_ok "$label 포트 $port LISTEN 확인 (${i}회 시도, ~$((i * HEALTH_INTERVAL))s)"
        return 0
    fi

    log_err "$label 포트 $port 응답 없음 (${max_seconds}s 초과) — 최근 100줄 덤프:"
    pm2 logs "$APP_NAME" --lines 100 --nostream 2>/dev/null || true
    return 1
}

# ── docker compose 헬퍼 (DB/Redis 운영) ──────────────────────────────────────
# 플러그인형(docker compose) 우선, 없으면 standalone 바이너리(docker-compose) 폴백.
# (Homebrew 는 플러그인을 기본 탐색 경로 밖에 두므로 standalone 폴백이 실제로 쓰인다.
#  ~/.docker/config.json 자동 등록은 install.sh 담당 — 여기서 사용자 설정을 건드리지 않는다.)
compose_cmd() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        return 1
    fi
}

ensure_docker_service() {
    # $1=up|down  $2=service  $3=label
    local action="$1" svc="$2" label="$3"
    if ! command -v docker >/dev/null 2>&1; then
        log_err "docker 미설치 — docker 를 설치하세요 (DB/Redis 는 docker compose 로 운영)"
        return 2
    fi
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_err "compose 파일을 찾을 수 없음: $COMPOSE_FILE"
        return 2
    fi

    local dc
    if ! dc="$(compose_cmd)"; then
        log_err "docker compose 를 찾을 수 없음 (Compose v2 설치 필요)"
        return 2
    fi

    # compose 파일이 infra/ 에 있으면 project directory 도 infra/ 라서 compose 가 infra/.env 를
    # 찾는다 → 루트 .env 의 POSTGRES_PASSWORD 가 안 읽혀 `:?` 로 기동이 실패한다.
    # 루트 .env 를 명시적으로 넘겨 이 함정을 없앤다.
    local env_args=()
    [[ -f "$SCRIPT_DIR/.env" ]] && env_args=(--env-file "$SCRIPT_DIR/.env")

    if [[ "$action" == "up" ]]; then
        log_info "$label 시작 중 ($dc up -d $svc)"
        if ! $dc ${env_args[@]+"${env_args[@]}"} -f "$COMPOSE_FILE" up -d "$svc" >/dev/null 2>&1; then
            log_err "$label docker 기동 실패 — $dc -f $COMPOSE_FILE logs $svc 확인"
            return 2
        fi
    else
        log_info "$label 정지 중 ($dc stop $svc)"
        $dc ${env_args[@]+"${env_args[@]}"} -f "$COMPOSE_FILE" stop "$svc" >/dev/null 2>&1 || log_warn "$label docker 정지 실패(이미 정지일 수 있음)"
    fi
}

# ── 3계층 액션 ────────────────────────────────────────────────────────────────
start_postgres() {
    log_step "Layer 1/3: PostgreSQL"
    ensure_docker_service up postgres "PostgreSQL"
    wait_for_port "$POSTGRES_PORT" "PostgreSQL"
}

start_redis() {
    log_step "Layer 2/3: Redis"
    ensure_docker_service up redis "Redis"
    wait_for_port "$REDIS_PORT" "Redis"
}

start_app() {
    log_step "Layer 3/3: OpenMake LLM (PM2)"

    # build 산출물 확인 — 백엔드(dist/cli.js) + 프론트(apps/web/.next/BUILD_ID) 둘 다 필요.
    # 프론트가 없으면 ecosystem.config.js 의 openmake-next 가 next start 를 못 올리므로
    # start/restart 시 함께 빌드하도록 강제한다.
    if [[ ! -f "$SCRIPT_DIR/apps/api/dist/cli.js" ]] || [[ ! -f "$SCRIPT_DIR/apps/web/.next/BUILD_ID" ]]; then
        log_warn "빌드 산출물 없음(backend dist/cli.js 또는 frontend apps/web/.next/BUILD_ID) — 'npm run build' 먼저 실행 필요"
        log_info "수행 중: cd $SCRIPT_DIR && npm run build"
        ( cd "$SCRIPT_DIR" && npm run build ) || {
            log_err "빌드 실패"
            return 2
        }
    fi

    # PM2 프로세스 존재 여부 확인
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        log_info "$APP_NAME 이미 등록됨 — restart 시도"
        export_dotenv_for_pm2
        pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || {
            log_err "$APP_NAME restart 실패"
            return 2
        }
    else
        log_info "$APP_NAME 신규 시작 (ecosystem.config.js)"
        ( cd "$SCRIPT_DIR" && pm2 start ecosystem.config.js ) || {
            log_err "$APP_NAME 시작 실패"
            return 2
        }
    fi

    wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"
}

stop_app() {
    log_step "정지 1/3: OpenMake LLM (PM2)"
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        pm2 stop "$APP_NAME" >/dev/null 2>&1 || log_warn "$APP_NAME stop 명령 실패"
        log_ok "$APP_NAME 정지"
    else
        log_ok "$APP_NAME PM2에 등록되지 않음 (이미 정지)"
    fi
}

stop_redis() {
    log_step "정지 2/3: Redis"
    ensure_docker_service down redis "Redis"
}

stop_postgres() {
    log_step "정지 3/3: PostgreSQL"
    ensure_docker_service down postgres "PostgreSQL"
}

# ── 상태 / 헬스 ───────────────────────────────────────────────────────────────
print_status_row() {
    local label="$1"
    local check="$2"  # "ok" or "fail"
    local detail="${3:-}"
    if [[ "$check" == "ok" ]]; then
        printf "  %s✓%s %-20s %s\n" "$C_OK" "$C_RESET" "$label" "$detail"
    else
        printf "  %s✗%s %-20s %s\n" "$C_ERR" "$C_RESET" "$label" "$detail"
    fi
}

show_status() {
    log_step "OpenMake LLM 서비스 상태"

    # PostgreSQL (docker)
    if port_listening "$POSTGRES_PORT"; then
        print_status_row "PostgreSQL ($POSTGRES_PORT)" "ok" "docker"
    else
        print_status_row "PostgreSQL ($POSTGRES_PORT)" "fail" "포트 미응답"
    fi

    # Redis (docker)
    if port_listening "$REDIS_PORT"; then
        print_status_row "Redis ($REDIS_PORT)" "ok" "docker"
    else
        print_status_row "Redis ($REDIS_PORT)" "fail" "포트 미응답"
    fi

    # OpenMake LLM (PM2)
    local pm2_status="not-installed"
    if command -v pm2 >/dev/null 2>&1; then
        local pm2_raw=""
        if pm2_raw="$(pm2 jlist 2>/dev/null | node -e "
            let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
                try { const arr=JSON.parse(raw||'[]');
                    const app=arr.find(a=>a.name==='$APP_NAME');
                    if(!app){console.log('not-registered');return;}
                    console.log(app.pm2_env.status);
                } catch { console.log('parse-error'); }
            });
        " 2>/dev/null)"; then
            pm2_status="$pm2_raw"
        else
            pm2_status="query-fail"
        fi
    fi

    if port_listening "$APP_PORT"; then
        print_status_row "OpenMake LLM ($APP_PORT)" "ok" "PM2: $pm2_status"
    else
        print_status_row "OpenMake LLM ($APP_PORT)" "fail" "PM2: $pm2_status"
    fi
    echo ""
}

show_health() {
    log_step "Health Check"
    require_cmd curl || return 1
    local url="http://localhost:$APP_PORT/health"
    log_info "GET $url"
    if curl -fsS --max-time 5 "$url" 2>/dev/null; then
        echo ""
        log_ok "Health check 성공"
    else
        echo ""
        log_err "Health check 실패 — 앱 미응답 또는 /health 엔드포인트 부재"
        return 3
    fi
}

show_logs() {
    log_step "OpenMake LLM 실시간 로그 (Ctrl+C로 종료)"
    require_cmd pm2 || return 1
    pm2 logs "$APP_NAME" --lines 50
}

# 기동 완료 후 로그 스트리밍으로 전환 — 비대화형(CI/백그라운드)에서는
# 무한 블로킹을 피하기 위해 TTY일 때만 스트리밍한다.
follow_logs_if_tty() {
    if [[ -t 1 ]]; then
        show_logs
    else
        log_info "비대화형 환경 — 로그 스트리밍 생략 ('$0 logs' 로 확인)"
    fi
}

# ── 메인 디스패처 ────────────────────────────────────────────────────────────
cmd_start() {
    preflight
    start_postgres
    start_redis
    start_app
    echo ""
    log_ok "전체 3계층 기동 완료"
    show_status
    follow_logs_if_tty
}

cmd_stop() {
    preflight
    stop_app
    stop_redis
    stop_postgres
    echo ""
    log_ok "전체 정지 완료"
}

cmd_restart() {
    # 문서 명세대로 PM2 앱만 재시작 (의존성 Postgres/Redis는 그대로 유지).
    # 코드 반영이 필요하면 deploy 사용.
    preflight
    start_app
    echo ""
    log_ok "OpenMake LLM 앱 재시작 완료 (의존성은 유지)"
    show_status
    follow_logs_if_tty
}

# ── build / migrate / deploy ───────────────────────────────────────────────────

# 새 빌드 산출물을 실행 중인 프로세스에 반영한다.
# 프론트(next start)는 .next 를 기동 시점에 읽으므로, 재빌드 후 재시작하지 않으면
# 옛 모듈 그래프가 이미 사라진 청크를 요구해 전 페이지가 500 이 된다
# (2026-08-20 장애: ChunkLoadError — 빌드만 하고 재시작을 빠뜨린 경우).
# PM2 미등록 앱은 건너뛴다 (최초 설치 중 빌드 등).
restart_built_apps() {
    local restarted=0 app
    export_dotenv_for_pm2
    for app in "$APP_NAME" "$FRONT_APP_NAME"; do
        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$app\""; then
            if pm2 restart "$app" --update-env >/dev/null 2>&1; then
                log_ok "$app 재시작"
                restarted=1
            else
                log_warn "$app restart 실패 — 'pm2 restart $app' 수동 확인 필요"
            fi
        fi
    done
    if [[ "$restarted" -eq 0 ]]; then
        log_info "PM2 등록 앱 없음 — 재시작 생략"
    fi
    return 0
}

# 사용법: cmd_build [--no-restart]
#   기본은 빌드 성공 후 PM2 앱을 재시작한다.
#   deploy 는 마이그레이션 뒤에 자체 재시작을 수행하므로 --no-restart 로 호출한다
#   (여기서 재시작하면 새 코드가 옛 스키마로 먼저 뜨고, 이중 재시작이 된다).
cmd_build() {
    # set -e 하에서 `[[ ]] && x` 는 조건 거짓 시 리스트 상태가 1 이 되어 스크립트를 죽인다 — if 로 쓴다.
    local do_restart=1
    if [[ "${1:-}" == "--no-restart" ]]; then
        do_restart=0
    fi

    log_step "npm run build (backend tsc + apps/web Next.js 빌드)"
    if ! ( cd "$SCRIPT_DIR" && npm run build ); then
        log_err "빌드 실패 — 후속 작업 중단"
        return 2
    fi
    log_ok "빌드 완료"

    if [[ "$do_restart" -eq 1 ]]; then
        log_step "PM2 앱 재시작 (새 빌드 반영)"
        restart_built_apps
    fi
}

cmd_migrate() {
    log_step "DB 마이그레이션 (status → migrate)"

    # 마이그레이션 CLI는 cli.ts 상단에서 dotenv 를 직접 로드하므로
    # 스크립트는 .env 파일이 존재하는지만 확인하고 그대로 위임한다.
    local env_file="$SCRIPT_DIR/.env"
    if [[ ! -f "$env_file" ]]; then
        log_err ".env 파일을 찾을 수 없음: $env_file"
        return 2
    fi

    log_info "현재 마이그레이션 상태 조회"
    if ! ( cd "$SCRIPT_DIR/apps/api" && npx ts-node src/data/migrations/cli.ts status ); then
        log_err "마이그레이션 status 조회 실패"
        return 2
    fi
    echo ""
    log_info "마이그레이션 적용 중"
    if ! ( cd "$SCRIPT_DIR/apps/api" && npx ts-node src/data/migrations/cli.ts migrate ); then
        log_err "마이그레이션 적용 실패 — 후속 작업 중단"
        return 2
    fi
    log_ok "마이그레이션 완료"
}

# 옵션 파싱: --yes, --no-migrate
parse_deploy_opts() {
    DEPLOY_YES=0
    DEPLOY_NO_MIGRATE=0
    for arg in "$@"; do
        case "$arg" in
            --yes|-y) DEPLOY_YES=1 ;;
            --no-migrate) DEPLOY_NO_MIGRATE=1 ;;
            *)
                log_err "알 수 없는 deploy 옵션: $arg"
                echo "  지원: --yes, --no-migrate"
                exit 1
                ;;
        esac
    done
}

confirm_or_exit() {
    local prompt="$1"
    if [[ "$DEPLOY_YES" -eq 1 ]] || [[ "${OMK_DEPLOY_SKIP_CONFIRM:-0}" == "1" ]]; then
        log_info "확인 자동 통과 (--yes 또는 OMK_DEPLOY_SKIP_CONFIRM=1)"
        return 0
    fi
    if [[ ! -t 0 ]]; then
        log_err "비대화형 환경 — --yes 플래그 또는 OMK_DEPLOY_SKIP_CONFIRM=1 필요"
        exit 1
    fi
    read -r -p "$(printf '%s%s%s [y/N]: ' "$C_WARN" "$prompt" "$C_RESET")" reply
    case "$reply" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) log_warn "사용자 거부 — deploy 중단"; exit 0 ;;
    esac
}

# ── update: 설치본 최신화 (git ff-only pull → deploy 위임) ──────────────────
# 설치자(install.sh 사용자) 대상의 표준 업데이트 경로. 원칙:
#   · ff-only — 로컬 커밋이 있으면 히스토리를 합치지 않고 중단(설치본 변형 보호)
#   · 미커밋 변경 감지 시 중단 안내(덮어쓰기 없음) — 개발 트리 오염 방지
#   · 변경 없으면 deploy 를 건너뛴다(무의미한 재시작 방지, --force 로 강제)
cmd_update() {
    local FORCE=0 PASS=()
    for arg in "$@"; do
        case "$arg" in
            --force) FORCE=1 ;;
            *) PASS+=("$arg") ;;   # --yes / --no-migrate 는 deploy 로 전달
        esac
    done
    parse_deploy_opts "${PASS[@]}"

    log_step "Update: git pull(ff-only) → deploy"
    command -v git >/dev/null 2>&1 || { log_err "git 이 필요합니다"; exit 1; }
    git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || { log_err "git 레포가 아닙니다 — tarball 설치본은 재설치(install.sh)로 갱신하세요"; exit 1; }

    # install.sh 의 `npm install` 은 package-lock.json 을 다시 쓴다 — lock 의 워크스페이스 버전이
    # package.json 보다 낡아 있으면(release-please 는 lock 을 갱신하지 않는다) 설치만 해도 lock 이
    # 바뀐 채 남고, 아래 검사가 첫 update 부터 막는다(2026-09-18: 설치본 3곳 전부 이 상태였다).
    # lock 은 설치의 부산물이지 사람의 편집이 아니므로 되돌리고 진행한다. 그 밖의 변경은 그대로 막는다.
    local _dirty _f
    _dirty="$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null | awk '{print $2}')"
    for _f in $_dirty; do
        case "$_f" in
            package-lock.json|*/package-lock.json)
                git -C "$SCRIPT_DIR" checkout -- "$_f" && log_info "설치가 다시 쓴 $_f 를 되돌렸습니다 (update 전 정리)" ;;
        esac
    done

    if [[ -n "$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null)" ]]; then
        log_err "미커밋 로컬 변경이 있어 업데이트를 중단합니다 (덮어쓰지 않음)."
        echo "  변경을 정리(commit/stash)한 뒤 다시 실행하세요: git -C \"$SCRIPT_DIR\" status"
        exit 1
    fi

    local before after
    before="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)"
    git -C "$SCRIPT_DIR" fetch --tags --prune || { log_err "git fetch 실패"; exit 1; }
    if ! git -C "$SCRIPT_DIR" pull --ff-only; then
        log_err "fast-forward 불가 — 로컬 커밋이 원격과 갈라졌습니다. 수동으로 정리 후 재시도하세요."
        exit 1
    fi
    after="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)"

    if [[ "$before" == "$after" && "$FORCE" -ne 1 ]]; then
        log_ok "이미 최신입니다 ($after) — deploy 생략 (강제: --force)"
        return 0
    fi
    log_ok "업데이트: $before → $after"
    cmd_deploy "${PASS[@]}"
}

cmd_deploy() {
    parse_deploy_opts "$@"
    preflight

    log_step "Deploy: build → migrate → restart"

    # 0) 태그 동기화(fail-open) — build-info.json 의 gitTag 는 로컬 태그(`git describe`)라
    #    release-please 태그를 fetch 하지 않으면 한 단계 낮게 찍힌다(v1.41.0 배포에서 실측).
    git -C "$SCRIPT_DIR" fetch --tags --quiet 2>/dev/null || log_warn "git fetch --tags 실패 — build-info gitTag 가 stale 일 수 있음"

    # 1) 빌드 (재시작은 마이그레이션 뒤 3) 단계에서 일괄 수행)
    cmd_build --no-restart

    # 2) 마이그레이션 (확인 프롬프트, --no-migrate면 skip)
    if [[ "$DEPLOY_NO_MIGRATE" -eq 1 ]]; then
        log_info "마이그레이션 생략 (--no-migrate)"
    else
        confirm_or_exit "DB 마이그레이션을 진행합니다. 계속하시겠습니까?"
        cmd_migrate
    fi

    # 3) 재시작 (앱만)
    log_step "PM2 앱 재시작 (의존성은 그대로 유지)"
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        export_dotenv_for_pm2
        pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || {
            log_err "$APP_NAME restart 실패"
            return 2
        }
        # 프론트(next start)는 .next 빌드본을 기동 시점에 읽으므로 함께 재시작해야
        # 새 빌드가 반영된다 (누락 시 옛 프론트가 계속 서빙되는 함정).
        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$FRONT_APP_NAME\""; then
            pm2 restart "$FRONT_APP_NAME" --update-env >/dev/null 2>&1 \
                && log_ok "$FRONT_APP_NAME 재시작" \
                || log_warn "$FRONT_APP_NAME restart 실패 — 'pm2 restart $FRONT_APP_NAME' 수동 확인 필요"
        else
            log_info "$FRONT_APP_NAME PM2 미등록 — 프론트 재시작 생략"
        fi
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"
    else
        log_info "$APP_NAME PM2 미등록 — 신규 시작 (ecosystem: 백엔드+프론트 함께 기동)"
        ( cd "$SCRIPT_DIR" && pm2 start ecosystem.config.js ) || return 2
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"
    fi

    # 4) 리버스 프록시 설정 반영 (레포가 SoT — 위 sync_caddyfile 주석 참고)
    log_step "Caddy 설정 동기화"
    sync_caddyfile

    echo ""
    log_ok "Deploy 완료 — 변경사항이 운영에 반영되었습니다"
    show_status
}

# 레포의 Caddyfile 을 운영 경로로 복사하고, 내용이 바뀐 경우에만 caddy 를 무중단 reload 한다.
#
# 전부 fail-open — caddy 를 안 쓰는 배포(외부 프록시·단일 호스트)에서도 deploy 가 멈추면 안 된다.
# reload 는 admin API(localhost:2019)를 쓰므로 caddy 가 떠 있어야 한다. 안 떠 있으면 파일만
# 갱신되고 다음 기동 때 반영되므로 경고만 남긴다.
sync_caddyfile() {
    local src="$SCRIPT_DIR/$CADDYFILE_SRC_REL"

    # omk 가 관리하는 인스턴스는 자기 몫의 caddy.d/<env>.caddy 를 직접 렌더해 쓴다
    # (scripts/env/omk.sh proxy render). 여기서 레거시 호스트 Caddyfile 을 덮어쓰면 같은
    # Caddy 설정을 두 곳에서 다투게 되므로, OMK_PROXY_DIR 이 있으면 손대지 않는다.
    if [[ -n "$(env_line OMK_PROXY_DIR)" ]]; then
        log_info "omk proxy 관리 인스턴스 — 호스트 Caddyfile 동기화 생략 (scripts/env/omk.sh proxy render)"
        return 0
    fi

    # 호스트의 Caddyfile 은 하나뿐이다 — 이름 있는 인스턴스가 기본 인스턴스의 설정을 덮어쓰지 않게 한다.
    if [[ -n "$INSTANCE" ]]; then
        log_info "인스턴스 '$INSTANCE' — 호스트 Caddyfile 동기화 생략 (기본 인스턴스만 반영)"
        return 0
    fi

    [[ -f "$src" ]] || { log_info "Caddyfile 소스 없음 — 동기화 생략 ($CADDYFILE_SRC_REL)"; return 0; }
    [[ -d "$(dirname "$CADDYFILE_DEST")" ]] || { log_info "Caddy 설정 경로 없음 — 동기화 생략 ($CADDYFILE_DEST)"; return 0; }

    if cmp -s "$src" "$CADDYFILE_DEST"; then
        log_info "Caddyfile 변경 없음 — reload 생략"
        return 0
    fi

    local has_caddy=0
    command -v caddy >/dev/null 2>&1 && has_caddy=1

    # 운영 파일을 덮어쓰기 *전에* 검증한다. reload 는 잘못된 설정을 거부하므로 지금은 멀쩡해 보여도
    # (구 설정 유지) 디스크에 깨진 파일이 남아 다음 caddy 기동이 실패한다 — :33000 통째로 중단.
    if (( has_caddy )); then
        local verr
        if ! verr="$(caddy validate --config "$src" --adapter caddyfile 2>&1 | tail -n 1)"; then
            log_err "Caddyfile 검증 실패 — 운영 파일을 덮어쓰지 않습니다 (기존 설정 유지): $CADDYFILE_SRC_REL"
            log_err "  $verr"
            return 0
        fi
    fi

    if ! cp "$src" "$CADDYFILE_DEST" 2>/dev/null; then
        log_warn "Caddyfile 복사 실패 (권한 확인 필요): $CADDYFILE_DEST"
        return 0
    fi
    log_ok "Caddyfile 갱신 → $CADDYFILE_DEST"

    if (( ! has_caddy )); then
        log_info "caddy 미설치 — 검증·reload 생략 (파일은 갱신됨)"
        return 0
    fi
    if caddy reload --config "$CADDYFILE_DEST" >/dev/null 2>&1; then
        log_ok "Caddy reload 완료 (무중단)"
    else
        log_warn "Caddy reload 실패 — 설정은 검증을 통과했으므로 caddy 미기동(admin API 무응답)일 가능성이 큽니다. 다음 기동 시 반영됩니다"
    fi
}

# ── canary-deploy: 헬스 검증 후 전환 + 실패 시 자동 롤백 ──────────────────────
# 단일 호스트 PM2(fork, 고정 포트) 위에서 "카나리"를 흉내낸다:
#   1) 현재 빌드 산출물(dist)을 .releases/ 에 백업(직전 커밋 롤백용)
#   2) 새 코드 빌드 (+선택적 마이그레이션)
#   3) 새 dist 를 **운영 포트에 붙이기 전에** CANARY_HEALTH_PORT 로 임시 기동해
#      /health 를 확인한다 (pm2 는 아직 건드리지 않음 — 이 단계에서 실패하면
#      운영 트래픽은 계속 이전 프로세스가 받는다)
#   4) 통과 시에만 pm2 재시작(=실제 전환)
#   5) 전환 후 /health 가 실패하면 백업해둔 이전 dist 로 되돌리고 pm2 를 다시 재시작한다
#
# ⚠ 단일 호스트 한계 (docs 참고):
#   - PM2 fork 모드 + 고정 포트라 blue/green·무중단 트래픽 전환은 불가능하다.
#     3)번 헬스체크는 "새 코드가 이 DB/환경에서 정상 기동하는가"만 검증하고,
#     실제 트래픽 절체(4번)는 여전히 pm2 restart 의 짧은 다운타임을 수반한다.
#   - DB 마이그레이션은 순방향 전용이라 롤백은 "코드"만 되돌린다 — 마이그레이션이
#     이미 적용된 스키마에 이전 코드가 안 맞을 수 있는 조합은 이 스크립트가 막지 못한다
#     (--no-migrate 로 분리 배포하거나, 마이그레이션 자체를 되돌리려면 db/migrations/rollbacks/ 참고).
#   - 카나리 헬스체크 프로세스도 같은 DATABASE_URL/REDIS_URL 을 공유한다 — 부작용 없는
#     엔드포인트(/health)만 확인하고 즉시 종료한다.
canary_backup_dist() {
    mkdir -p "$CANARY_RELEASE_DIR"
    local has_backend=0 has_frontend=0
    [[ -d "$SCRIPT_DIR/apps/api/dist" ]] && has_backend=1
    [[ -d "$SCRIPT_DIR/apps/web/.next" ]] && has_frontend=1
    if [[ "$has_backend" -eq 0 && "$has_frontend" -eq 0 ]]; then
        log_warn "백업할 기존 빌드 산출물 없음 — 최초 배포로 간주, 롤백 스냅샷 생략"
        CANARY_BACKUP_FILE=""
        return 0
    fi
    local sha ts out
    sha="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    ts="$(date +%Y%m%d-%H%M%S)"
    out="$CANARY_RELEASE_DIR/pre-canary-${ts}-${sha}.tar.gz"
    log_info "롤백용 백업 생성: $out"
    local -a targets=()
    [[ "$has_backend" -eq 1 ]] && targets+=("apps/api/dist")
    [[ "$has_frontend" -eq 1 ]] && targets+=("apps/web/.next")
    ( cd "$SCRIPT_DIR" && tar -czf "$out" "${targets[@]}" ) || {
        log_err "빌드 산출물 백업 실패 — canary-deploy 중단"; return 2;
    }
    log_ok "백업 완료 ($(du -h "$out" | cut -f1))"
    CANARY_BACKUP_FILE="$out"

    # 보존 개수 초과분 정리 (오래된 것부터, mtime 기준). bash 3.2(macOS 시스템 bash)에도
    # 동작하도록 배열 적재 빌트인 대신 while-read 루프를 쓴다.
    local -a old=()
    local f
    while IFS= read -r f; do
        old+=("$f")
    done < <(find "$CANARY_RELEASE_DIR" -maxdepth 1 -name 'pre-canary-*.tar.gz' -type f -print0 \
        | xargs -0 ls -1t 2>/dev/null | tail -n "+$((CANARY_KEEP_RELEASES + 1))")
    if [[ "${#old[@]}" -gt 0 ]]; then
        rm -f "${old[@]}"
        log_info "${#old[@]}개 오래된 릴리스 백업 정리 (보존 ${CANARY_KEEP_RELEASES}개)"
    fi
}

canary_restore_dist() {
    if [[ -z "${CANARY_BACKUP_FILE:-}" || ! -f "$CANARY_BACKUP_FILE" ]]; then
        log_err "롤백할 백업 스냅샷이 없습니다 — 수동 확인 필요 (git checkout 후 재빌드)"
        return 2
    fi
    log_warn "이전 빌드로 롤백: $CANARY_BACKUP_FILE"
    rm -rf "$SCRIPT_DIR/apps/api/dist" "$SCRIPT_DIR/apps/web/.next"
    ( cd "$SCRIPT_DIR" && tar -xzf "$CANARY_BACKUP_FILE" ) || {
        log_err "백업 압축 해제 실패 — 수동 복구 필요: $CANARY_BACKUP_FILE"
        return 2
    }
    log_ok "이전 빌드 복원 완료"
}

# 새 dist 를 운영 포트가 아닌 임시 포트에서 짧게 기동해 /health 만 확인하고 종료한다.
canary_smoke_test() {
    if [[ "${CANARY_DRY_RUN:-0}" -eq 1 ]]; then
        log_info "[dry-run] 카나리 헬스체크 생략 (포트 $CANARY_HEALTH_PORT, /health)"
        return 0
    fi
    log_step "카나리 헬스체크 (임시 포트 $CANARY_HEALTH_PORT, 운영 트래픽 미영향)"
    if [[ ! -f "$SCRIPT_DIR/apps/api/dist/cli.js" ]]; then
        log_err "빌드 산출물 없음(apps/api/dist/cli.js) — 카나리 검증 불가"
        return 2
    fi

    local log_file
    log_file="$(mktemp -t openmake-canary-XXXXXX.log)"
    export_dotenv_for_pm2
    (
        cd "$SCRIPT_DIR" && PORT="$CANARY_HEALTH_PORT" NODE_ENV=production \
            node apps/api/dist/cli.js cluster --port "$CANARY_HEALTH_PORT" \
            >"$log_file" 2>&1 &
        echo $! > "${log_file}.pid"
    )
    local canary_pid
    canary_pid="$(cat "${log_file}.pid" 2>/dev/null || echo "")"

    local ok=0 i
    for ((i=1; i<=CANARY_HEALTH_RETRIES; i++)); do
        if curl -fsS --max-time 3 "http://127.0.0.1:$CANARY_HEALTH_PORT/health" >/dev/null 2>&1; then
            ok=1
            break
        fi
        sleep "$CANARY_HEALTH_INTERVAL"
    done

    if [[ -n "$canary_pid" ]]; then
        kill "$canary_pid" 2>/dev/null || true
        # cluster 서브커맨드가 자식 프로세스를 띄울 수 있어 프로세스 그룹째 정리한다.
        pkill -P "$canary_pid" 2>/dev/null || true
        wait "$canary_pid" 2>/dev/null || true
    fi

    if [[ "$ok" -eq 1 ]]; then
        log_ok "카나리 헬스체크 통과 (${i}회 시도) — 운영 전환 진행"
        rm -f "$log_file" "${log_file}.pid"
        return 0
    fi

    log_err "카나리 헬스체크 실패 (${CANARY_HEALTH_RETRIES}회 시도) — 운영 전환 중단, 로그:"
    tail -n 50 "$log_file" 2>/dev/null || true
    rm -f "${log_file}.pid"
    return 3
}

# 사용법: canary-deploy [--yes] [--no-migrate] [--dry-run]
#   --dry-run: 백업/빌드/마이그레이션/카나리 헬스체크/전환 중 실제 부작용이 있는 단계를
#              건너뛰고 수행될 순서만 출력한다 (운영 영향 없음 확인용).
cmd_canary_deploy() {
    CANARY_DRY_RUN=0
    local -a pass=()
    for arg in "$@"; do
        case "$arg" in
            --dry-run) CANARY_DRY_RUN=1 ;;
            *) pass+=("$arg") ;;
        esac
    done
    parse_deploy_opts "${pass[@]+"${pass[@]}"}"
    preflight

    log_step "Canary Deploy: 백업 → 빌드 → 마이그레이션 → 카나리 헬스체크 → 전환 → (실패 시 롤백)"
    log_warn "단일 호스트 한계: 헬스체크는 새 코드의 기동 가능성만 검증하며, 전환(pm2 restart) 자체는 짧은 다운타임을 수반합니다."

    if [[ "$CANARY_DRY_RUN" -eq 1 ]]; then
        log_info "[dry-run] 순서만 출력하고 아무 것도 실행하지 않습니다."
        cat <<EOF
  1) 백업: $CANARY_RELEASE_DIR/pre-canary-<timestamp>-<sha>.tar.gz (기존 apps/api/dist, apps/web/.next)
  2) 빌드: npm run build (--no-restart)
  3) 마이그레이션: $([[ "$DEPLOY_NO_MIGRATE" -eq 1 ]] && echo "생략(--no-migrate)" || echo "cli.ts migrate")
  4) 카나리 헬스체크: http://127.0.0.1:$CANARY_HEALTH_PORT/health (최대 $((CANARY_HEALTH_RETRIES * CANARY_HEALTH_INTERVAL))s)
  5) 통과 시 전환: pm2 restart $APP_NAME $FRONT_APP_NAME --update-env
  6) 전환 후 헬스체크(포트 $APP_PORT) 실패 시: 1)의 백업으로 롤백 후 재기동
EOF
        return 0
    fi

    git -C "$SCRIPT_DIR" fetch --tags --quiet 2>/dev/null || log_warn "git fetch --tags 실패 — build-info gitTag 가 stale 일 수 있음"

    canary_backup_dist || return 2

    cmd_build --no-restart || {
        log_err "빌드 실패 — canary-deploy 중단 (운영은 이전 버전 그대로 서비스 중)"
        return 2
    }

    if [[ "$DEPLOY_NO_MIGRATE" -eq 1 ]]; then
        log_info "마이그레이션 생략 (--no-migrate)"
    else
        confirm_or_exit "DB 마이그레이션을 진행합니다. 계속하시겠습니까?"
        cmd_migrate || { log_err "마이그레이션 실패 — canary-deploy 중단"; return 2; }
    fi

    canary_smoke_test || {
        log_err "카나리 검증 실패 — 운영 전환을 하지 않습니다(pm2 는 그대로 이전 버전 서비스 중)."
        log_info "새 빌드 산출물은 apps/api/dist·apps/web/.next 에 남아 있습니다 — 원인 조사 후 재시도하세요."
        return 3
    }

    log_step "전환: PM2 앱 재시작"
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        export_dotenv_for_pm2
        pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || {
            log_err "$APP_NAME restart 실패 — 롤백 시도"
            canary_restore_dist && restart_built_apps
            return 2
        }
        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$FRONT_APP_NAME\""; then
            pm2 restart "$FRONT_APP_NAME" --update-env >/dev/null 2>&1 \
                && log_ok "$FRONT_APP_NAME 재시작" \
                || log_warn "$FRONT_APP_NAME restart 실패 — 'pm2 restart $FRONT_APP_NAME' 수동 확인 필요"
        fi
    else
        log_info "$APP_NAME PM2 미등록 — 신규 시작 (ecosystem: 백엔드+프론트 함께 기동)"
        ( cd "$SCRIPT_DIR" && pm2 start ecosystem.config.js ) || return 2
    fi

    if ! wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"; then
        log_err "전환 후 헬스체크 실패 — 자동 롤백 시작"
        canary_restore_dist || { log_err "롤백 실패 — 즉시 수동 개입 필요"; return 2; }
        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
            export_dotenv_for_pm2
            pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || log_err "롤백 후 재시작 실패 — 수동 개입 필요"
            pm2 jlist 2>/dev/null | grep -q "\"name\":\"$FRONT_APP_NAME\"" \
                && { pm2 restart "$FRONT_APP_NAME" --update-env >/dev/null 2>&1 || true; }
        fi
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM" \
            && log_warn "롤백 완료 — 직전 커밋 빌드로 복구됨, 원인 조사 필요" \
            || log_err "롤백 후에도 헬스체크 실패 — 즉시 수동 개입 필요"
        return 3
    fi

    log_step "Caddy 설정 동기화"
    sync_caddyfile

    echo ""
    log_ok "Canary Deploy 완료 — 카나리 검증을 통과한 빌드가 운영에 반영되었습니다"
    show_status
}

# ── db-dump / db-restore: 인스턴스 DB 이관 ────────────────────────────────────
# 운영 중인 다른 호스트의 DB 를 이 설치본으로 옮기는 표준 경로:
#   원본:  ./openmake_llm.sh db-dump chat.dump          (pg_dump -Fc, 컨테이너 안에서 실행)
#   대상:  ./openmake_llm.sh db-restore chat.dump       (앱 정지 → pg_restore → migrate → 재시작)
#
# ⚠ 복원 전에 원본 .env 의 시크릿을 대상 .env 로 옮겨야 한다 — DB 안의 값이 그 키로 묶여 있다:
#   TOKEN_ENCRYPTION_KEY (외부 provider 자격증명 복호화), API_KEY_PEPPER (발급된 API 키 검증),
#   JWT_SECRET (기존 세션 유지, 선택). ADMIN_* 는 DB 의 관리자 계정이 그대로 오므로 원본 값으로.
#   업로드/생성 파일(apps/api 의 uploads·generated 디렉터리)은 DB 밖이라 rsync 로 따로 옮긴다.
db_container_ready() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER" \
        || { log_err "PostgreSQL 컨테이너($PG_CONTAINER)가 떠 있지 않습니다 — './openmake_llm.sh start' 또는 docker 확인"; return 2; }
}

cmd_db_dump() {
    preflight
    db_container_ready || return 2
    local user db out
    user="$(env_line POSTGRES_USER)"; user="${user:-openmake}"
    db="$(env_line POSTGRES_DB)";     db="${db:-openmake_llm}"
    out="${1:-$SCRIPT_DIR/${db}${INSTANCE:+-$INSTANCE}-$(date +%Y%m%d-%H%M%S).dump}"
    log_step "DB 덤프: $PG_CONTAINER/$db → $out (pg_dump -Fc)"
    if ! docker exec "$PG_CONTAINER" pg_dump -U "$user" -Fc "$db" > "$out"; then
        rm -f "$out"; log_err "pg_dump 실패"; return 2
    fi
    log_ok "덤프 완료: $out ($(du -h "$out" | cut -f1))"
    echo "  복원: 대상 설치본에서  ./openmake_llm.sh db-restore $(basename "$out")"
    echo "  (복원 전 원본 .env 의 TOKEN_ENCRYPTION_KEY / API_KEY_PEPPER / JWT_SECRET 을 대상 .env 로 옮길 것)"
}

cmd_db_restore() {
    local file="${1:-}" yes=0
    [[ "${2:-}" == "--yes" || "${1:-}" == "--yes" ]] && yes=1
    [[ "$file" == "--yes" ]] && file="${2:-}"
    [[ -n "$file" && -f "$file" ]] || { log_err "사용법: $0 db-restore <덤프파일> [--yes]"; return 1; }
    preflight
    db_container_ready || return 2
    local user db
    user="$(env_line POSTGRES_USER)"; user="${user:-openmake}"
    db="$(env_line POSTGRES_DB)";     db="${db:-openmake_llm}"

    log_step "DB 복원: $file → $PG_CONTAINER/$db"
    log_warn "현재 '$db' 의 모든 데이터가 덤프 내용으로 대체됩니다 (인스턴스: ${INSTANCE:-기본})."
    DEPLOY_YES=$yes
    confirm_or_exit "계속하시겠습니까?"

    # 앱이 붙어 있으면 DROP 이 막힌다 — 복원 동안 API 만 내린다 (프론트는 무관).
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        pm2 stop "$APP_NAME" >/dev/null 2>&1 && log_info "$APP_NAME 정지 (복원 동안)"
    fi

    # 남은 세션을 끊고 통째로 다시 만든다 — --clean 보다 잔재(마이그레이션 표·enum 등)가 안 남는다.
    docker exec "$PG_CONTAINER" psql -U "$user" -d postgres -v ON_ERROR_STOP=1 -q \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid<>pg_backend_pid();" \
        -c "DROP DATABASE IF EXISTS \"$db\";" -c "CREATE DATABASE \"$db\" OWNER \"$user\";" >/dev/null \
        || { log_err "DB 재생성 실패"; return 2; }

    # -Fc(custom) 덤프는 pg_restore, 평문 .sql 은 psql. 확장(extension) 소유권 경고는 무시 가능.
    local rc=0
    if head -c 5 "$file" | grep -q '^PGDMP'; then
        docker exec -i "$PG_CONTAINER" pg_restore -U "$user" -d "$db" --no-owner --no-acl --exit-on-error < "$file" || rc=$?
    else
        docker exec -i "$PG_CONTAINER" psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -q < "$file" || rc=$?
    fi
    if [[ $rc -ne 0 ]]; then
        log_err "복원 실패 (exit $rc) — DB 는 비어 있을 수 있습니다. 덤프 파일과 PostgreSQL 버전을 확인하세요."
        return 2
    fi
    log_ok "복원 완료"

    # 원본이 구버전이면 스키마를 이 코드에 맞춘다.
    cmd_migrate || return 2

    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        export_dotenv_for_pm2
        pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 && log_ok "$APP_NAME 재시작" \
            || log_warn "$APP_NAME 재시작 실패 — 'pm2 restart $APP_NAME' 수동 확인"
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM" || true
    fi
    log_ok "DB 이관 완료 — 원본 .env 의 TOKEN_ENCRYPTION_KEY / API_KEY_PEPPER 가 대상 .env 와 같은지 확인하세요."
}

cmd_install() {
    local installer="$SCRIPT_DIR/install.sh"
    [[ -x "$installer" ]] || { log_err "install.sh 를 찾을 수 없음: $installer"; return 2; }
    log_step "원샷 설치 (install.sh 위임)"
    exec "$installer" "$@"
}

usage() {
    cat <<EOF
OpenMake LLM 통합 서비스 매니저

사용법:
  $0 <command> [options]

최초 설치:
  install   toolchain 점검 → .env → 의존성 → DB → 빌드 → 기동 (install.sh 위임)
            옵션은 './install.sh --help' 참고

서비스 관리:
  start     PostgreSQL → Redis → OpenMake LLM 순차 기동
            (LLM 추론은 외부 vLLM/LiteLLM 서버 사용 — 로컬 Ollama 기동 안 함)
            기동 완료 후 실시간 로그 스트리밍 지속 (Ctrl+C로 종료)
  stop      역순 정지
  restart   PM2 앱만 재시작 (코드 반영 X — 환경변수 변경 등)
            재시작 후 실시간 로그 스트리밍 지속 (Ctrl+C로 종료)

코드 변경 반영:
  build     npm run build (backend tsc + frontend Next.js build 산출물 생성)
            빌드 후 PM2 앱(백엔드+프론트) 자동 재시작 — --no-restart 로 생략
  migrate   DB 마이그레이션 (status → migrate)
  deploy    build + migrate + restart + Caddy 설정 동기화 (코드 변경 운영 반영)
            백엔드(openmake-llm)와 프론트(openmake-next) 모두 재시작
            옵션: --yes (확인 프롬프트 skip), --no-migrate (마이그 생략)
  update    git pull(ff-only) → deploy — 설치본 표준 업데이트 경로
            미커밋 변경·비ff 이력이면 중단(덮어쓰지 않음). 옵션: deploy 와 동일 + --force
  canary-deploy   백업 → 빌드 → 마이그레이션 → 카나리 헬스체크(임시 포트) → 통과 시 전환
            → 전환 후 헬스체크 실패 시 직전 빌드로 자동 롤백. deploy 와 달리 새 코드가
            임시 포트(기본 $CANARY_HEALTH_PORT)에서 기동 가능함을 먼저 확인한 뒤에만
            pm2 를 재시작한다 — 단일 호스트 fork 모드라 전환 자체는 짧은 다운타임 수반.
            옵션: --yes, --no-migrate, --dry-run(실제 실행 없이 수행 순서만 출력)

관측:
  status    모든 계층 상태 확인 (포트 + docker + PM2)
  health    /health 엔드포인트 호출 확인
  logs      OpenMake LLM 실시간 로그 (PM2)

DB 이관 (다른 호스트/인스턴스로 옮길 때):
  db-dump [파일]        이 인스턴스 DB 전체 덤프 (pg_dump -Fc, 기본 파일명 자동)
  db-restore <파일>     덤프를 이 인스턴스 DB 에 복원 (앱 정지 → DROP/CREATE → 복원 → migrate → 재시작)
                        옵션: --yes. 복원 전 원본 .env 의 TOKEN_ENCRYPTION_KEY / API_KEY_PEPPER /
                        JWT_SECRET 을 이쪽 .env 로 옮길 것 (DB 안의 암호화 값·API 키가 그 키에 묶임)

인스턴스 (현재: ${INSTANCE:-기본}):
  .env 의 OMK_INSTANCE 에 따라 PM2 앱 $APP_NAME / $FRONT_APP_NAME, 컨테이너 $PG_CONTAINER 를 다룬다.

환경 가정:
  - Linux / macOS (DB/Redis 는 docker compose, 앱은 PM2 로 관리)
  - PM2 설치 (npm i -g pm2 — install.sh 가 자동 처리)
  - Node 24+ (mise/nvm/fnm 또는 install.sh 가 만든 .openmake/toolchain.env)

오버라이드 환경변수:
  PORT (기본 52416), POSTGRES_PORT (5432), REDIS_PORT (6379)
  OMK_DEPLOY_SKIP_CONFIRM=1 (deploy 마이그레이션 확인 자동 통과)

예시:
  $0 start                          # 처음 기동
  $0 deploy                         # 코드 변경 후 운영 반영 (확인 프롬프트)
  $0 deploy --yes                   # 확인 없이 즉시 진행
  $0 deploy --no-migrate            # 마이그레이션 생략하고 build+restart만
  $0 deploy --yes --no-migrate      # 둘 다 적용
EOF
}

main() {
    local cmd="${1:-}"
    shift || true
    case "$cmd" in
        install)  cmd_install "$@" ;;
        start)    cmd_start ;;
        stop)     cmd_stop ;;
        restart)  cmd_restart ;;
        build)    cmd_build "$@" ;;
        migrate)  cmd_migrate ;;
        deploy)   cmd_deploy "$@" ;;
        canary-deploy) cmd_canary_deploy "$@" ;;
        update)   cmd_update "$@" ;;
        status)   show_status ;;
        health)   show_health ;;
        logs)     show_logs ;;
        db-dump)  cmd_db_dump "$@" ;;
        db-restore) cmd_db_restore "$@" ;;
        ""|-h|--help|help) usage ;;
        *)
            log_err "알 수 없는 명령: $cmd"
            echo ""
            usage
            exit 1
            ;;
    esac
}

main "$@"
