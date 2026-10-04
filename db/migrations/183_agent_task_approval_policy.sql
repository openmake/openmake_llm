-- 183: 에이전트 작업의 승인 정책 보존 — 주차에서 재개된 작업이 처음의 정책을 잃지 않게 한다
--
-- 승인 정책('all' | 'high-risk' | 'none')은 시작 요청에만 실려 오고 행에는 남지 않았다. 승인 대기·기기 대기로
-- 주차됐다가 재개되는 경로는 행만으로 실행 입력을 다시 만들기 때문에, 로컬 실행 작업은 기본값 'all' 로 돌아가
-- 처음에 묻지 않기로 한 호출까지 다시 물었다. NULL 은 "지정 없음"(실행기 기본값) — 기존 행은 그대로 둔다.
-- 멱등(ADD COLUMN IF NOT EXISTS). 되돌리기: rollbacks/183_agent_task_approval_policy_rollback.sql

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS approval_policy TEXT;

COMMENT ON COLUMN agent_tasks.approval_policy IS '시작 요청의 승인 정책(all|high-risk|none) — 주차 재개 때 복원. NULL 은 지정 없음.';
