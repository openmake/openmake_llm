-- 128: 조직 공유 범위 (F22 Phase B-1, 2026-09-17)
--
-- 127 의 organizations 를 "월 예산" 축에서 공유 범위 축으로 확장하는 첫 조각. 소유권(user_id)은
-- 그대로 두고, 조직 멤버가 **읽기·사용**할 수 있는 자원에 org_id 를 붙인다.
--   - user_agents: 080 의 visibility 축에 'organization' 값 추가 + org_id(대상 조직). 'shared'(인스턴스 전원)는 유지.
--   - agent_task_templates: org_id 만(NULL = 개인, 값 = 그 조직 멤버 읽기·instantiate 가능).
-- 편집·삭제는 여전히 소유자·관리자 한정(security/authorize DEFAULT 정책: write 는 org admin 이상, delete 는 org owner).
-- mcp_servers 는 암호화 env(자격증명)가 서버 행에 붙어 있어 조직 공유 시 키가 공유된다 — 이번 범위에서 제외.
-- 멱등.

ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS user_agents_visibility_chk;
ALTER TABLE user_agents ADD CONSTRAINT user_agents_visibility_chk
    CHECK (visibility IN ('private', 'shared', 'organization'));
CREATE INDEX IF NOT EXISTS idx_user_agents_org
    ON user_agents (org_id) WHERE org_id IS NOT NULL AND visibility = 'organization';
COMMENT ON COLUMN user_agents.visibility IS
    'private(기본, 소유자 전용) | shared(워크스페이스 전원 사용) | organization(org_id 조직 멤버 사용). 편집/삭제는 소유자 한정 (080·128).';
COMMENT ON COLUMN user_agents.org_id IS 'visibility=organization 일 때 대상 조직. 조직 삭제 시 NULL (128)';

ALTER TABLE agent_task_templates ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_task_templates_org
    ON agent_task_templates (org_id) WHERE org_id IS NOT NULL;
COMMENT ON COLUMN agent_task_templates.org_id IS 'NULL=개인, 값=그 조직 멤버가 읽기·instantiate 가능. 편집·삭제는 소유자 (128)';
