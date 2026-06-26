-- 050: Agent Task 실행 계획 스냅샷 (Manus화 G5 — 라이브 패널)
--
-- G3 플래닝 레이어의 현재 plan(step 상태)을 영속해 task 상세 UI 가 구조적으로 렌더.
-- plan_create/plan_update tool_result 텍스트와 별개로, 최신 구조 스냅샷을 1행에 보관.
-- 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS plan JSONB;

COMMENT ON COLUMN agent_tasks.plan IS 'G3 TaskPlan 최신 스냅샷([{text,status,note}]). 라이브 패널 렌더용.';
