DROP INDEX IF EXISTS idx_agent_tasks_lease_until;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS lease_until;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS lease_owner;
