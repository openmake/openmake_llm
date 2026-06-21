-- ============================================================
-- 025_drop_redundant_active_index.sql — drop idx_agent_skills_status
-- ============================================================
-- 사유: 024 에서 추가한 partial index `idx_agent_skills_status WHERE status='active'`
-- 는 (1) 거의 모든 row 가 active 라 partial 의미 없음 + (2) 단일 status 컬럼은
-- low cardinality (3-value enum) 이라 planner 가 seq scan 선호.
-- write amplification 만 발생.
-- idx_agent_skills_status_created_by (WHERE status='draft') 는 유지 — drafts 가 minority.
-- ============================================================

DROP INDEX IF EXISTS idx_agent_skills_status;
