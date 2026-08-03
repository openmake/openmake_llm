#!/usr/bin/env bash
# ============================================================
# 에이전트 작업 비용/자원 집계 (2026-08-03)
# ============================================================
#   bash scripts/agent-cost-report.sh [기간일수]      # 기본 30일
#
# 왜 만들었나: total_tokens 는 066 마이그레이션부터 계속 쌓이고 있었는데 **볼 방법이 없었다**.
# 그 탓에 2026-08-03 우선순위 논의에서 두 번 연속 오진했다 —
#   ① "작업당 토큰 상한이 없다" → 실제로는 MAX_TOTAL_TOKENS(1M)가 이미 있었다
#   ② "실패의 42%가 재시도로 회수 가능" → 펼쳐보니 최근 10일 인프라 실패는 0건이었고
#      5건 전부 과거 특정 시기(백엔드 다운·예약 리포트 튜닝 전)에 몰려 있었다
# 둘 다 psql 을 직접 친 뒤에야 드러났다. 집계가 없으면 판단이 인상에 끌려간다.
#
# 볼 지표:
#   1) 상태 분포 — completed 대비 failed 비율, 실패 사유 구성
#   2) 토큰 분포(p50~p95) — 하드 상한(AGENT_MAX_TOTAL_TOKENS)·소프트 경계가 실효적인지
#   3) 상위 소비 작업 — 비용이 어디로 가는지 (특정 예약 작업이 대부분을 먹는 일이 흔하다)
#   4) 마무리 턴(final_turn) 발동 — 2026-08-03 도입. 발동 후 completed 로 끝났는지가 성패
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAYS="${1:-30}"
CONTAINER="${PG_CONTAINER:-openmake-postgres}"

# 운영 호스트엔 psql CLI 가 없다(brew postgresql 제거, docker 단독 운영) — 컨테이너 경유가 유일.
DB_URL="$(grep -o '^DATABASE_URL=.*' "$REPO/.env" | cut -d= -f2-)"
PGUSER="$(sed -E 's|.*://([^:]*):.*|\1|' <<<"$DB_URL")"
PGDB="$(sed -E 's|.*/([^/?]*)(\?.*)?$|\1|' <<<"$DB_URL")"

q() { docker exec "$CONTAINER" psql -U "$PGUSER" -d "$PGDB" -t -A -F'|' -c "$1"; }

echo "# 에이전트 작업 비용 집계 (최근 ${DAYS}일)"
date "+측정: %Y-%m-%d %H:%M"
echo

echo "## 1. 상태 분포"
q "SELECT rpad(status,10)||' '||lpad(count(*)::text,4)||'건  평균 '||lpad(coalesce(round(avg(total_tokens))::text,'-'),7)
   ||'  최대 '||lpad(coalesce(max(total_tokens)::text,'-'),7)||' 토큰'
   FROM agent_tasks WHERE created_at > now()-interval '$DAYS days' GROUP BY status ORDER BY count(*) DESC;"
echo

echo "## 2. 실패 사유"
q "SELECT rpad(left(coalesce(error,'(없음)'),40),42)||lpad(count(*)::text,3)||'건'
   FROM agent_tasks WHERE created_at > now()-interval '$DAYS days' AND status='failed'
   GROUP BY error ORDER BY count(*) DESC;"
echo

echo "## 3. 토큰 분포 (완료 작업)"
q "SELECT 'p50 '||lpad(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_tokens))::text,7)
   ||'   p75 '||lpad(round(percentile_cont(0.75) WITHIN GROUP (ORDER BY total_tokens))::text,7)
   ||'   p90 '||lpad(round(percentile_cont(0.9) WITHIN GROUP (ORDER BY total_tokens))::text,7)
   ||'   p95 '||lpad(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_tokens))::text,7)
   ||'   max '||lpad(max(total_tokens)::text,7)
   FROM agent_tasks WHERE created_at > now()-interval '$DAYS days' AND status='completed' AND total_tokens IS NOT NULL;"
q "SELECT '총 '||sum(total_tokens)||' 토큰 / '||count(*)||'건'||
   '   (200K 초과 '||count(*) FILTER (WHERE total_tokens>200000)||'건, 400K 초과 '||count(*) FILTER (WHERE total_tokens>400000)||'건)'
   FROM agent_tasks WHERE created_at > now()-interval '$DAYS days';"
echo

echo "## 4. 상위 소비 작업 10건"
q "SELECT lpad(coalesce(total_tokens,0)::text,7)||'  '||rpad(status,10)||' '||lpad(current_turn||'/'||max_turns,6)
   ||'  '||left(regexp_replace(goal, E'[\\n\\r]+', ' ', 'g'), 50)
   FROM agent_tasks WHERE created_at > now()-interval '$DAYS days'
   ORDER BY total_tokens DESC NULLS LAST LIMIT 10;"
echo

echo "## 5. 마무리 턴(final_turn) 발동 — 2026-08-03 도입"
# 발동 자체보다 **발동 후 어떻게 끝났는지**가 지표다. completed 로 끝나야 성공(산출물 절단 방지),
# max_turns_exhausted 로 끝나면 마무리 지시를 모델이 무시한 것이라 추가 조치가 필요하다.
FINAL_TURN="$(q "SELECT rpad(t.status||coalesce(' ('||t.error||')',''),34)||lpad(count(*)::text,3)||'건'
   FROM agent_task_steps s JOIN agent_tasks t ON t.id=s.task_id
   WHERE s.step_type='final_turn' AND t.created_at > now()-interval '$DAYS days'
   GROUP BY t.status, t.error ORDER BY count(*) DESC;")"
if [ -z "$FINAL_TURN" ]; then
    echo "(발동 없음 — 도입 이후 자원 상한에 닿은 작업이 아직 없습니다)"
else
    echo "$FINAL_TURN"
fi
