DROP INDEX IF EXISTS idx_agent_tasks_terminal_notify_pending;
DROP INDEX IF EXISTS idx_agent_tasks_user_create_key;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS create_idempotency_key;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS terminal_notify_pending;
