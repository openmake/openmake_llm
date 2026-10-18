#!/usr/bin/env bash
# db-backup.sh·db-restore.sh 공용 — 백업 파일 이름 규칙 한 곳.
# 산출물 이름은 <db>[-<instance>]-YYYYmmdd-HHMMSS.dump 다. 정리·최신 선택은 이 모양에 **정확히** 맞는 파일만 고른다 —
# 접두어(`<db>-*`)로 고르면 같은 BACKUP_DIR 를 쓰는 다른 인스턴스(openmake_llm-staging-…, qa 와 qa-2)의 백업까지 걸려
# 남의 백업을 지우거나 복원한다.

# find -name 패턴: backup_name_glob <db> [instance]
backup_name_glob() {
    local d8='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' d6='[0-9][0-9][0-9][0-9][0-9][0-9]'
    printf '%s%s-%s-%s.dump' "$1" "${2:+-$2}" "$d8" "$d6"
}
