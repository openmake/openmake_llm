ALTER TABLE agent_tasks DROP COLUMN IF EXISTS forked_from_task_id, DROP COLUMN IF EXISTS forked_from_turn;
DROP TABLE IF EXISTS agent_task_checkpoints;
