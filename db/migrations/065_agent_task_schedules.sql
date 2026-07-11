-- 065: Agent Task 스케줄/반복 트리거 (Phase 3-A)
--
-- 자율 에이전트 작업을 cron 또는 interval 로 반복 실행하기 위한 스케줄 정의.
-- 스케줄러 tick 이 next_run_at <= now 인 enabled 스케줄을 찾아 agent_task 를 생성·큐 제출하고
-- next_run_at 을 재계산한다. consecutive_failures 가 임계 초과하면 자동 비활성(폭주 차단).
-- 멱등(IF NOT EXISTS). 수동 적용(cli.ts migrate).

CREATE TABLE IF NOT EXISTS agent_task_schedules (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    goal TEXT NOT NULL,
    cron TEXT,
    interval_seconds INTEGER,
    max_turns INTEGER DEFAULT 10,
    enabled BOOLEAN DEFAULT true,
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_task_id TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- cron 또는 interval 중 하나는 반드시 지정.
    CONSTRAINT agent_task_schedules_timing_check CHECK (cron IS NOT NULL OR interval_seconds IS NOT NULL)
);

-- due 조회(enabled + next_run_at)용 부분 인덱스.
CREATE INDEX IF NOT EXISTS idx_agent_task_schedules_due
    ON agent_task_schedules(next_run_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_agent_task_schedules_user
    ON agent_task_schedules(user_id);

COMMENT ON TABLE agent_task_schedules IS 'Agent Task 반복 트리거 정의(cron/interval). 스케줄러가 due 시 task 생성·큐 제출.';
