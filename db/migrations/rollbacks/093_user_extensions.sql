-- Rollback 093 — user_extensions 제거
--
-- ⚠️ 애플리케이션 코드 참조 제거 후 실행할 것 (2단계 배포 원칙).

ALTER TABLE agent_skills DROP CONSTRAINT IF EXISTS fk_agent_skills_extension;
ALTER TABLE agent_skills DROP COLUMN IF EXISTS extension_id;

ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS fk_mcp_servers_extension;
ALTER TABLE mcp_servers DROP COLUMN IF EXISTS extension_id;

DROP TABLE IF EXISTS user_extensions;
