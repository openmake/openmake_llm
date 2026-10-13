-- 186 되돌리기: 검색 게이트 열과 근거 게이트 기록 테이블 제거.
DROP TABLE IF EXISTS chat_grounding_gate_log;
ALTER TABLE orchestrator_runs
    DROP COLUMN IF EXISTS search_gate_p_true,
    DROP COLUMN IF EXISTS search_gate_ms,
    DROP COLUMN IF EXISTS search_gate_error;
