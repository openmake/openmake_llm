-- Migration 191 — 에이전트 작업의 마지막 진행 시각 (2026-10-22, W2 관측 R8)
--
-- 실행 중(running) 작업이 멈췄는지 알 수 있게 마지막 진행(턴·도구 결과·상태 갱신) 시각을 남긴다.
-- 서버는 진행을 메모리에 모았다가 주기적으로(AGENT_TASK_PROGRESS_FLUSH_MS) 이 열에 쓰고, watchdog 이 오래 멈춘 running 을 찾는다.
-- 코드: apps/api/src/services/agent-task/progress-tracker.ts, apps/api/src/data/repositories/agent-task-progress-repository.ts
--
-- additive 만 — 열·부분 인덱스 추가. 멱등(IF NOT EXISTS). 코드만 되돌려도 동작한다(이전 코드는 이 열을 읽지 않는다).
-- 되돌리기: rollbacks/191_agent_task_progress_at_rollback.sql

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

COMMENT ON COLUMN agent_tasks.last_progress_at IS
    '마지막 진행(턴·도구 결과·상태 갱신) 시각 — watchdog(R8, 2026-10-22) 이 멈춘 running 을 판정';

CREATE INDEX IF NOT EXISTS idx_agent_tasks_running_progress ON agent_tasks (last_progress_at) WHERE status = 'running';
