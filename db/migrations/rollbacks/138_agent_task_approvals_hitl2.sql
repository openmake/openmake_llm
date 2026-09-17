DROP TABLE IF EXISTS agent_task_approval_events;
UPDATE agent_task_approvals SET status = 'aborted' WHERE status = 'revoked';
ALTER TABLE agent_task_approvals DROP CONSTRAINT IF EXISTS agent_task_approvals_status_check;
ALTER TABLE agent_task_approvals ADD CONSTRAINT agent_task_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'aborted'));
DROP INDEX IF EXISTS idx_agent_task_approvals_assignee_pending;
DROP INDEX IF EXISTS idx_agent_task_approvals_recent;
ALTER TABLE agent_task_approvals DROP COLUMN IF EXISTS preview, DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS assignee_user_id, DROP COLUMN IF EXISTS escalated_at, DROP COLUMN IF EXISTS escalation_reason;
