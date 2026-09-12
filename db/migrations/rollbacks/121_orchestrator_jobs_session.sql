-- Rollback 121
DROP INDEX IF EXISTS idx_orchestrator_jobs_user_session;
ALTER TABLE orchestrator_jobs DROP COLUMN IF EXISTS session_id;
