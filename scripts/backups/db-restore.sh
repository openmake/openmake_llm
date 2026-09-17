#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 백업 디렉터리에서 덤프를 골라 복원한다.
#
# 실제 DROP/CREATE/pg_restore/migrate/pm2 재시작 로직은 openmake_llm.sh 의
# `db-restore` 서브커맨드에 이미 있다 — 여기서는 중복 구현하지 않고 그 파일을
# 백업 디렉터리(BACKUP_DIR)에서 찾아 위임만 한다.
#
# 사용법:
#   ./scripts/backups/db-restore.sh --latest [--yes]     # 가장 최근 백업으로 복원
#   ./scripts/backups/db-restore.sh <파일명|경로> [--yes]  # 특정 백업으로 복원
#   ./scripts/backups/db-restore.sh --latest --dry-run   # 어떤 파일을 복원할지만 확인
#
# 환경변수: BACKUP_DIR (기본: <repo>/backups) — db-backup.sh 와 동일.
#
# ⚠ 이 스크립트는 대상 DB 를 통째로 DROP/CREATE 후 덤프 내용으로 대체한다
#   (openmake_llm.sh db-restore 위임). 반드시 --dry-run 으로 대상 파일부터 확인할 것.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPO_ROOT

log_info() { printf "[INFO]  %s\n" "$*"; }
log_err()  { printf "[ERR]   %s\n" "$*" >&2; }

env_line() {
    [[ -f "$REPO_ROOT/.env" ]] || return 0
    grep -E "^$1=" "$REPO_ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ' || true
}

BACKUP_DIR="${BACKUP_DIR:-$(env_line BACKUP_DIR)}"
readonly BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"

DRY_RUN=0
YES=0
TARGET=""
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --yes|-y) YES=1 ;;
        --latest) TARGET="--latest" ;;
        -h|--help)
            sed -n '2,20p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *)
            [[ -n "$TARGET" && "$TARGET" != "--latest" ]] && { log_err "파일 인자가 두 번 지정됨"; exit 1; }
            TARGET="$arg"
            ;;
    esac
done

[[ -n "$TARGET" ]] || { log_err "사용법: $0 (--latest|<파일명|경로>) [--yes] [--dry-run]"; exit 1; }

if [[ "$TARGET" == "--latest" ]]; then
    [[ -d "$BACKUP_DIR" ]] || { log_err "백업 디렉터리 없음: $BACKUP_DIR"; exit 1; }
    FILE="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -exec ls -1t {} + 2>/dev/null | head -n 1)"
    [[ -n "$FILE" ]] || { log_err "복원할 .dump 파일이 없습니다: $BACKUP_DIR"; exit 1; }
else
    if [[ -f "$TARGET" ]]; then
        FILE="$TARGET"
    elif [[ -f "$BACKUP_DIR/$TARGET" ]]; then
        FILE="$BACKUP_DIR/$TARGET"
    else
        log_err "백업 파일을 찾을 수 없음: $TARGET (경로 또는 $BACKUP_DIR 기준으로 확인)"
        exit 1
    fi
fi

log_info "복원 대상: $FILE ($(du -h "$FILE" 2>/dev/null | cut -f1))"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] 위임 예정: $REPO_ROOT/openmake_llm.sh db-restore \"$FILE\" $([[ "$YES" -eq 1 ]] && echo --yes)"
    exit 0
fi

if [[ "$YES" -eq 1 ]]; then
    exec "$REPO_ROOT/openmake_llm.sh" db-restore "$FILE" --yes
else
    exec "$REPO_ROOT/openmake_llm.sh" db-restore "$FILE"
fi
