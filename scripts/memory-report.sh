#!/usr/bin/env bash
# ============================================================
# 사용자 메모리(user_memories) 관측 집계 (2026-09-06)
# ============================================================
#   bash scripts/memory-report.sh [기간일수]      # 기본 30일
#
# 왜 만들었나: Agent Memory Atlas 외부 리뷰(2026-09-06)가 "검색 없이 최신 50개 무조건 주입"을
# 최우선 개선으로 꼽았지만, 운영 user_memories 는 0행이었다. 검색·scope·supersede 도입은
# 이 집계가 게이트다 — 재개 조건: (a) 토큰 cap 발동 로그가 찍히기 시작 (b) 활성 메모리 p50 > 20.
# 그전에 벡터 검색을 붙이면 RAG·vector cache 를 실측 후 폐기한 이력을 되풀이한다.
#
# 볼 지표:
#   1) 행 분포 — 사용자별 활성 개수 p50/max, source 구성, tombstone(비활성) 수
#   2) 토글 — memoryLearning=false 로 끈 사용자 수 (서버 설정이 authority, PR #762)
#   3) 변경 감사 — memory.created/deleted/deleted_all (PR #762 부터 기록)
#   4) 로그 — 자동 저장·토큰 cap 발동 횟수 (OMK_LOG_DIR 의 앱 로그)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAYS="${1:-30}"
CONTAINER="${PG_CONTAINER:-openmake-postgres}"

# 운영 호스트엔 psql CLI 가 없다(docker 단독 운영) — 컨테이너 경유.
DB_URL="$(grep -o '^DATABASE_URL=.*' "$REPO/.env" | cut -d= -f2-)"
PGUSER="$(sed -E 's|.*://([^:]*):.*|\1|' <<<"$DB_URL")"
PGDB="$(sed -E 's|.*/([^/?]*)(\?.*)?$|\1|' <<<"$DB_URL")"
q() { docker exec "$CONTAINER" psql -U "$PGUSER" -d "$PGDB" -t -A -F'|' -c "$1"; }

echo "# 사용자 메모리 집계 (최근 ${DAYS}일)"
date "+측정: %Y-%m-%d %H:%M"
echo

echo "## 1. 행 분포"
q "SELECT '전체 '||count(*)||'행  활성 '||count(*) FILTER (WHERE is_active)||'  tombstone(비활성) '||count(*) FILTER (WHERE NOT is_active)
   ||'  사용자 '||count(DISTINCT user_id)||'명' FROM user_memories;"
q "SELECT '활성/사용자 p50 '||coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY c)::text,'-')||'  max '||coalesce(max(c)::text,'-')
   ||'  (검색 도입 게이트: p50 > 20)'
   FROM (SELECT user_id, count(*) c FROM user_memories WHERE is_active GROUP BY user_id) t;"
q "SELECT 'source '||source||' '||count(*) FROM user_memories GROUP BY source ORDER BY count(*) DESC;" | sed 's/^/  /'
echo

echo "## 2. 토글"
q "SELECT 'memoryLearning=false 사용자 '||count(*)||'명' FROM users WHERE preferences->>'memoryLearning' = 'false';"
echo

echo "## 3. 변경 감사 (audit_logs, ${DAYS}일)"
q "SELECT rpad(action,20)||' '||lpad(count(*)::text,4)||'건' FROM audit_logs
   WHERE action LIKE 'memory.%' AND timestamp > now()-interval '$DAYS days' GROUP BY action ORDER BY action;" | sed 's/^/  /'
echo

echo "## 4. 로그 (자동 저장·토큰 cap)"
OMK_LOG_DIR="${OMK_LOG_DIR:-$(grep -E "^OMK_LOG_DIR=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')}"
LOG="${OMK_LOG_DIR:-/tmp}/openmake-llm-out.log"
if [[ -r "$LOG" ]]; then
    echo "  자동 저장(MemoryExtract) $(grep -c '\[MemoryExtract\] 자동 저장' "$LOG" || true)회"
    echo "  토큰 cap 발동          $(grep -c 'user_memories 토큰 cap 적용' "$LOG" || true)회  (검색 도입 게이트: > 0)"
    echo "  설정 조회 폴백(MemoryPolicy) $(grep -c 'memoryLearning 설정 조회 실패' "$LOG" || true)회"
else
    echo "  (로그 없음: $LOG)"
fi
