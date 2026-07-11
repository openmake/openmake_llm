-- 068: Agent Task 스케줄 실행 이력 (Phase 6-2)
--
-- 스케줄 tick 이 발화할 때마다 1행 기록 — "언제 돌았고 어떤 task 가 만들어졌고 성공/실패였나"를
-- 스케줄 단위로 추적한다(기존엔 last_task_id 1개만 남아 이력 소실). 실패 시 web push 알림과 페어.
-- 멱등(IF NOT EXISTS). 수동 적용(cli.ts migrate).

CREATE TABLE IF NOT EXISTS agent_task_schedule_runs (
    id SERIAL PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    user_id TEXT,
    -- 발화가 만든 task (생성 실패 시 NULL + error 기록)
    task_id TEXT,
    -- fired: task 생성·큐 제출 성공 / error: 생성·제출 실패
    outcome TEXT NOT NULL CHECK (outcome IN ('fired', 'error')),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON agent_task_schedule_runs(schedule_id, created_at DESC);

COMMENT ON TABLE agent_task_schedule_runs IS '스케줄 발화 이력 — tick 1회 발화당 1행(fired/error).';
