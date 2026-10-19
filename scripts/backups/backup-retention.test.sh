#!/usr/bin/env bash
# db-backup.sh 보존 정리·db-restore.sh --latest 가 같은 BACKUP_DIR 의 다른 인스턴스 백업을 건드리지 않는지 —
# 실제 DB·docker 를 쓰지 않는다. 임시 레포 자리에 두 스크립트를 복사하고, PATH 앞의 가짜 docker 가 덤프 바이트만 내준다.
#   bash scripts/backups/backup-retention.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
export LC_ALL=C   # 글롭 정렬 순서를 OS·로캘과 무관하게
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }

REPO="$TMP/repo"; mkdir -p "$REPO/scripts/backups"
mkdir -p "$REPO/scripts/lib"; cp "$HERE/../lib/colima.sh" "$REPO/scripts/lib/"
cp "$HERE/db-backup.sh" "$HERE/db-restore.sh" "$HERE/backup-lib.sh" "$REPO/scripts/backups/"
BIN="$TMP/bin"; mkdir -p "$BIN"
# 가짜 docker — 대상 컨테이너가 떠 있다고 답하고, pg_dump 는 바이트를 내고, pg_restore --list 는 성공한다
cat > "$BIN/docker" <<'EOS'
#!/usr/bin/env bash
case "$1" in
    ps) printf 'openmake-postgres\nopenmake-staging-postgres\nopenmake-qa-postgres\n' ;;
    exec) if [[ " $* " == *" pg_dump "* ]]; then printf 'PGDMP'; elif [[ "${2:-}" == "-i" ]]; then cat >/dev/null; fi ;;
esac
exit 0
EOS
chmod +x "$BIN/docker"

OLD='202601010000'   # 보존기간(기본 14일)을 넘긴 시각
BK="$TMP/backups"
seed() {
    rm -rf "$BK"; mkdir -p "$BK"
    local f
    for f in openmake_llm-20260101-000000.dump openmake_llm-staging-20260101-000000.dump \
             openmake_llm-qa-20260101-000000.dump openmake_llm-qa-2-20260101-000000.dump \
             openmake_llm-manual.dump; do
        : > "$BK/$f"; touch -t "$OLD" "$BK/$f"
    done
}
# 오늘 만든 백업을 뺀 남은 파일 이름(정렬, 공백 구분)
remaining() {
    local f today; today="-$(date +%Y%m%d)-"
    for f in "$BK"/*; do f="${f##*/}"; [[ "$f" == *"$today"* ]] || printf '%s ' "$f"; done
}
today_count() { local n=0 f; for f in "$BK/$1-$(date +%Y%m%d)-"*.dump; do [[ -e "$f" ]] && n=$((n+1)); done; echo "$n"; }
backup() { PATH="$BIN:$PATH" BACKUP_DIR="$BK" DOCKER_HOST=unix:///nonexistent OMK_INSTANCE="$1" bash "$REPO/scripts/backups/db-backup.sh" </dev/null >/dev/null 2>&1; }

# ── 기본 인스턴스의 정리는 자기 백업만 지운다(종전: openmake_llm-*.dump 라 staging·qa 백업까지 지웠다) ──
seed; backup ""
eq "default: 다른 인스턴스·수동 이름은 남는다" "$(remaining)" \
   "openmake_llm-manual.dump openmake_llm-qa-2-20260101-000000.dump openmake_llm-qa-20260101-000000.dump openmake_llm-staging-20260101-000000.dump "

# ── qa 의 정리는 qa-2 를 지우지 않는다 ──
seed; backup qa
eq "qa: qa-2 는 남는다" "$(remaining)" \
   "openmake_llm-20260101-000000.dump openmake_llm-manual.dump openmake_llm-qa-2-20260101-000000.dump openmake_llm-staging-20260101-000000.dump "

# ── 오늘 만든 백업은 그 인스턴스 이름으로 남는다 ──
eq "qa: 새 백업 1개" "$(today_count openmake_llm-qa)" "1"

# ── restore --latest 는 이 인스턴스의 최신 백업만 고른다(종전: 폴더 전체의 최신 *.dump) ──
latest() { PATH="$BIN:$PATH" BACKUP_DIR="$BK" OMK_INSTANCE="$1" bash "$REPO/scripts/backups/db-restore.sh" --latest --dry-run </dev/null 2>&1 | sed -n 's/^\[INFO\]  복원 대상: \([^ ]*\).*/\1/p'; }
seed
touch -t 202601020000 "$BK/openmake_llm-20260101-000000.dump"
touch -t 202601030000 "$BK/openmake_llm-staging-20260101-000000.dump"   # 폴더 전체로는 이게 최신
eq "restore default: staging 이 더 최신이어도 자기 것" "$(latest "")" "$BK/openmake_llm-20260101-000000.dump"
eq "restore staging" "$(latest staging)" "$BK/openmake_llm-staging-20260101-000000.dump"
rm -f "$BK"/openmake_llm-2026*.dump
eq "restore default: 자기 백업이 없으면 남의 것을 고르지 않는다" "$(latest "")" ""

printf 'backup-retention.test: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
