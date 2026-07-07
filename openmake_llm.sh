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
#   ./openmake_llm.sh start      # 의존성 → 앱 순서로 기동 (빌드/마이그레이션 X)
#   ./openmake_llm.sh stop       # 앱 → 의존성 역순으로 정지
#   ./openmake_llm.sh restart    # PM2 앱만 재시작 (코드 반영 X — 환경변수 변경 등)
#   ./openmake_llm.sh build      # npm run build (backend tsc + frontend Next.js build 산출물 생성)
#   ./openmake_llm.sh migrate    # DB 마이그레이션 적용 (status로 사전 확인 권장)
#   ./openmake_llm.sh deploy     # build + migrate + restart (코드 변경 운영 반영)
#                                # 옵션: --yes (확인 skip), --no-migrate (마이그 생략)
#   ./openmake_llm.sh status     # 모든 계층 상태 확인
#   ./openmake_llm.sh logs       # OpenMake LLM 실시간 로그
#   ./openmake_llm.sh health     # /health 엔드포인트 응답 확인
#
# 환경 가정 (macOS):
#   - PostgreSQL/Redis는 docker compose 로 관리 (2026-06-21 brew postgresql@16 제거 → docker 단독)
#     · compose 위치: ./infra/docker-compose.yml (COMPOSE_FILE env 로 override 가능)
#   - OpenMake LLM 앱은 PM2로 관리
#   - mise / nvm 등으로 Node 24+ 활성화 상태
#
# 종료 코드:
#   0  성공
#   1  의존성 누락 (docker/pm2/curl 미설치)
#   2  서비스 기동/정지 실패
#   3  health check 실패
# ==============================================================================
set -euo pipefail

readonly SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
readonly APP_NAME="openmake-llm"
readonly APP_PORT="${PORT:-52416}"
readonly POSTGRES_PORT="${POSTGRES_PORT:-5432}"
readonly REDIS_PORT="${REDIS_PORT:-6379}"
# DB/Redis 는 docker compose 로 운영 (2026-06-21 brew postgresql@16 제거 → docker 단독).
# COMPOSE_FILE 로 compose 위치 지정. 우선순위: 셸 환경변수 > .env > 기본값(레포의 infra/docker-compose.yml).
# (.env 는 COMPOSE_FILE 한 줄만 추출, 전체 source 안 함)
_compose_file_env=""
[[ -f "$SCRIPT_DIR/.env" ]] && _compose_file_env="$(grep -E '^COMPOSE_FILE=' "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ')"
readonly COMPOSE_FILE="${COMPOSE_FILE:-${_compose_file_env:-$SCRIPT_DIR/infra/docker-compose.yml}}"
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
    for cmd in docker pm2 curl node npm lsof; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_err "필수 명령 미설치: $cmd"
            missing=1
        fi
    done
    [[ $missing -eq 0 ]] || exit 1
}

# ── 포트 점검 헬퍼 ────────────────────────────────────────────────────────────
port_listening() {
    local port="$1"
    # nc는 macOS 기본 미설치 가능 — lsof로 대체
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
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
    if [[ "$action" == "up" ]]; then
        log_info "$label 시작 중 (docker compose up -d $svc)"
        if ! docker compose -f "$COMPOSE_FILE" up -d "$svc" >/dev/null 2>&1; then
            log_err "$label docker 기동 실패 — docker compose -f $COMPOSE_FILE logs $svc 확인"
            return 2
        fi
    else
        log_info "$label 정지 중 (docker compose stop $svc)"
        docker compose -f "$COMPOSE_FILE" stop "$svc" >/dev/null 2>&1 || log_warn "$label docker 정지 실패(이미 정지일 수 있음)"
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

# ── 메인 디스패처 ────────────────────────────────────────────────────────────
cmd_start() {
    preflight
    start_postgres
    start_redis
    start_app
    echo ""
    log_ok "전체 3계층 기동 완료"
    show_status
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
}

# ── build / migrate / deploy ───────────────────────────────────────────────────
cmd_build() {
    log_step "npm run build (backend tsc + apps/web Next.js 빌드)"
    if ! ( cd "$SCRIPT_DIR" && npm run build ); then
        log_err "빌드 실패 — 후속 작업 중단"
        return 2
    fi
    log_ok "빌드 완료"
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

cmd_deploy() {
    parse_deploy_opts "$@"
    preflight

    log_step "Deploy: build → migrate → restart"

    # 1) 빌드
    cmd_build

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
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"
    else
        log_info "$APP_NAME PM2 미등록 — 신규 시작"
        ( cd "$SCRIPT_DIR" && pm2 start ecosystem.config.js ) || return 2
        wait_for_app_with_logs "$APP_PORT" "OpenMake LLM"
    fi

    echo ""
    log_ok "Deploy 완료 — 변경사항이 운영에 반영되었습니다"
    show_status
}

usage() {
    cat <<EOF
OpenMake LLM 통합 서비스 매니저

사용법:
  $0 <command> [options]

서비스 관리:
  start     PostgreSQL → Redis → OpenMake LLM 순차 기동
            (LLM 추론은 외부 vLLM/LiteLLM 서버 사용 — 로컬 Ollama 기동 안 함)
  stop      역순 정지
  restart   PM2 앱만 재시작 (코드 반영 X — 환경변수 변경 등)

코드 변경 반영:
  build     npm run build (backend tsc + frontend Next.js build 산출물 생성)
  migrate   DB 마이그레이션 (status → migrate)
  deploy    build + migrate + restart 통합 (코드 변경 운영 반영)
            옵션: --yes (확인 프롬프트 skip), --no-migrate (마이그 생략)

관측:
  status    모든 계층 상태 확인 (포트 + docker + PM2)
  health    /health 엔드포인트 호출 확인
  logs      OpenMake LLM 실시간 로그 (PM2)

환경 가정:
  - macOS (DB/Redis 는 docker compose, 앱은 PM2 로 관리)
  - PM2 전역 설치 (npm i -g pm2)
  - Node 24+ (mise/nvm으로 활성)

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
        start)    cmd_start ;;
        stop)     cmd_stop ;;
        restart)  cmd_restart ;;
        build)    cmd_build ;;
        migrate)  cmd_migrate ;;
        deploy)   cmd_deploy "$@" ;;
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
