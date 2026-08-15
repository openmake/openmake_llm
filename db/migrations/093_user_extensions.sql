-- Migration 093 — user_extensions (확장 번들 설치 레이어, Phase 1)
--
-- 2026-08-16. Agent Plugins v1 (plugin.json + skills/*/SKILL.md + mcp.json) 호환
-- 확장 번들을 git ingest 로 설치할 때, 구성요소(skill draft / mcp server draft)를
-- 하나의 설치 단위로 묶는 상위 레코드. 구성요소 자체는 기존 draft→approve
-- 라이프사이클을 그대로 따르고, 이 테이블은 목록/제거(번들 단위) 관리만 담당.
--
-- 소유: 사용자별 (user_id FK, users.id 는 TEXT). 확장 삭제 시 구성요소는
-- 서비스 레이어가 archive 처리하며 FK 는 ON DELETE SET NULL (링크만 해제).
--
-- 멱등 (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + DO/EXCEPTION 제약 가드).

CREATE TABLE IF NOT EXISTS user_extensions (
    id           TEXT PRIMARY KEY,                        -- 'user-ext-<uuid>'
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,                           -- plugin.json name (kebab-case)
    version      TEXT NOT NULL,                           -- plugin.json version
    description  TEXT,
    source_url   TEXT NOT NULL,                           -- git URL (원본)
    source_ref   TEXT NOT NULL,                           -- resolved commit SHA
    source_path  TEXT NOT NULL,                           -- plugin.json 의 tree 경로
    source_hash  TEXT NOT NULL,                           -- dedupe key: sha256(uid+url+sha+path)
    manifest     JSONB NOT NULL,                          -- plugin.json 원문 + 구성요소 설치 요약
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 같은 이름의 active 설치는 사용자당 1개 (제거 후 재설치 허용을 위해 partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_extensions_active_name
    ON user_extensions (user_id, name) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_extensions_user_created
    ON user_extensions (user_id, created_at DESC) WHERE status = 'active';

-- dedupe 조회 (findRecentByHash)
CREATE INDEX IF NOT EXISTS idx_user_extensions_source_hash
    ON user_extensions (source_hash);

COMMENT ON TABLE user_extensions IS
    '확장 번들 설치 레코드 (Agent Plugins v1 호환). 구성요소(agent_skills/mcp_servers)는 extension_id 로 링크되고 자체 draft→approve 라이프사이클 유지.';
COMMENT ON COLUMN user_extensions.manifest IS
    'plugin.json 원문(plugin) + 구성요소 설치 결과 요약(components). 조회 응답의 SoT.';

-- 구성요소 테이블 → 확장 링크 (nullable, 확장 삭제 시 링크만 해제)
ALTER TABLE agent_skills ADD COLUMN IF NOT EXISTS extension_id TEXT;
DO $$ BEGIN
    ALTER TABLE agent_skills ADD CONSTRAINT fk_agent_skills_extension
        FOREIGN KEY (extension_id) REFERENCES user_extensions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_agent_skills_extension
    ON agent_skills (extension_id) WHERE extension_id IS NOT NULL;

ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS extension_id TEXT;
DO $$ BEGIN
    ALTER TABLE mcp_servers ADD CONSTRAINT fk_mcp_servers_extension
        FOREIGN KEY (extension_id) REFERENCES user_extensions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_mcp_servers_extension
    ON mcp_servers (extension_id) WHERE extension_id IS NOT NULL;

COMMENT ON COLUMN agent_skills.extension_id IS '이 skill 을 설치한 확장 번들 (user_extensions.id). NULL = 단독 설치.';
COMMENT ON COLUMN mcp_servers.extension_id IS '이 서버를 설치한 확장 번들 (user_extensions.id). NULL = 단독 설치.';
