#!/usr/bin/env bash
# ============================================================
# Knowledge 수집 worker 모드 조회·전환 (설계 D5, 2026-10-16)
# ============================================================
# DB 의 knowledge_worker_mode 단일 행(id=1)이 claim 권한을 정한다 — 소비자(API inprocess poller·별도 worker)는
# claim 때 자기 종류와 대조해 다르면 집지 않는다. set 은 모드를 바꾸며 generation 을 1 올린다.
#
#   scripts/knowledge-worker-mode.sh show                     모드·generation·heartbeat·대기열 요약
#                                                             (queued_due 실행할 때가 됨 · queued_delayed run_after 가 미래 — 재시도 대기·지연 정리)
#   scripts/knowledge-worker-mode.sh set inprocess|external   모드 전환(generation+1)
#   scripts/knowledge-worker-mode.sh generation               generation 숫자만
#   scripts/knowledge-worker-mode.sh running-leases           살아 있는 lease 를 쥔 running 작업 수
#
# 접속(환경변수 — 서버 이름은 쓰지 않는다):
#   DATABASE_URL     대상 DB 접속 문자열(호스트에 psql 이 있을 때)
#   KNOWLEDGE_PSQL   psql 명령 접두 — 호스트에 psql 이 없으면 컨테이너 안 psql 을 쓴다. 셸 문법 그대로 실행된다. 예:
#                    KNOWLEDGE_PSQL='docker exec -i <컨테이너> sh -c '\''psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"'\'' psql'
#                    둘 다 있으면 KNOWLEDGE_PSQL 을 쓴다.
#
# 종료 코드: 0 성공 · 2 사용법·접속 정보 오류 · 3 DB 오류
# ⚠️ set 은 운영 DB 를 바꾼다 — 롤백 훈련(scripts/knowledge-worker-rollback-drill.sh) 순서 안에서 쓴다.
set -euo pipefail

usage() {
    sed -n '2,21p' "$0" >&2
    exit 2
}

SUBCOMMAND="${1:-}"
MODE_ARG="${2:-}"
case "$SUBCOMMAND" in
    show|generation|running-leases) ;;
    set) [[ "$MODE_ARG" == "inprocess" || "$MODE_ARG" == "external" ]] || usage ;;
    *) usage ;;
esac

if [[ -z "${KNOWLEDGE_PSQL:-}" ]]; then
    if [[ -z "${DATABASE_URL:-}" ]]; then
        echo "DATABASE_URL 이 필요하다(또는 KNOWLEDGE_PSQL 로 psql 명령 접두를 준다)" >&2
        exit 2
    fi
    if ! command -v psql >/dev/null 2>&1; then
        echo "호스트에 psql 이 없다 — KNOWLEDGE_PSQL 로 컨테이너 안 psql 을 지정한다" >&2
        exit 2
    fi
fi

PSQL_FLAGS=(-X -q -t -A -F '|' -v ON_ERROR_STOP=1)

# SQL 은 표준입력으로 넘긴다(psql 변수 :'name' 치환은 -c 에서는 일어나지 않는다).
# 값은 -v 로만 넘기고 SQL 문자열에 이어 붙이지 않는다.
run_sql() {
    if [[ -n "${KNOWLEDGE_PSQL:-}" ]]; then
        bash -c "$KNOWLEDGE_PSQL \"\$@\"" knowledge-psql "${PSQL_FLAGS[@]}" "$@" || exit 3
    else
        psql "$DATABASE_URL" "${PSQL_FLAGS[@]}" "$@" || exit 3
    fi
}

cmd_show() {
    run_sql <<'SQL'
SELECT 'mode|' || mode || '|generation ' || generation || '|updated ' || to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS TZ')
  FROM knowledge_worker_mode WHERE id = 1;
SELECT 'heartbeat|' || worker_id || '|' || mode || '|generation ' || generation || '|inflight ' || inflight
       || '|age_ms ' || (EXTRACT(EPOCH FROM (NOW() - last_seen)) * 1000)::bigint
  FROM knowledge_worker_heartbeats ORDER BY last_seen DESC;
SELECT 'queue|queued_due ' || COUNT(*) FILTER (WHERE state = 'queued' AND run_after <= NOW())
       || '|queued_delayed ' || COUNT(*) FILTER (WHERE state = 'queued' AND run_after > NOW())
       || '|running ' || COUNT(*) FILTER (WHERE state = 'running')
       || '|live_leases ' || COUNT(*) FILTER (WHERE state = 'running' AND lease_expires_at > NOW())
  FROM knowledge_ingestion_jobs;
SQL
}

cmd_set() {
    run_sql -v mode="$MODE_ARG" <<'SQL'
INSERT INTO knowledge_worker_mode (id, mode, generation, updated_at) VALUES (1, :'mode', 1, NOW())
ON CONFLICT (id) DO UPDATE
   SET mode = EXCLUDED.mode, generation = knowledge_worker_mode.generation + 1, updated_at = NOW()
RETURNING 'mode|' || mode || '|generation ' || generation;
SQL
}

cmd_generation() {
    run_sql <<'SQL'
SELECT generation FROM knowledge_worker_mode WHERE id = 1;
SQL
}

cmd_running_leases() {
    run_sql <<'SQL'
SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE state = 'running' AND lease_expires_at > NOW();
SQL
}

case "$SUBCOMMAND" in
    show) cmd_show ;;
    set) cmd_set ;;
    generation) cmd_generation ;;
    running-leases) cmd_running_leases ;;
esac
