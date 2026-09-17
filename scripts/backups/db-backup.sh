#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — PostgreSQL 일일 백업 (docker exec pg_dump -Fc) + 보존기간 정리
#                + 무결성 확인(pg_restore --list)
#
# 사용법:
#   ./scripts/backups/db-backup.sh              # 백업 실행
#   ./scripts/backups/db-backup.sh --dry-run    # 실제 dump/삭제 없이 수행할 내용만 출력
#
# 환경변수 (.env 또는 셸 — 우선순위: 셸 > .env > 기본값):
#   BACKUP_DIR              백업 파일 저장 디렉터리 (기본: <repo>/backups)
#   BACKUP_RETENTION_DAYS   보존 기간(일) — 지나면 자동 삭제 (기본: 14)
#   OMK_INSTANCE            openmake_llm.sh 와 동일 규칙으로 컨테이너 이름 계산
#                           (openmake${OMK_INSTANCE:+-$OMK_INSTANCE}-postgres)
#   POSTGRES_USER / POSTGRES_DB — .env 참조 (기본 openmake / openmake_llm)
#
# 산출물: $BACKUP_DIR/<db>[-<instance>]-<YYYYmmdd-HHMMSS>.dump (pg_dump custom format)
#
# 복원: scripts/backups/db-restore.sh 참고 (openmake_llm.sh db-restore 로 위임).
#
# 매일 자동 실행: scripts/backups/com.openmake.llm.db-backup.plist.template 참고
#   (launchd 설치는 운영자가 직접 판단 — 이 스크립트는 설치하지 않는다).
#
# ⚠ 이 스크립트는 운영 컨테이너(docker exec)에 접속해 실제로 pg_dump 를 실행한다.
#   내용만 확인하려면 반드시 --dry-run 으로 먼저 실행할 것.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPO_ROOT

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,25p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *)
            echo "[ERR]   알 수 없는 옵션: $arg (지원: --dry-run)" >&2
            exit 1
            ;;
    esac
done

log_info() { printf "[INFO]  %s\n" "$*"; }
log_ok()   { printf "[OK]    %s\n" "$*"; }
log_warn() { printf "[WARN]  %s\n" "$*"; }
log_err()  { printf "[ERR]   %s\n" "$*" >&2; }

# .env 에서 키 하나만 추출 (openmake_llm.sh 의 env_line 과 동일 규칙 — 전체 source 안 함).
env_line() {
    [[ -f "$REPO_ROOT/.env" ]] || return 0
    grep -E "^$1=" "$REPO_ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ' || true
}

INSTANCE="${OMK_INSTANCE:-$(env_line OMK_INSTANCE)}"
readonly INSTANCE
readonly PG_CONTAINER="openmake${INSTANCE:+-$INSTANCE}-postgres"

PG_USER="${POSTGRES_USER:-$(env_line POSTGRES_USER)}"
readonly PG_USER="${PG_USER:-openmake}"
PG_DB="${POSTGRES_DB:-$(env_line POSTGRES_DB)}"
readonly PG_DB="${PG_DB:-openmake_llm}"

BACKUP_DIR="${BACKUP_DIR:-$(env_line BACKUP_DIR)}"
readonly BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$(env_line BACKUP_RETENTION_DAYS)}"
readonly RETENTION_DAYS="${RETENTION_DAYS:-14}"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/${PG_DB}${INSTANCE:+-$INSTANCE}-${TS}.dump"

log_info "대상 컨테이너: $PG_CONTAINER (db=$PG_DB, user=$PG_USER)"
log_info "백업 디렉터리: $BACKUP_DIR (보존 ${RETENTION_DAYS}일)"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] mkdir -p $BACKUP_DIR"
    log_info "[dry-run] docker exec $PG_CONTAINER pg_dump -U $PG_USER -Fc $PG_DB > $OUT_FILE"
    log_info "[dry-run] docker exec -i $PG_CONTAINER pg_restore --list  < $OUT_FILE  (무결성 확인)"
    if [[ -d "$BACKUP_DIR" ]]; then
        local_old="$(find "$BACKUP_DIR" -maxdepth 1 -name "${PG_DB}*.dump" -type f -mtime "+${RETENTION_DAYS}" 2>/dev/null | wc -l | tr -d ' ')"
        log_info "[dry-run] 삭제 대상(${RETENTION_DAYS}일 초과): ${local_old}개"
    fi
    log_ok "[dry-run] 완료 — 실제 실행 없음"
    exit 0
fi

command -v docker >/dev/null 2>&1 || { log_err "docker 미설치"; exit 1; }
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
    log_err "PostgreSQL 컨테이너($PG_CONTAINER)가 떠 있지 않습니다"
    exit 2
fi

mkdir -p "$BACKUP_DIR"

log_info "덤프 시작: $PG_CONTAINER/$PG_DB → $OUT_FILE (pg_dump -Fc)"
if ! docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$OUT_FILE"; then
    rm -f "$OUT_FILE"
    log_err "pg_dump 실패"
    exit 2
fi

# 무결성 확인 — custom format 아카이브 목차를 읽어본다. 손상된 덤프는 여기서 비영(0)
# 종료코드가 아니게 되므로 그대로 두면 안 되는 백업이 조용히 쌓인다.
log_info "무결성 확인 (pg_restore --list)"
if ! docker exec -i "$PG_CONTAINER" pg_restore --list < "$OUT_FILE" >/dev/null 2>&1; then
    log_err "무결성 확인 실패 — 손상된 덤프로 판단해 삭제합니다: $OUT_FILE"
    rm -f "$OUT_FILE"
    exit 2
fi

log_ok "백업 완료: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# 보존 기간 정리 — 이 DB/인스턴스 접두어를 가진 .dump 파일만 대상으로 한다.
deleted=0
while IFS= read -r -d '' f; do
    rm -f "$f"
    deleted=$((deleted + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "${PG_DB}${INSTANCE:+-$INSTANCE}-*.dump" -type f -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null)

if [[ "$deleted" -gt 0 ]]; then
    log_ok "보존기간(${RETENTION_DAYS}일) 초과 백업 ${deleted}개 삭제"
else
    log_info "보존기간 초과 백업 없음"
fi
