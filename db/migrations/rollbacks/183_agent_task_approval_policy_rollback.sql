-- 183 되돌리기: 승인 정책 칸 제거.
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS approval_policy;
