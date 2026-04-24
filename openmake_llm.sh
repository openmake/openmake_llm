#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM 통합 서비스 매니저
# ==============================================================================
# 4계층 의존성을 순차 기동/정지/상태확인:
#   Layer 1: PostgreSQL@16   (DATABASE_URL=127.0.0.1:5432)
#   Layer 2: Redis           (REDIS_URL=localhost:6379)
#   Layer 3: Ollama          (localhost:11434)
#   Layer 4: OpenMake LLM    (PM2 — ecosystem.config.js, PORT=52416)
#
# 사용법:
#   ./openmake_llm.sh start      # 의존성 → 앱 순서로 기동
#   ./openmake_llm.sh stop       # 앱 → 의존성 역순으로 정지
#   ./openmake_llm.sh restart    # stop 후 start
#   ./openmake_llm.sh status     # 모든 계층 상태 확인
#   ./openmake_llm.sh logs       # OpenMake LLM 실시간 로그
#   ./openmake_llm.sh health     # /health 엔드포인트 응답 확인
#
# 환경 가정 (macOS + Homebrew):
#   - PostgreSQL/Redis/Ollama는 brew services로 관리
#   - OpenMake LLM 앱은 PM2로 관리
#   - mise / nvm 등으로 Node 22+ 활성화 상태
#
# 종료 코드:
#   0  성공
#   1  의존성 누락 (brew/pm2/curl 미설치)
#   2  서비스 기동/정지 실패
#   3  health check 실패
# ==============================================================================
set -euo pipefail

readonly SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
readonly APP_NAME="openmake-llm"
readonly APP_PORT="${PORT:-52416}"
readonly POSTGRES_FORMULA="postgresql@16"
readonly REDIS_FORMULA="redis"
readonly OLLAMA_FORMULA="ollama"
readonly POSTGRES_PORT="${POSTGRES_PORT:-5432}"
readonly REDIS_PORT="${REDIS_PORT:-6379}"
readonly OLLAMA_PORT="${OLLAMA_PORT:-11434}"
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
    for cmd in brew pm2 curl node; do
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

# ── brew 서비스 헬퍼 ──────────────────────────────────────────────────────────
brew_service_status() {
    # "started" | "stopped" | "error" | "none" 반환
    local name="$1"
    brew services list 2>/dev/null | awk -v n="$name" '$1==n {print $2; exit}'
}

ensure_brew_started() {
    local name="$1"
    local label="$2"
    local status
    status="$(brew_service_status "$name")"
    case "$status" in
        started)
            log_ok "$label 이미 실행 중 ($name)"
            ;;
        ""|none|stopped|error)
            log_info "$label 시작 중 (brew services start $name)"
            if ! brew services start "$name" >/dev/null 2>&1; then
                log_err "$label 시작 실패. brew services list 확인 필요"
                return 2
            fi
            ;;
        *)
            log_warn "$label 알 수 없는 상태: $status — start 시도"
            brew services start "$name" >/dev/null 2>&1 || true
            ;;
    esac
}

ensure_brew_stopped() {
    local name="$1"
    local label="$2"
    local status
    status="$(brew_service_status "$name")"
    if [[ "$status" == "started" ]]; then
        log_info "$label 정지 중 (brew services stop $name)"
        brew services stop "$name" >/dev/null 2>&1 || log_warn "$label 정지 명령 실패 (이미 정지일 수 있음)"
    else
        log_ok "$label 이미 정지 ($name, status=$status)"
    fi
}

# ── 4계층 액션 ────────────────────────────────────────────────────────────────
start_postgres() {
    log_step "Layer 1/4: PostgreSQL"
    ensure_brew_started "$POSTGRES_FORMULA" "PostgreSQL"
    wait_for_port "$POSTGRES_PORT" "PostgreSQL"
}

start_redis() {
    log_step "Layer 2/4: Redis"
    ensure_brew_started "$REDIS_FORMULA" "Redis"
    wait_for_port "$REDIS_PORT" "Redis"
}

start_ollama() {
    log_step "Layer 3/4: Ollama"
    ensure_brew_started "$OLLAMA_FORMULA" "Ollama"
    wait_for_port "$OLLAMA_PORT" "Ollama"
}

start_app() {
    log_step "Layer 4/4: OpenMake LLM (PM2)"

    # build 산출물 확인 — 미빌드 시 안내
    if [[ ! -f "$SCRIPT_DIR/backend/api/dist/cli.js" ]]; then
        log_warn "빌드 산출물 없음 — 'npm run build' 먼저 실행 필요"
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

    wait_for_port "$APP_PORT" "OpenMake LLM"
}

stop_app() {
    log_step "정지 1/4: OpenMake LLM (PM2)"
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\""; then
        pm2 stop "$APP_NAME" >/dev/null 2>&1 || log_warn "$APP_NAME stop 명령 실패"
        log_ok "$APP_NAME 정지"
    else
        log_ok "$APP_NAME PM2에 등록되지 않음 (이미 정지)"
    fi
}

stop_ollama() {
    log_step "정지 2/4: Ollama"
    ensure_brew_stopped "$OLLAMA_FORMULA" "Ollama"
}

stop_redis() {
    log_step "정지 3/4: Redis"
    ensure_brew_stopped "$REDIS_FORMULA" "Redis"
}

stop_postgres() {
    log_step "정지 4/4: PostgreSQL"
    ensure_brew_stopped "$POSTGRES_FORMULA" "PostgreSQL"
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

    # PostgreSQL
    if port_listening "$POSTGRES_PORT"; then
        print_status_row "PostgreSQL ($POSTGRES_PORT)" "ok" "$(brew_service_status "$POSTGRES_FORMULA")"
    else
        print_status_row "PostgreSQL ($POSTGRES_PORT)" "fail" "포트 미응답"
    fi

    # Redis
    if port_listening "$REDIS_PORT"; then
        print_status_row "Redis ($REDIS_PORT)" "ok" "$(brew_service_status "$REDIS_FORMULA")"
    else
        print_status_row "Redis ($REDIS_PORT)" "fail" "포트 미응답"
    fi

    # Ollama
    if port_listening "$OLLAMA_PORT"; then
        print_status_row "Ollama ($OLLAMA_PORT)" "ok" "$(brew_service_status "$OLLAMA_FORMULA")"
    else
        print_status_row "Ollama ($OLLAMA_PORT)" "fail" "포트 미응답"
    fi

    # OpenMake LLM (PM2)
    local pm2_status="not-installed"
    if command -v pm2 >/dev/null 2>&1; then
        pm2_status="$(pm2 jlist 2>/dev/null | node -e "
            let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
                try { const arr=JSON.parse(raw||'[]');
                    const app=arr.find(a=>a.name==='$APP_NAME');
                    if(!app){console.log('not-registered');return;}
                    console.log(app.pm2_env.status);
                } catch { console.log('parse-error'); }
            });
        " 2>/dev/null || echo "query-fail")"
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
    pm2 logs "$APP_NAME" --lines 50
}

# ── 메인 디스패처 ────────────────────────────────────────────────────────────
cmd_start() {
    preflight
    start_postgres
    start_redis
    start_ollama
    start_app
    echo ""
    log_ok "전체 4계층 기동 완료"
    show_status
}

cmd_stop() {
    preflight
    stop_app
    stop_ollama
    stop_redis
    stop_postgres
    echo ""
    log_ok "전체 정지 완료"
}

cmd_restart() {
    cmd_stop
    sleep 2
    cmd_start
}

usage() {
    cat <<EOF
OpenMake LLM 통합 서비스 매니저

사용법:
  $0 <command>

명령:
  start     PostgreSQL → Redis → Ollama → OpenMake LLM 순차 기동
  stop      역순 정지
  restart   stop 후 start
  status    모든 계층 상태 확인 (포트 + brew + PM2)
  health    /health 엔드포인트 호출 확인
  logs      OpenMake LLM 실시간 로그 (PM2)

환경 가정:
  - macOS + Homebrew (brew services로 dep 관리)
  - PM2 전역 설치 (npm i -g pm2)
  - Node 22+ (mise/nvm으로 활성)

오버라이드 가능 환경변수:
  PORT (기본 52416), POSTGRES_PORT (5432), REDIS_PORT (6379), OLLAMA_PORT (11434)
EOF
}

main() {
    local cmd="${1:-}"
    case "$cmd" in
        start)    cmd_start ;;
        stop)     cmd_stop ;;
        restart)  cmd_restart ;;
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
