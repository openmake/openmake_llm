-- Rollback 128 — 2단계 규칙: 코드 참조 제거 배포 후 실행.
UPDATE user_agents SET visibility = 'private' WHERE visibility = 'organization';
ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS user_agents_visibility_chk;
ALTER TABLE user_agents ADD CONSTRAINT user_agents_visibility_chk CHECK (visibility IN ('private', 'shared'));
DROP INDEX IF EXISTS idx_user_agents_org;
ALTER TABLE user_agents DROP COLUMN IF EXISTS org_id;
DROP INDEX IF EXISTS idx_agent_task_templates_org;
ALTER TABLE agent_task_templates DROP COLUMN IF EXISTS org_id;
