-- 089: 도구 결과 절단 셰도우 계측 (G3, 2026-08-08)
--
-- MAX_TOOL_RESULT_CHARS(기본 8000자) 단순 절단이 실제로 얼마나 자주·얼마나 크게
-- 발생하는지 실측한다 (measure-first — chunk→병렬요약 도입은 이 데이터가 게이트).
-- 전 도구 호출을 적재해 도구별 절단률(truncated/total)과 절단 폭(raw_chars-cap_chars)을
-- 집계할 수 있게 한다. 실행 경로는 바꾸지 않는다 (fire-and-forget, 086 과 동일 패턴).
-- 보존: db-retention 이 METRICS_RETENTION_DAYS 로 정리 (append-only 무한 증가 방지).

CREATE TABLE IF NOT EXISTS tool_result_truncations (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 절단이 적용된 경로: 'chat'(external-tool-exec) | 'agent_task'(task-steps runTool)
    path TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    -- 절단 전 원본 문자 수 / 적용된 캡
    raw_chars INTEGER NOT NULL,
    cap_chars INTEGER NOT NULL,
    truncated BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_result_truncations_created
    ON tool_result_truncations (created_at);
CREATE INDEX IF NOT EXISTS idx_tool_result_truncations_tool
    ON tool_result_truncations (tool_name, truncated);
