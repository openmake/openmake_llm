#!/usr/bin/env bash
# macOS Docker volume migration selection and refusal paths; no real Docker resources touched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'MOCK'
#!/usr/bin/env bash
context=""
[[ "${1:-}" == --context ]] && { context="$2"; shift 2; }
case "$1 ${2:-}" in
    "context inspect") [[ "${SOURCE_DOWN:-0}" != 1 ]]; exit ;;
    info*) [[ "${SOURCE_DOWN:-0}" != 1 ]] || [[ "$context" != "$SOURCE_CONTEXT" ]]; exit ;;
    "volume ls") printf '%s\n' openmake-dev_pgdata openmake-dev_redisdata unknown-volume 3ed183ffe89b50e812afe47676c0274363313f7304819c08f01b3ff66093eef4 ;;
    "volume inspect")
        if [[ "${3:-}" == -f ]]; then
            if [[ "$context" == colima && "${DEST_EXISTS:-0}" == 1 && "${DEST_LABEL_MISMATCH:-0}" == 1 ]]; then
                [[ "$4" == *project* ]] && echo someone-else || echo unrelated_data
                exit 0
            fi
            case "$4:$5" in
                *project*openmake-dev_pgdata) echo openmake-dev ;;
                *volume*openmake-dev_pgdata) echo openmake_pgdata ;;
                *project*openmake-dev_redisdata) echo openmake-dev ;;
                *volume*openmake-dev_redisdata) echo openmake_redisdata ;;
                *) echo ;;
            esac
            exit 0
        fi
        [[ "${DEST_EXISTS:-0}" == 1 ]] && exit 0 || exit 1
        ;;
    "ps -aq") [[ "${ATTACHED:-0}" == 1 ]] && echo container123; exit 0 ;;
    run*) [[ "${POSTGRES_VERSION:-16}" == 16 ]] && echo "${POSTGRES_VERSION:-16}" || echo "${POSTGRES_VERSION}" ;;
    *) echo "unexpected docker args: $*" >&2; exit 99 ;;
esac
MOCK
chmod +x "$BIN/docker"

PASS=0; FAIL=0
check() { local name="$1" expected="$2"; shift 2; local output rc=0; output="$(PATH="$BIN:$PATH" SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima "$@" 2>&1)" || rc=$?; if [[ "$rc" == "$expected" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s (exit %s expected %s):\n%s\n' "$name" "$rc" "$expected" "$output"; fi; }

check "dry run selects only named OpenMake DB volumes" 0 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run
check "orphan PostgreSQL volumes require explicit opt-in" 0 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run --include-orphan-postgres
check "attached source volume is refused" 1 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima ATTACHED=1 bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run
check "previously migrated destination is skipped" 0 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima DEST_EXISTS=1 bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run
check "unrelated destination volume is refused" 1 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima DEST_EXISTS=1 DEST_LABEL_MISMATCH=1 bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run
check "unexpected Postgres major is refused" 1 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima POSTGRES_VERSION=15 bash "$HERE/mac/migrate-docker-desktop-data.sh" --dry-run
check "missing source can be skipped during install" 0 env OMK_DOCKER_MIGRATION_SOURCE_CONTEXT=desktop OMK_DOCKER_MIGRATION_TARGET_CONTEXT=colima SOURCE_CONTEXT=desktop TARGET_CONTEXT=colima SOURCE_DOWN=1 bash "$HERE/mac/migrate-docker-desktop-data.sh" --if-available

printf '\nmigration.test: %s passed, %s failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
