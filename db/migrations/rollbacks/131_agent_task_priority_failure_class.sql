-- 131 롤백 — 코드 참조 제거 배포 후 실행(2단계)
DROP INDEX IF EXISTS idx_agent_tasks_failed_class;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS failure_class;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS priority;
