-- 049: Agent Task 'paused' 상태 추가 (Manus화 Phase 1 / C1 — HITL 승인 게이트)
--
-- 도구 실행 승인 대기 중 task 를 'paused' 로 표시한다(ask_human / 전부-승인 정책).
-- 기존 status CHECK 제약을 교체. 멱등 — 재실행 안전(DROP IF EXISTS 후 재생성).
-- (수동 적용: cli.ts migrate)

ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_status_check
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled'));
