#!/usr/bin/env bash
# Existing-data checks use metadata only; no daemon or host resources are changed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unset DOCKER_HOST DOCKER_CONTEXT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
context=""
if [[ "${1:-}" == --context ]]; then context="$2"; shift 2; fi
if [[ "${1:-}" == --host ]]; then context=selected; shift 2; fi
case "$1 ${2:-}" in
 'context inspect') [[ "${SOURCE_ABSENT:-0}" == 0 ]] ;;
 'info --format')
  if [[ "$context" == desktop-linux ]]; then [[ "${SOURCE_DOWN:-0}" == 0 ]] || exit 1; echo source-engine
  elif [[ "${SAME_ENGINE:-0}" == 1 ]]; then echo source-engine; else echo target-engine; fi ;;
 'ps -a')
  if [[ "$context" == colima-openmake && "${TARGET_EXISTS:-0}" == 1 ]]; then echo openmake-postgres; fi
  if [[ "$context" == desktop-linux && "${SOURCE_CONTAINER:-0}" == 1 ]]; then echo openmake-postgres; fi ;;
 'volume ls') [[ "${SOURCE_VOLUME:-0}" == 0 ]] || echo 'openmake_pgdata|openmake|openmake_pgdata' ;;
 *) echo 'Unexpected or mutating Docker command' >&2; exit 99 ;;
esac
MOCK
chmod +x "$TMP/bin/docker"
export DOCKER_CALLS="$TMP/calls"
PASS=0
check() {
 local name="$1" expected="$2" rc=0; shift 2
 PATH="$TMP/bin:$PATH" "$@" bash "$HERE/check-docker-desktop-data.sh" >/dev/null 2>&1 || rc=$?
 [[ "$rc" == "$expected" ]] || { printf 'FAIL %s: exit %s expected %s\n' "$name" "$rc" "$expected"; exit 1; }
 PASS=$((PASS+1))
}
check 'fresh install without Desktop' 0 env SOURCE_ABSENT=1
check 'existing Colima works with Desktop stopped' 0 env TARGET_EXISTS=1 SOURCE_DOWN=1
check 'Desktop unavailable cannot create a new empty target' 1 env SOURCE_DOWN=1
check 'existing config without either engine data must block' 1 env SOURCE_ABSENT=1 EXISTING_INSTALL=1
check 'Desktop PostgreSQL container requires explicit migration' 1 env SOURCE_CONTAINER=1
check 'Desktop named data volume requires explicit migration' 1 env SOURCE_VOLUME=1
check 'aliases of the same engine must block' 1 env SAME_ENGINE=1
check 'empty Desktop permits fresh Colima install' 0 env
check 'explicit home must not accept another context target' 1 env DOCKER_HOST=unix:///external/openmake/docker.sock TARGET_EXISTS=1 SOURCE_CONTAINER=1
if grep -Eq '(^| )(run|create|start|stop|rm|load|save)( |$)' "$DOCKER_CALLS"; then echo 'FAIL guard mutated Docker resources'; exit 1; fi
PASS=$((PASS+1))
printf 'mac-colima-guard.test: %s passed\n' "$PASS"
