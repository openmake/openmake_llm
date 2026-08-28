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

readonly APP_NAME="openmake-llm"
readonly FRONT_APP_NAME="openmake-next"

# Caddy 리버스 프록시 설정 — 이 레포가 SoT.
#
# ⚠️ 운영 경로(/opt/homebrew/etc/Caddyfile)는 원래 이 파일로의 심링크였으나, launchd
# 서비스가 외장 볼륨(/Volumes/...)을 읽지 못해(TCC: "operation not permitted") 실파일로
# 교체했다. 그래서 레포 변경이 더는 자동 반영되지 않는다 — 배포마다 여기서 복사한다.
readonly CADDYFILE_SRC_REL="scripts/caddy/Caddyfile"
CADDYFILE_DEST="${CADDYFILE_DEST:-/opt/homebrew/etc/Caddyfile}"

# .env 에서 키 하나만 추출한다 (전체 source 안 함 — 값에 공백/특수문자가 있어도 안전).
# `|| true` 필수: 키가 없으면 grep 이 1 로 끝나고 pipefail+set -e 가 스크립트를 즉시 종료시킨다.
env_line() {
    [[ -f "$SCRIPT_DIR/.env" ]] || return 0
    grep -E "^$1=" "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ' || true
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

    [[ -f "$src" ]] || { log_info "Caddyfile 소스 없음 — 동기화 생략 ($CADDYFILE_SRC_REL)"; return 0; }
    [[ -d "$(dirname "$CADDYFILE_DEST")" ]] || { log_info "Caddy 설정 경로 없음 — 동기화 생략 ($CADDYFILE_DEST)"; return 0; }

    if cmp -s "$src" "$CADDYFILE_DEST"; then
        log_info "Caddyfile 변경 없음 — reload 생략"
        return 0
    fi

    if ! cp "$src" "$CADDYFILE_DEST" 2>/dev/null; then
        log_warn "Caddyfile 복사 실패 (권한 확인 필요): $CADDYFILE_DEST"
        return 0
    fi
    log_ok "Caddyfile 갱신 → $CADDYFILE_DEST"

    if ! command -v caddy >/dev/null 2>&1; then
        log_info "caddy 미설치 — reload 생략 (파일은 갱신됨)"
        return 0
    fi
    if caddy reload --config "$CADDYFILE_DEST" >/dev/null 2>&1; then
        log_ok "Caddy reload 완료 (무중단)"
    else
        log_warn "Caddy reload 실패 — 미기동 상태일 수 있습니다. 다음 기동 시 반영됩니다"
    fi
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

관측:
  status    모든 계층 상태 확인 (포트 + docker + PM2)
  health    /health 엔드포인트 호출 확인
  logs      OpenMake LLM 실시간 로그 (PM2)

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
        update)   cmd_update "$@" ;;
        status)   show_status ;;
        health)   show_health ;;
        logs)     show_logs ;;
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
