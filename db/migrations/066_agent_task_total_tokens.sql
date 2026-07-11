-- 066: Agent Task 누적 토큰 영속 (Phase 4-4 — 비용 가시화)
--
-- 실행 루프가 로그로만 남기던 누적 토큰(prompt+completion)을 terminal 전이 시 저장한다.
-- 목록/상세 UI 의 작업당 토큰 표시와 per-user 예산 연동에 사용. resume 은 이전 값에서 이어 누적.
-- 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS total_tokens INTEGER;

COMMENT ON COLUMN agent_tasks.total_tokens IS '누적 LLM 토큰(prompt+completion) — terminal 전이 시 기록, resume 은 통산.';
