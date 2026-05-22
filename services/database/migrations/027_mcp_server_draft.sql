-- ============================================================
-- 027_mcp_server_draft.sql — mcp_servers 에 status + manifest_meta 추가
-- ============================================================
-- 목적: Phase 4 (MCP server ingest) 의 draft 워크플로 지원
-- 기존 row 호환: status DEFAULT 'active', manifest_meta NULL
-- 멱등 ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--
-- 보안 모델:
--   - draft row 는 enabled=false 강제 (서비스 레이어에서 강제)
--   - draft row 는 visibility='user_private' 강제 (서비스 레이어에서 강제)
--   - status='draft' 인 row 는 LifecycleSupervisor / ToolRouter 가 무시
-- ============================================================

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS manifest_meta JSONB;

-- draft 조회 가속 (사용자별 draft 목록)
CREATE INDEX IF NOT EXISTS idx_mcp_servers_draft_user
  ON mcp_servers (user_id, created_at DESC)
  WHERE status = 'draft';

-- source='git-url' 의 dedupe 조회 가속 (manifest_meta->>'promptHash' 룩업)
CREATE INDEX IF NOT EXISTS idx_mcp_servers_git_source_hash
  ON mcp_servers ((manifest_meta->>'promptHash'))
  WHERE status = 'draft' AND manifest_meta->>'source' = 'git-url';

COMMENT ON COLUMN mcp_servers.status IS 'draft = 사용자 검토 대기 (enabled=false 강제) / active = 활성 (enabled 별도) / archived = 비공개 보관';
COMMENT ON COLUMN mcp_servers.manifest_meta IS 'Git URL 출처 메타 (source, gitUrl, gitRef, gitPath, conventionFindings, promptHash 등). 직접 등록 시 NULL.';
