-- ============================================================
-- 023_mcp_user_isolation.sql — MCP 사용자 격리 + 카탈로그 + lifecycle 추적
-- ============================================================
--
-- 기존 mcp_servers (admin 전역 등록만 가능) 를 사용자별 등록 가능 모델로 확장.
--
-- 변경:
--   1) mcp_servers ALTER — user_id, visibility, catalog_template_id, auto_spawn 컬럼 추가
--      기존 데이터는 visibility='global', user_id=NULL 으로 자동 분류 (DEFAULT)
--   2) mcp_servers.name UNIQUE → (user_id, name) 복합 unique 로 변경
--      - global (user_id NULL) 인 경우엔 단일 unique 유지 (partial index)
--      - user 등록인 경우 사용자별 unique (partial index)
--   3) 신규 테이블 mcp_server_catalog — admin 화이트리스트 (사용자가 선택할 템플릿)
--   4) 신규 테이블 mcp_server_instances — 인스턴스 lifecycle 상태 추적 (Phase 7 가 사용)
--   5) 카탈로그 시드 — mcp-filesystem (free), mcp-github (pro)
--
-- 안전성:
--   - ADD COLUMN IF NOT EXISTS — 멱등
--   - CREATE TABLE IF NOT EXISTS — 멱등
--   - UNIQUE 제약 교체: DROP CONSTRAINT IF EXISTS → CREATE UNIQUE INDEX (partial)
--   - 카탈로그 시드: ON CONFLICT (id) DO NOTHING
--
-- 참조: docs/superpowers/plans/2026-05-20-phase6-mcp-user-isolation.md §4
-- ============================================================

-- 1) mcp_servers 컬럼 확장
ALTER TABLE mcp_servers
    ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'global'
        CHECK (visibility IN ('global','user_private','user_shared')),
    ADD COLUMN IF NOT EXISTS catalog_template_id TEXT,
    ADD COLUMN IF NOT EXISTS auto_spawn BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) name unique 제약 교체: (user_id, name) partial unique
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    INNER JOIN pg_class cls ON con.conrelid = cls.oid
    WHERE cls.relname = 'mcp_servers'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND EXISTS (
          SELECT 1 FROM pg_attribute att
          WHERE att.attrelid = cls.oid
            AND att.attnum = ANY(con.conkey)
            AND att.attname = 'name'
      )
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE mcp_servers DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mcp_servers_global_name
    ON mcp_servers (name) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mcp_servers_user_name
    ON mcp_servers (user_id, name) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_visibility
    ON mcp_servers (user_id, visibility);

-- 3) 카탈로그 (admin 화이트리스트)
CREATE TABLE IF NOT EXISTS mcp_server_catalog (
    id               TEXT PRIMARY KEY,
    display_name     TEXT NOT NULL,
    description      TEXT,
    transport_type   TEXT NOT NULL CHECK (transport_type IN ('stdio','sse','streamable-http')),
    command_template TEXT,
    args_schema      JSONB NOT NULL DEFAULT '{}',
    env_schema       JSONB NOT NULL DEFAULT '{}',
    url_template     TEXT,
    required_tier    TEXT NOT NULL DEFAULT 'free'
        CHECK (required_tier IN ('free','starter','standard','pro','enterprise')),
    is_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_catalog_tier ON mcp_server_catalog (required_tier) WHERE is_enabled IS TRUE;

-- 4) 인스턴스 lifecycle 추적 (Phase 7 lifecycle-supervisor 가 채움)
CREATE TABLE IF NOT EXISTS mcp_server_instances (
    id            BIGSERIAL PRIMARY KEY,
    mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pid           INT,
    status        TEXT NOT NULL CHECK (status IN ('starting','running','stopped','crashed')),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at    TIMESTAMPTZ,
    last_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_instances_user_status ON mcp_server_instances (user_id, status);
CREATE INDEX IF NOT EXISTS idx_mcp_instances_server ON mcp_server_instances (mcp_server_id);

-- 5) 카탈로그 시드 — 최소 2건 (admin 이 후속 추가 가능)
INSERT INTO mcp_server_catalog (id, display_name, description, transport_type, command_template, args_schema, env_schema, required_tier) VALUES
    ('mcp-filesystem',
     'Filesystem (sandbox)',
     '사용자 sandbox 디렉토리 안에서 파일 읽기/쓰기. 경로는 사용자별로 자동 격리됩니다.',
     'stdio',
     'npx -y @modelcontextprotocol/server-filesystem',
     '{"type":"object","properties":{"root_path":{"type":"string","title":"루트 디렉토리","description":"사용자 sandbox 안의 상대경로"}},"required":["root_path"]}'::jsonb,
     '{}'::jsonb,
     'free'),
    ('mcp-github',
     'GitHub',
     'GitHub repo / issue / pull request 조회. 사용자의 GitHub Personal Access Token 이 필요합니다.',
     'stdio',
     'npx -y @modelcontextprotocol/server-github',
     '{}'::jsonb,
     '{"type":"object","properties":{"GITHUB_PERSONAL_ACCESS_TOKEN":{"type":"string","title":"GitHub PAT","description":"github.com/settings/tokens 에서 발급","secret":true}},"required":["GITHUB_PERSONAL_ACCESS_TOKEN"]}'::jsonb,
     'pro')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE mcp_server_catalog IS 'Admin-managed whitelist of MCP server templates. Users register via /api/mcp/servers/from-catalog only — no raw command input.';
COMMENT ON TABLE mcp_server_instances IS 'Lifecycle tracking of spawned MCP server processes. Populated by lifecycle-supervisor (Phase 7). status: starting | running | stopped | crashed.';
COMMENT ON COLUMN mcp_servers.visibility IS 'global = admin-registered, visible to all; user_private = owner only; user_shared = admin-approved sharing (future)';
COMMENT ON COLUMN mcp_servers.catalog_template_id IS 'When user_id IS NOT NULL, must reference mcp_server_catalog(id). NULL only for admin global servers.';
