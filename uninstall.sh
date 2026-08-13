#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 제거 스크립트
# ==============================================================================
# install.sh 가 만든 것들을 역순으로 지운다:
#
#   PM2 앱 정지·삭제 → Docker 컨테이너·볼륨 제거 → 소스 디렉터리 삭제
#
# 사용:
#   ./uninstall.sh                 # 대화형 — 단계마다 확인
#   ./uninstall.sh --yes           # 전부 자동 승인
#   ./uninstall.sh --keep-data     # Docker 볼륨(DB 데이터)은 남김
#   ./uninstall.sh --keep-source   # 소스 디렉터리는 남김 (.env 포함)
#
# 지우지 않는 것: install.sh 가 설치했을 수 있는 전역 도구(Node, Docker, PM2
# 자체, colima). 다른 프로젝트가 쓸 수 있으므로 건드리지 않는다.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_RESET=$'\033[0m'
[[ -t 1 ]] || { C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_RESET=""; }
log_info() { printf "%s[INFO]%s  %s\n" "$C_INFO" "$C_RESET" "$*"; }
log_ok()   { printf "%s[OK]%s    %s\n" "$C_OK"   "$C_RESET" "$*"; }
log_warn() { printf "%s[WARN]%s  %s\n" "$C_WARN" "$C_RESET" "$*"; }
log_step() { printf "\n%s━━ %s ━━%s\n" "$C_INFO" "$*" "$C_RESET"; }
has() { command -v "$1" >/dev/null 2>&1; }

ASSUME_YES=0; KEEP_DATA=0; KEEP_SOURCE=0
for arg in "$@"; do
    case "$arg" in
        --yes|-y)      ASSUME_YES=1 ;;
        --keep-data)   KEEP_DATA=1 ;;
        --keep-source) KEEP_SOURCE=1 ;;
        --help|-h) sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) log_warn "알 수 없는 옵션: $arg (--help 참고)"; exit 2 ;;
    esac
done

confirm() {
    [[ $ASSUME_YES -eq 1 ]] && { log_info "$1 → 자동 승인"; return 0; }
    [[ -t 0 ]] || { log_info "$1 → 자동 승인 (비대화형)"; return 0; }
    local reply=""
    read -r -p "$(printf '%s%s%s [y/N]: ' "$C_WARN" "$1" "$C_RESET")" reply || true
    case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ── 1. PM2 앱 ────────────────────────────────────────────────────────────────
log_step "1/3 PM2 앱 정지·삭제"
if has pm2; then
    for app in openmake-llm openmake-next; do
        if pm2 describe "$app" >/dev/null 2>&1; then
            pm2 delete "$app" >/dev/null 2>&1 && log_ok "$app 삭제" || log_warn "$app 삭제 실패"
        else
            log_info "$app — 등록되어 있지 않음"
        fi
    done
    pm2 save --force >/dev/null 2>&1 || true
else
    log_info "pm2 없음 — 건너뜀"
fi

# ── 2. Docker 컨테이너·볼륨 ──────────────────────────────────────────────────
log_step "2/3 Docker 컨테이너·볼륨"
if has docker && docker info >/dev/null 2>&1; then
    for c in openmake-postgres openmake-redis; do
        if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
            docker rm -f "$c" >/dev/null && log_ok "$c 컨테이너 제거"
        else
            log_info "$c — 없음"
        fi
    done
    if [[ $KEEP_DATA -eq 1 ]]; then
        log_info "--keep-data — 볼륨(openmake_pgdata, openmake_redisdata)은 남깁니다."
    elif confirm "DB 데이터 볼륨을 삭제할까요? (모든 사용자·채팅 데이터가 사라집니다)"; then
        for v in openmake_pgdata openmake_redisdata; do
            docker volume rm "$v" >/dev/null 2>&1 && log_ok "$v 볼륨 삭제" || log_info "$v — 없음"
        done
    else
        log_info "볼륨은 남깁니다 — 재설치하면 기존 데이터가 그대로 붙습니다."
    fi
else
    log_warn "docker 미실행 — 컨테이너/볼륨은 Docker 기동 후 직접 제거하세요:"
    echo "    docker rm -f openmake-postgres openmake-redis"
    echo "    docker volume rm openmake_pgdata openmake_redisdata"
fi

# ── 3. 소스 디렉터리 ─────────────────────────────────────────────────────────
log_step "3/3 소스 디렉터리"
if [[ $KEEP_SOURCE -eq 1 ]]; then
    log_info "--keep-source — $SCRIPT_DIR 는 남깁니다."
elif [[ -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/openmake_llm.sh" ]]; then
    if confirm "$SCRIPT_DIR 를 통째로 삭제할까요? (.env 의 비밀키·비밀번호 포함)"; then
        cd /   # 지울 디렉터리 밖으로
        rm -rf "$SCRIPT_DIR"
        log_ok "$SCRIPT_DIR 삭제 완료"
    else
        log_info "소스는 남깁니다."
    fi
else
    log_warn "$SCRIPT_DIR 가 OpenMake LLM 소스로 보이지 않습니다 — 안전을 위해 삭제하지 않습니다."
fi

printf "\n%s제거 완료.%s 전역 도구(Node/Docker/PM2/colima)는 남아 있습니다 — 필요 없으면 직접 제거하세요.\n" "$C_OK" "$C_RESET"
