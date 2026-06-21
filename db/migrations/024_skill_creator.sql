-- ============================================================
-- 024_skill_creator.sql — agent_skills 에 status + manifest_meta 추가
-- ============================================================
-- 목적: Skill Creator Phase 1 의 draft 워크플로 지원
-- 기존 row 호환: status DEFAULT 'active', manifest_meta NULL
-- 멱등 ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE agent_skills
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE agent_skills
  ADD COLUMN IF NOT EXISTS manifest_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_agent_skills_status_created_by
  ON agent_skills (status, created_by)
  WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_agent_skills_status
  ON agent_skills (status)
  WHERE status = 'active';
