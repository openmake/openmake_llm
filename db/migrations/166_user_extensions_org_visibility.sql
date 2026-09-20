-- Migration 166 — user_extensions 조직 공개 (S4 마찰 4: 매니페스트 scope=organization 이 무시되던 문제)
--
-- 2026-09-20. user_agents(128) 와 같은 축: visibility 에 'organization' 값 + org_id(대상 조직).
-- 소유권 하드 경계는 user_id 그대로다 — 조직 공개는 **그 조직 멤버의 갤러리에 보인다**는 뜻이고,
-- 설치는 종전처럼 멤버 각자의 계정으로 ingest 를 다시 돌린다(스킬·MCP 는 각자 승인).
-- 'shared'(인스턴스 전원)는 유지. 편집(visibility 변경)·삭제는 소유자 한정.

ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_visibility_chk;
ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_visibility_chk
    CHECK (visibility IN ('private', 'shared', 'organization'));

CREATE INDEX IF NOT EXISTS idx_user_extensions_org
    ON user_extensions (org_id) WHERE org_id IS NOT NULL AND visibility = 'organization' AND status = 'active';

COMMENT ON COLUMN user_extensions.visibility IS
    'private(기본, 소유자 전용) | shared(워크스페이스 갤러리 전원) | organization(org_id 조직 멤버의 갤러리). 변경·삭제는 소유자 한정 (095·166).';
COMMENT ON COLUMN user_extensions.org_id IS
    'visibility=organization 일 때 대상 조직. 조직 삭제 시 NULL — 그 행은 누구의 갤러리에도 나오지 않는다(사실상 비공개) (166)';
