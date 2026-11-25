-- 206 되돌리기 — 코드 참조(approval_status)를 먼저 걷어낸 뒤 실행한다. pending 행은 승인 없이 활성이 되므로 먼저 정리할 것.
DROP INDEX IF EXISTS idx_user_agents_pending;
ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS user_agents_approval_status_check;
ALTER TABLE user_agents DROP COLUMN IF EXISTS approval_status;
