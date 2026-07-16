-- Migration 033 — user_agents 테이블
--
-- 사용자별 Custom Agent (claude.ai Projects / ChatGPT Custom GPTs 동등).
-- 사용자가 직접 system prompt + tools + skills 묶음을 정의하고 재사용.
--
-- 도입 배경 (2026-05-26): mainstream gap closure Phase 2.
-- 운영자 정의 산업 agent (18 카테고리 / 100 agent) 와 별도 — 사용자별 영구 보관 + 본인 전용.

CREATE TABLE IF NOT EXISTS user_agents (
    id             TEXT PRIMARY KEY,                       -- nanoid
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    description    TEXT,
    system_prompt  TEXT NOT NULL,
    allowed_tools  JSONB NOT NULL DEFAULT '[]'::jsonb,    -- MCP tool name 배열
    allowed_skills JSONB NOT NULL DEFAULT '[]'::jsonb,    -- skill manifest id 배열
    icon           TEXT,                                    -- emoji 1자 (예: 🎨)
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    usage_count    INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_agents_user_active
    ON user_agents(user_id, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_agents_user_updated
    ON user_agents(user_id, updated_at DESC);

COMMENT ON TABLE user_agents IS
    '사용자별 Custom Agent (claude.ai Projects / ChatGPT Custom GPTs 동등). 본인 전용 system prompt + tools + skills 묶음.';
COMMENT ON COLUMN user_agents.system_prompt IS '에이전트 페르소나 + 지시문. 매 chat 요청 시 system prompt 앞에 prepend.';
COMMENT ON COLUMN user_agents.allowed_tools IS 'MCP tool name 화이트리스트 (JSON 배열). 빈 배열 = 기본 도구만.';
COMMENT ON COLUMN user_agents.allowed_skills IS 'skill_manifests id 배열. 에이전트 활성 시 자동 바인딩.';
