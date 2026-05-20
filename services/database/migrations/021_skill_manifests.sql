-- ============================================================
-- 021_skill_manifests.sql — Skill manifest 5-table 격상
-- ============================================================
--
-- 기존 agent_skills (id, name, description, content, ...) 단일 컬럼 모델을
-- Anthropic Skills 동형의 versioned manifest 모델로 격상한다.
--
-- 추가되는 5 테이블:
--   skill_manifests       — id+version PK, manifest_yaml + prompt_md + checksum + signature
--   skill_tool_bindings   — manifest 별 MCP 도구 바인딩 (required/allowed/denied)
--   skill_mcp_bundles     — manifest 와 함께 spawn 되는 MCP 서버 lifecycle 정의
--   skill_permissions     — 사용자별 명시 grant + scopes + revoked_at
--   skill_audit_log       — 도구 호출 감사 로그 (보안팀 사후 검증)
--
-- 무영향 마이그레이션:
--   - 기존 agent_skills 는 그대로 유지 (legacy fallback)
--   - 022_seed_manifests_from_legacy.sql 가 기존 100 system skill 을
--     skill_manifests v1.0.0 으로 복사 (binding 비어 있어 동작 동일)
--   - system-prompt.ts 가 manifest 우선, legacy fallback 으로 조회
--
-- 참조: docs/superpowers/plans/2026-05-20-openmake-llm-skill-mcp-redesign.md §4
-- ============================================================

CREATE TABLE IF NOT EXISTS skill_manifests (
    id            TEXT NOT NULL,
    version       TEXT NOT NULL,
    manifest_yaml TEXT NOT NULL,
    prompt_md     TEXT NOT NULL,
    examples_md   TEXT,
    checksum      TEXT NOT NULL,
    signature     TEXT,
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    is_public     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS idx_skill_manifests_created_by ON skill_manifests (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_manifests_public ON skill_manifests (is_public) WHERE is_public IS TRUE;

CREATE TABLE IF NOT EXISTS skill_tool_bindings (
    skill_id         TEXT NOT NULL,
    skill_version    TEXT NOT NULL,
    tool_name        TEXT NOT NULL,
    binding_mode     TEXT NOT NULL CHECK (binding_mode IN ('required','allowed','denied')),
    args_schema_json JSONB,
    PRIMARY KEY (skill_id, skill_version, tool_name),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_manifests(id, version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skill_mcp_bundles (
    id                 BIGSERIAL PRIMARY KEY,
    skill_id           TEXT NOT NULL,
    skill_version      TEXT NOT NULL,
    server_name        TEXT NOT NULL,
    server_config_json JSONB NOT NULL,
    lifecycle          TEXT NOT NULL CHECK (lifecycle IN ('per_chat','per_session','long_lived')),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_manifests(id, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_mcp_bundles_skill ON skill_mcp_bundles (skill_id, skill_version);

CREATE TABLE IF NOT EXISTS skill_permissions (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id      TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    scopes        TEXT[] NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ,
    PRIMARY KEY (user_id, skill_id, skill_version),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_manifests(id, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_permissions_active ON skill_permissions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS skill_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    skill_id      TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    tool_called   TEXT NOT NULL,
    args_hash     TEXT NOT NULL,
    result_status TEXT NOT NULL CHECK (result_status IN ('ok','error','denied')),
    duration_ms   INT,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_audit_user_ts ON skill_audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_skill_audit_skill_ts ON skill_audit_log (skill_id, ts DESC);

COMMENT ON TABLE skill_manifests IS 'Versioned skill manifest with sha256 checksum + optional signature. Replaces agent_skills (legacy retained for fallback).';
COMMENT ON TABLE skill_tool_bindings IS 'Per-skill MCP tool whitelist/blacklist. UNION-merged with PipelineProfile.requiredTools at chat time.';
COMMENT ON TABLE skill_mcp_bundles IS 'MCP server configs bundled with a skill. Spawned by lifecycle-supervisor (per_chat/per_session/long_lived).';
COMMENT ON TABLE skill_permissions IS 'Explicit user grant required for skill activation. System skills (created_by NULL) are implicitly granted to all.';
COMMENT ON TABLE skill_audit_log IS 'Tool-call audit trail for security review. args_hash = sha256(args_json) to avoid storing sensitive raw args.';
