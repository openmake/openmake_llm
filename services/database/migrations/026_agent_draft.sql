-- ============================================================
-- 026_agent_draft.sql — custom_agents 에 status + manifest_meta 추가
-- ============================================================
-- 목적: Phase 3 (Agent ingest) 의 draft 워크플로 지원
-- 기존 row 호환: status DEFAULT 'active', manifest_meta NULL
-- 멱등 ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE custom_agents
  ADD COLUMN IF NOT EXISTS manifest_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_custom_agents_status_created_by
  ON custom_agents (status, created_by)
  WHERE status = 'draft';
