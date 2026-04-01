/**
<<<<<<< HEAD
 * Legacy Schema SQL - Fallback schema for packaged/deployed environments
=======
 * LEGACY_SCHEMA - 폴백용 인라인 스키마 SQL
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
 *
 * Source of truth policy:
 * 1) services/database/init/002-schema.sql is canonical for schema evolution.
 * 2) LEGACY_SCHEMA is fallback-only for packaged/deployed environments where file access fails.
 * 3) Keep LEGACY_SCHEMA aligned with core CREATE TABLE definitions and essential lookup indexes.
 *
 * @module data/models/legacy-schema
 */

export const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
    tier TEXT DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    anon_session_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    agent_id TEXT,
    thinking TEXT,
    tokens INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    api_key_id TEXT,
    requests INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    avg_response_time REAL DEFAULT 0,
    models JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, api_key_id)
);

-- [P3 LEGACY] push_subscriptions: 레거시 테이블. 활성 푸시 구독은 push_subscriptions_store 사용. 사용자 삭제 시 cleanup용 DELETE만 존재.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_blacklist (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL,
    created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
<<<<<<< HEAD
=======
CREATE INDEX IF NOT EXISTS idx_messages_agent ON conversation_messages(agent_id);
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_date ON api_usage(date);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON conversation_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_anon ON conversation_sessions(anon_session_id) WHERE anon_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at);

CREATE TABLE IF NOT EXISTS chat_rate_limits (
    id SERIAL PRIMARY KEY,
    user_key TEXT NOT NULL UNIQUE,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_rate_limits_user_key ON chat_rate_limits(user_key);
CREATE INDEX IF NOT EXISTS idx_chat_rate_limits_reset_at ON chat_rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS agent_metrics (
    agent_type TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_response_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_response_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions_store (
    user_key TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_key_failures (
    key_index INTEGER PRIMARY KEY,
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_fail_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uploaded_documents (
    doc_id TEXT PRIMARY KEY,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_expires ON uploaded_documents(expires_at);

-- [P3 UNUSED] token_daily_stats: 미사용 테이블. ApiUsageTracker가 현재 인메모리 전용으로 동작. 미래 DB 용 write-through 시 활성화 예정.
CREATE TABLE IF NOT EXISTS token_daily_stats (
    date_key TEXT PRIMARY KEY,
    total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON conversation_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON conversation_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON conversation_messages(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_feedback (
    id SERIAL PRIMARY KEY,
<<<<<<< HEAD
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT,
=======
    message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
    signal TEXT NOT NULL CHECK (signal IN ('thumbs_up', 'thumbs_down', 'regenerate')),
    routing_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON message_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_signal ON message_feedback(signal);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON message_feedback(created_at);

CREATE TABLE IF NOT EXISTS agent_usage_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    session_id TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
    agent_id TEXT NOT NULL,
    query TEXT,
    response_preview TEXT,
    response_time_ms INTEGER,
    tokens_used INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

<<<<<<< HEAD
CREATE TABLE IF NOT EXISTS agent_feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    query TEXT,
    response TEXT,
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

=======
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
CREATE TABLE IF NOT EXISTS custom_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    keywords JSONB,
    category TEXT,
    emoji TEXT DEFAULT '\uD83E\uDD16',
    temperature REAL,
    max_tokens INTEGER,
    created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

<<<<<<< HEAD
=======
-- custom_agents 이후에 정의하여 FK 참조 가능
CREATE TABLE IF NOT EXISTS agent_feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    query TEXT,
    response TEXT,
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    action TEXT NOT NULL,
    user_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT
);

CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    data JSONB,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK(category IN ('preference', 'fact', 'project', 'relationship', 'skill', 'context')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    source_session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(user_id, category, key)
);

CREATE TABLE IF NOT EXISTS memory_tags (
    id SERIAL PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES user_memories(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    UNIQUE(memory_id, tag)
);

CREATE TABLE IF NOT EXISTS research_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    depth TEXT DEFAULT 'standard' CHECK(depth IN ('quick', 'standard', 'deep')),
    progress INTEGER DEFAULT 0,
    summary TEXT,
    key_findings JSONB,
    sources JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS research_steps (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    query TEXT,
    result TEXT,
    sources JSONB,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL CHECK(service_type IN ('google_drive', 'notion', 'github', 'slack', 'dropbox')),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    account_email TEXT,
    account_name TEXT,
    metadata JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, service_type)
);

CREATE TABLE IF NOT EXISTS external_files (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES external_connections(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    web_url TEXT,
    last_synced TIMESTAMPTZ,
    cached_content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(connection_id, external_id)
);

<<<<<<< HEAD
-- [P3 UNUSED] vector_embeddings: 미사용 테이블. 현재 TS 코드에서 미사용. pgvector 기반 단어 검색 구현 시 활성화 예정. embedding TEXT 폴백 버전.
CREATE TABLE IF NOT EXISTS vector_embeddings (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL CHECK(source_type IN ('document', 'memory', 'conversation', 'agent')),
    source_id TEXT NOT NULL,
    chunk_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

=======
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport_type TEXT NOT NULL CHECK(transport_type IN ('stdio', 'sse', 'streamable-http')),
    command TEXT,
    args JSONB,
    env JSONB,
    url TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL DEFAULT 'omk_live_',
    last_4 TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    scopes JSONB DEFAULT '["*"]',
    allowed_models JSONB DEFAULT '["*"]',
    rate_limit_tier TEXT NOT NULL DEFAULT 'free' CHECK(rate_limit_tier IN ('free', 'starter', 'standard', 'enterprise')),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    total_requests INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    is_public BOOLEAN DEFAULT FALSE,
    created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    source_repo TEXT,
    source_path TEXT
);

CREATE TABLE IF NOT EXISTS agent_skill_assignments (
    agent_id TEXT NOT NULL,
    skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_time ON agent_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON agent_feedback(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON user_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON user_memories(user_id, category);
CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);

CREATE INDEX IF NOT EXISTS idx_research_user ON research_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_sessions(status);
CREATE INDEX IF NOT EXISTS idx_research_steps_session ON research_steps(session_id);

CREATE INDEX IF NOT EXISTS idx_connections_user ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_service ON external_connections(service_type);
CREATE INDEX IF NOT EXISTS idx_ext_files_connection ON external_files(connection_id);
<<<<<<< HEAD

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON vector_embeddings(source_type, source_id);
=======
-- P2-5: external_files 정렬 인덱스 (created_at DESC — 파일 목록 조회 시 정렬 성능)
CREATE INDEX IF NOT EXISTS idx_ext_files_created ON external_files(connection_id, created_at DESC);
-- P2-6: user_memories LIKE 풀스캔 대응 — pg_trgm GIN 인덱스 (LIKE '%keyword%' 인덱스 사용 가능)
-- pg_trgm 미설치 환경 graceful 처리: Migration 011에서 조건부 생성
CREATE INDEX IF NOT EXISTS idx_memories_user_importance ON user_memories(user_id, importance DESC, updated_at DESC);
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78

CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON user_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON user_api_keys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON user_api_keys(rate_limit_tier);

CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);

CREATE INDEX IF NOT EXISTS idx_agent_skills_created_by ON agent_skills(created_by);
CREATE INDEX IF NOT EXISTS idx_agent_skills_category ON agent_skills(category);
CREATE INDEX IF NOT EXISTS idx_agent_skills_public ON agent_skills(is_public);
CREATE INDEX IF NOT EXISTS idx_skill_assignments_agent ON agent_skill_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_assignments_skill ON agent_skill_assignments(skill_id);
`;
