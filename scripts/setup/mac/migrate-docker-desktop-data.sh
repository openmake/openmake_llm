#!/usr/bin/env bash
# macOS OpenMake Compose 데이터 볼륨을 Docker Desktop 에서 Colima 로 복사한다.
set -euo pipefail

SOURCE_CONTEXT="${OMK_DOCKER_MIGRATION_SOURCE_CONTEXT:-desktop-linux}"
TARGET_CONTEXT="${OMK_DOCKER_MIGRATION_TARGET_CONTEXT:-colima-openmake}"
BACKUP_DIR="${OMK_DOCKER_MIGRATION_BACKUP_DIR:-$HOME/.openmake/backups/docker-migration/$(date -u +%Y%m%dT%H%M%SZ)}"
COPY_IMAGE="${OMK_DOCKER_MIGRATION_COPY_IMAGE:-redis:7-alpine}"
POSTGRES_IMAGE="${OMK_DOCKER_MIGRATION_POSTGRES_IMAGE:-pgvector/pgvector:0.8.3-pg16-trixie}"
REDIS_IMAGE="${OMK_DOCKER_MIGRATION_REDIS_IMAGE:-redis:7-alpine}"
DRY_RUN=0
IF_AVAILABLE=0
INCLUDE_ORPHANS=0

log() { printf '[migration] %s\n' "$*"; }
fail() { printf '[migration] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source-context) SOURCE_CONTEXT="${2:?missing source context}"; shift ;;
        --target-context) TARGET_CONTEXT="${2:?missing target context}"; shift ;;
        --backup-dir) BACKUP_DIR="${2:?missing backup directory}"; shift ;;
        --dry-run) DRY_RUN=1 ;;
        --if-available) IF_AVAILABLE=1 ;;
        --include-orphan-postgres) INCLUDE_ORPHANS=1 ;;
        -h|--help)
            echo "Usage: $0 [--source-context CONTEXT] [--target-context CONTEXT] [--backup-dir DIR] [--dry-run]"
            exit 0
            ;;
        *) fail "unknown option: $1" ;;
    esac
    shift
done

context_ready() {
    docker context inspect "$1" >/dev/null 2>&1 && docker --context "$1" info >/dev/null 2>&1
}

volume_label() {
    docker --context "$1" volume inspect -f "{{ index .Labels \"$3\" }}" "$2" 2>/dev/null || true
}

verify_postgres() {
    local volume="$1" allow_orphan="${2:-0}" name="openmake-migration-check-pg-$$" tries=0 count
    count="$(docker --context "$TARGET_CONTEXT" run --rm --network none \
        --mount "type=volume,src=$volume,dst=/data,readonly" --entrypoint sh "$COPY_IMAGE" \
        -c 'cat /data/PG_VERSION' 2>/dev/null)" || fail "cannot read Postgres version from $volume"
    [[ "$count" == 16 ]] || fail "$volume uses PostgreSQL $count; expected 16. Source is unchanged."
    if ! docker --context "$TARGET_CONTEXT" run -d --name "$name" --network none --user postgres \
        --mount "type=volume,src=$volume,dst=/var/lib/postgresql/data" --entrypoint postgres \
        "$POSTGRES_IMAGE" -D /var/lib/postgresql/data -c listen_addresses= -c unix_socket_directories=/tmp >/dev/null; then
        fail "Postgres validation container could not start for $volume; source and backup are preserved"
    fi
    while (( tries < 30 )); do
        if docker --context "$TARGET_CONTEXT" exec "$name" pg_isready -h /tmp >/dev/null 2>&1; then break; fi
        if ! docker --context "$TARGET_CONTEXT" inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
            docker --context "$TARGET_CONTEXT" rm -f "$name" >/dev/null 2>&1 || true
            fail "Postgres could not recover $volume; source and backup are preserved"
        fi
        sleep 1; tries=$((tries + 1))
    done
    if (( tries == 30 )); then
        docker --context "$TARGET_CONTEXT" rm -f "$name" >/dev/null 2>&1 || true
        fail "Postgres readiness timed out for $volume; source and backup are preserved"
    fi
    if docker --context "$TARGET_CONTEXT" exec --user postgres "$name" psql -h /tmp -U openmake -d template1 -Atqc 'SELECT count(*) FROM pg_database' 2>/dev/null | grep -Eq '^[1-9][0-9]*$'; then
        log "OpenMake database query passed: $volume"
    elif (( allow_orphan )); then
        log "Postgres recovered but OpenMake role/database was not found; kept isolated: $volume"
    else
        docker --context "$TARGET_CONTEXT" rm -f "$name" >/dev/null 2>&1 || true
        fail "OpenMake database query failed for $volume; source and backup are preserved"
    fi
    docker --context "$TARGET_CONTEXT" stop -t 10 "$name" >/dev/null
    docker --context "$TARGET_CONTEXT" rm "$name" >/dev/null
    log "Postgres recovery validated: $volume"
}

verify_redis() {
    local volume="$1" name="openmake-migration-check-redis-$$" tries=0
    docker --context "$TARGET_CONTEXT" run -d --name "$name" --network none \
        --mount "type=volume,src=$volume,dst=/data" --entrypoint redis-server \
        "$REDIS_IMAGE" --dir /data --appendonly yes >/dev/null \
        || fail "Redis validation container could not start for $volume; source and backup are preserved"
    while (( tries < 30 )); do
        if docker --context "$TARGET_CONTEXT" exec "$name" redis-cli ping 2>/dev/null | grep -q PONG; then break; fi
        if ! docker --context "$TARGET_CONTEXT" inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
            docker --context "$TARGET_CONTEXT" rm -f "$name" >/dev/null 2>&1 || true
            fail "Redis could not recover $volume; source and backup are preserved"
        fi
        sleep 1; tries=$((tries + 1))
    done
    if (( tries == 30 )); then
        docker --context "$TARGET_CONTEXT" rm -f "$name" >/dev/null 2>&1 || true
        fail "Redis readiness timed out for $volume; source and backup are preserved"
    fi
    docker --context "$TARGET_CONTEXT" stop -t 10 "$name" >/dev/null
    docker --context "$TARGET_CONTEXT" rm "$name" >/dev/null
    log "Redis recovery/ping passed: $volume"
}

if ! context_ready "$SOURCE_CONTEXT"; then
    if (( IF_AVAILABLE )); then log "Docker Desktop context '$SOURCE_CONTEXT' is unavailable; skipped source migration"; exit 0; fi
    fail "source context '$SOURCE_CONTEXT' is unavailable; start Docker Desktop and retry before removing it"
fi
context_ready "$TARGET_CONTEXT" || fail "target context '$TARGET_CONTEXT' is unavailable; start Colima and retry"

volumes="$(docker --context "$SOURCE_CONTEXT" volume ls -q)"
candidates=()
while IFS= read -r volume; do
    [[ -n "$volume" ]] || continue
    project="$(volume_label "$SOURCE_CONTEXT" "$volume" com.docker.compose.project)"
    key="$(volume_label "$SOURCE_CONTEXT" "$volume" com.docker.compose.volume)"
    if [[ "$project" =~ ^openmake(-[a-z0-9-]+)?$ ]] && [[ "$key" == openmake_pgdata || "$key" == openmake_redisdata ]]; then
        [[ "$volume" == "${project}_${key#openmake_}" ]] || fail "unexpected Compose volume name '$volume' for $project/$key"
        candidates+=("$volume:$volume:$project:$key")
    elif (( INCLUDE_ORPHANS )) && [[ "$volume" =~ ^[a-f0-9]{64}$ ]]; then
        orphan_version="$(docker --context "$SOURCE_CONTEXT" run --rm --network none \
            --mount "type=volume,src=$volume,dst=/data,readonly" --entrypoint sh "$COPY_IMAGE" \
            -c 'cat /data/PG_VERSION' 2>/dev/null || true)"
        if [[ "$orphan_version" == 16 ]]; then
            target="openmake-recovered-pg-${volume:0:12}"
            candidates+=("$volume:$target:openmake-recovered:openmake_pgdata")
            log "found unlabelled PostgreSQL 16 volume; keeping it isolated as $target"
        fi
    fi
done <<< "$volumes"

if (( ${#candidates[@]} == 0 )); then log "no labeled OpenMake Postgres/Redis volumes found"; exit 0; fi

for item in "${candidates[@]}"; do
    IFS=: read -r volume target project key <<< "$item"
    attached="$(docker --context "$SOURCE_CONTEXT" ps -aq --filter "volume=$volume")"
    [[ -z "$attached" ]] || fail "source volume $volume is attached to a container; stop the OpenMake stack before migration"
    if docker --context "$TARGET_CONTEXT" volume inspect "$target" >/dev/null 2>&1; then
        target_project="$(volume_label "$TARGET_CONTEXT" "$target" com.docker.compose.project)"
        target_key="$(volume_label "$TARGET_CONTEXT" "$target" com.docker.compose.volume)"
        [[ "$target_project" == "$project" && "$target_key" == "$key" ]] \
            || fail "target volume $target exists with different labels; refusing to overwrite it"
        if [[ "$target" != "$volume" ]]; then
            source_volume="$(volume_label "$TARGET_CONTEXT" "$target" com.openmake.recovery.source-volume)"
            [[ "$source_volume" == "$volume" ]] || fail "recovery volume $target belongs to a different source; refusing to overwrite it"
        fi
        log "matching Colima volume already exists; source will not be copied again: $target"
        continue
    fi
    if [[ "$key" == openmake_pgdata ]]; then
        version="$(docker --context "$SOURCE_CONTEXT" run --rm --network none \
            --mount "type=volume,src=$volume,dst=/data,readonly" --entrypoint sh "$COPY_IMAGE" \
            -c 'cat /data/PG_VERSION' 2>/dev/null)" || fail "cannot read Postgres version from $volume"
        [[ "$version" == 16 ]] || fail "$volume uses PostgreSQL $version; expected 16. Source is unchanged."
    fi
    log "validated $volume -> $target ($project/$key)"
done

if (( DRY_RUN )); then log "dry run passed; ${#candidates[@]} volume(s) would be copied"; exit 0; fi

umask 077
mkdir -p "$(dirname "$BACKUP_DIR")"
mkdir "$BACKUP_DIR" 2>/dev/null || fail "backup directory already exists: $BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
log "private backup directory: $BACKUP_DIR"

for item in "${candidates[@]}"; do
    IFS=: read -r volume target project key <<< "$item"
    if docker --context "$TARGET_CONTEXT" volume inspect "$target" >/dev/null 2>&1; then
        if [[ "$key" == openmake_pgdata ]]; then verify_postgres "$target" "$([[ "$target" != "$volume" ]] && echo 1 || echo 0)"; else verify_redis "$target"; fi
        log "already migrated; source volume was retained: $volume"
        continue
    fi
    archive="$BACKUP_DIR/$volume.tar"
    docker --context "$SOURCE_CONTEXT" run --rm --network none \
        --mount "type=volume,src=$volume,dst=/source,readonly" --entrypoint sh "$COPY_IMAGE" \
        -c 'tar -C /source -cf - .' > "$archive" || fail "backup failed for $volume; source is unchanged"
    shasum -a 256 "$archive" > "$archive.sha256" || fail "checksum failed for $volume"
    shasum -a 256 -c "$archive.sha256" >/dev/null || fail "backup checksum mismatch for $volume"
    tar -tf "$archive" >/dev/null || fail "backup archive is invalid for $volume"
    if [[ "$target" == "$volume" ]]; then
        docker --context "$TARGET_CONTEXT" volume create \
            --label "com.docker.compose.project=$project" \
            --label "com.docker.compose.volume=$key" "$target" >/dev/null \
            || fail "could not create target volume $target"
    else
        docker --context "$TARGET_CONTEXT" volume create \
            --label "com.docker.compose.project=$project" \
            --label "com.docker.compose.volume=$key" \
            --label "com.openmake.recovery.source-volume=$volume" "$target" >/dev/null \
            || fail "could not create target recovery volume $target"
    fi
    docker --context "$TARGET_CONTEXT" run --rm -i --network none \
        --mount "type=volume,src=$target,dst=/target" --entrypoint sh "$COPY_IMAGE" \
        -c 'tar -C /target -xf -' < "$archive" || fail "restore failed for $target; source and backup are preserved"
    if [[ "$key" == openmake_pgdata ]]; then verify_postgres "$target" "$([[ "$target" != "$volume" ]] && echo 1 || echo 0)"; else verify_redis "$target"; fi
    log "copied and verified: $volume -> $target (source retained; backup: $archive)"
done

log "migration complete; Docker Desktop source volumes were not changed or removed"
