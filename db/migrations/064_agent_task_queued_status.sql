-- 064: Agent Task 'queued' 상태 추가 (Phase 3-B — 동시성 큐)
--
-- 동시 실행 상한(전역·유저별)을 초과해 대기열에 들어간 task 를 'queued' 로 표시한다.
-- 슬롯이 비면 러너가 dequeue 하고 execute() 가 'running' 으로 전이한다.
-- 기존 status CHECK 제약을 교체. 멱등 — 재실행 안전(DROP IF EXISTS 후 재생성).
-- (수동 적용: cli.ts migrate)

ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_status_check
    CHECK (status IN ('pending', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'));
