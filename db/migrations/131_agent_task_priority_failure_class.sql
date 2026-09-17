-- 131: Agent Task 큐 우선순위 · 실패 분류 (2026-09-17, F16.6/F15.6)
-- priority: 큐 대기열에서 높을수록 먼저(예약 -1, 기본 0, 관리자만 >0). failure_class: failed 확정 시 사유 분류(실패 큐 뷰).
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS failure_class TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_failed_class
    ON agent_tasks(failure_class, updated_at DESC) WHERE status = 'failed';
COMMENT ON COLUMN agent_tasks.priority IS '큐 우선순위(높을수록 먼저, 예약 -1, 기본 0, 관리자 상한 AGENT_TASK_QUEUE_PRIORITY_MAX)(131)';
COMMENT ON COLUMN agent_tasks.failure_class IS 'failed 전이 시 error 로 분류(config/agent-task-failure-class) — 실패 큐 뷰(131)';

-- 기존 failed 행 분류(재실행해도 같은 결과 — 분류표와 같은 규칙)
UPDATE agent_tasks SET failure_class = CASE
    WHEN error = 'goal_incomplete' THEN 'goal_incomplete'
    WHEN error = 'max_turns_exhausted' THEN 'max_turns'
    WHEN error = 'token_limit' THEN 'token_limit'
    WHEN error IN ('interrupted', 'interrupted_local_device', 'server restarted') THEN 'interrupted'
    WHEN error ILIKE '%timed out%' OR error ILIKE '%timeout%' THEN 'timeout'
    WHEN error ILIKE '%aborted%' OR error ILIKE '%connection error%' OR error ILIKE '%internalservererror%' OR error ~ '^[45][0-9][0-9] ' THEN 'llm_error'
    ELSE 'unknown'
END
WHERE status = 'failed' AND failure_class IS NULL;
