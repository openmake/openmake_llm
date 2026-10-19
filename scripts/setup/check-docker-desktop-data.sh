#!/usr/bin/env bash
# Installation preflight only. Never copies, mounts or starts database volumes.
set -euo pipefail
SOURCE_CONTEXT="${OMK_DOCKER_MIGRATION_SOURCE_CONTEXT:-desktop-linux}"
TARGET_CONTEXT="${OMK_DOCKER_MIGRATION_TARGET_CONTEXT:-colima-openmake}"
TARGET_CONTAINER="${PG_CONTAINER:-openmake-postgres}"
EXISTING_INSTALL="${EXISTING_INSTALL:-0}"
fail() { printf '[colima] %s\n' "$*" >&2; exit 1; }
[[ "$SOURCE_CONTEXT" != "$TARGET_CONTEXT" ]] || fail 'Source and target contexts must differ.'
target_docker() {
    if [[ -n "${DOCKER_HOST:-}" ]]; then
        (unset DOCKER_CONTEXT; docker --host "$DOCKER_HOST" "$@")
    else
        docker --context "$TARGET_CONTEXT" "$@"
    fi
}
target_id="$(target_docker info --format '{{.ID}}')" || fail 'Colima is unavailable.'
[[ -n "$target_id" ]] || fail 'Colima daemon identity is unavailable.'
source_known=0; source_ready=0
if docker context inspect "$SOURCE_CONTEXT" >/dev/null 2>&1; then
    source_known=1
    if source_id="$(docker --context "$SOURCE_CONTEXT" info --format '{{.ID}}' 2>/dev/null)"; then
        [[ -n "$source_id" ]] || fail 'Source daemon identity is unavailable.'
        [[ "$source_id" != "$target_id" ]] || fail 'Source and target contexts refer to the same Docker engine.'
        source_ready=1
    fi
fi
target_names="$(target_docker ps -a --format '{{.Names}}')" || fail 'Cannot inspect Colima containers.'
if grep -qxF "$TARGET_CONTAINER" <<< "$target_names"; then
    printf '[colima] Existing target container retained: %s; no data migration attempted.\n' "$TARGET_CONTAINER"
    exit 0
fi
if (( ! source_ready )); then
    if (( source_known || EXISTING_INSTALL )); then
        fail 'An existing installation/source cannot be inspected. Start Docker Desktop and check its data before installing a new Colima database.'
    fi
    printf '[colima] Fresh installation; no Docker Desktop source context.\n'
    exit 0
fi
source_names="$(docker --context "$SOURCE_CONTEXT" ps -a --format '{{.Names}}')" || fail 'Cannot inspect source containers.'
source_volumes="$(docker --context "$SOURCE_CONTEXT" volume ls --format '{{.Name}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.volume"}}')" || fail 'Cannot inspect source volumes.'
if grep -qE '^openmake(-[a-z0-9-]+)?-postgres$' <<< "$source_names" \
    || grep -qE '\|openmake(-[a-z0-9-]+)?\|openmake_(pgdata|redisdata)$' <<< "$source_volumes"; then
    fail 'Existing OpenMake data remains on Docker Desktop. Back up and migrate it explicitly, verify the Colima target, then rerun installation. Original containers and volumes were not modified.'
fi
printf '[colima] No OpenMake source data found; fresh installation may continue.\n'
