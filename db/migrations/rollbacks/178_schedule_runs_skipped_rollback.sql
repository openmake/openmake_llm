-- 178 되돌리기: 'skipped' 행을 지우고 제약을 종전으로.
DELETE FROM agent_task_schedule_runs WHERE outcome = 'skipped';
ALTER TABLE agent_task_schedule_runs DROP CONSTRAINT IF EXISTS agent_task_schedule_runs_outcome_check;
ALTER TABLE agent_task_schedule_runs
    ADD CONSTRAINT agent_task_schedule_runs_outcome_check CHECK (outcome IN ('fired', 'error'));
