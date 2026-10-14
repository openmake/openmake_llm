-- 188 되돌리기 — 체인 열 제거. 체인으로 만들어진 후속 작업 행은 남는다(일반 작업으로 보인다).
-- continued_by_task_id 는 FK 없이 만든 열이라(선점이 후속 INSERT 보다 먼저) 열 제거만으로 충분하다.
DROP INDEX IF EXISTS idx_agent_tasks_chain_root;
ALTER TABLE agent_tasks
    DROP COLUMN IF EXISTS continuation,
    DROP COLUMN IF EXISTS long_running,
    DROP COLUMN IF EXISTS continued_by_task_id,
    DROP COLUMN IF EXISTS continued_from_task_id,
    DROP COLUMN IF EXISTS chain_root_task_id;
