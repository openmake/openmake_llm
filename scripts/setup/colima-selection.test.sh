#!/usr/bin/env bash
# Docker context metadata only; no real daemon, VM or host configuration is changed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$HERE/../lib/colima.sh"
docker() {
    [[ "$*" == 'context inspect colima-openmake --format {{.Endpoints.docker.Host}}' ]] || return 99
    [[ -n "${CONTEXT_ENDPOINT:-}" ]] || return 1
    printf '%s\n' "$CONTEXT_ENDPOINT"
}
PASS=0
eq() { [[ "$2" == "$3" ]] || { printf 'FAIL %s: %s != %s\n' "$1" "$2" "$3"; exit 1; }; PASS=$((PASS+1)); }
probe() {
    unset COLIMA_HOME DOCKER_HOST DOCKER_CONTEXT
    export DOCKER_HOST=unix:///desktop DOCKER_CONTEXT=desktop-linux
    [[ "$1" == __UNSET__ ]] || export COLIMA_HOME="$1"
    CONTEXT_ENDPOINT="$2"
    openmake_select_docker Darwin "$TMP/user"
    printf '%s|%s|%s' "$COLIMA_HOME" "$DOCKER_HOST" "${DOCKER_CONTEXT:-}"
}
eq 'fresh install default' "$(probe __UNSET__ '')" "$TMP/user/.colima|unix://$TMP/user/.colima/openmake/docker.sock|"
eq 'custom home with spaces' "$(probe '/Volumes/App Data/Colima' '')" '/Volumes/App Data/Colima|unix:///Volumes/App Data/Colima/openmake/docker.sock|'
eq 'registered external profile' "$(probe __UNSET__ 'unix:///Volumes/MAC_APP/Colima/openmake/docker.sock')" '/Volumes/MAC_APP/Colima|unix:///Volumes/MAC_APP/Colima/openmake/docker.sock|'
eq 'explicit home takes precedence' "$(probe /chosen 'unix:///other/openmake/docker.sock')" '/chosen|unix:///chosen/openmake/docker.sock|'
eq 'Desktop context endpoint is not adopted' "$(probe __UNSET__ 'unix:///Users/u/.docker/run/docker.sock')" "$TMP/user/.colima|unix://$TMP/user/.colima/openmake/docker.sock|"
eq 'remote endpoint is not adopted' "$(probe __UNSET__ 'tcp://remote:2375')" "$TMP/user/.colima|unix://$TMP/user/.colima/openmake/docker.sock|"
eq 'Linux environment unchanged' "$(COLIMA_HOME=/custom DOCKER_HOST=tcp://engine DOCKER_CONTEXT=custom; export COLIMA_HOME DOCKER_HOST DOCKER_CONTEXT; openmake_select_docker Linux "$TMP/user"; printf '%s|%s|%s' "$COLIMA_HOME" "$DOCKER_HOST" "$DOCKER_CONTEXT")" '/custom|tcp://engine|custom'
if (export COLIMA_HOME=relative; openmake_select_docker Darwin "$TMP/user") 2>/dev/null; then echo 'FAIL relative home accepted'; exit 1; fi
PASS=$((PASS+1))
printf 'colima-selection.test: %s passed\n' "$PASS"
