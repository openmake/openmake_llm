-- ============================================
-- OpenMake.Ai - Database Schema
-- Migrated from SQLite to PostgreSQL + pgvector
-- ============================================

-- 사용자 테이블
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

-- 대화 세션 테이블
CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    anon_session_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- 대화 메시지 테이블
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

-- API 사용량 테이블
CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
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

-- 에이전트 사용 로그 테이블
CREATE TABLE IF NOT EXISTS agent_usage_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id TEXT REFERENCES users(id),
    session_id TEXT REFERENCES conversation_sessions(id),
    agent_id TEXT NOT NULL,
    query TEXT,
    response_preview TEXT,
    response_time_ms INTEGER,
    tokens_used INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

-- 에이전트 피드백 테이블
CREATE TABLE IF NOT EXISTS agent_feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    query TEXT,
    response TEXT,
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 커스텀 에이전트 테이블
CREATE TABLE IF NOT EXISTS custom_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    keywords JSONB,
    category TEXT,
    emoji TEXT DEFAULT '🤖',
    temperature REAL,
    max_tokens INTEGER,
    created_by TEXT REFERENCES users(id),
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 시스템 감사 로그 테이블
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

-- 알림 히스토리 테이블
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

-- ============================================
-- 장기 메모리 시스템 테이블
-- ============================================

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

-- ============================================
-- Deep Research 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS research_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
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

-- ============================================
-- 마켓플레이스 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS agent_marketplace (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES custom_agents(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT,
    long_description TEXT,
    category TEXT,
    tags JSONB,
    icon TEXT DEFAULT '🤖',
    price REAL DEFAULT 0,
    is_free BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    downloads INTEGER DEFAULT 0,
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    version TEXT DEFAULT '1.0.0',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_reviews (
    id TEXT PRIMARY KEY,
    marketplace_id TEXT NOT NULL REFERENCES agent_marketplace(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    title TEXT,
    content TEXT,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(marketplace_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_installations (
    id SERIAL PRIMARY KEY,
    marketplace_id TEXT NOT NULL REFERENCES agent_marketplace(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(marketplace_id, user_id)
);

-- ============================================
-- Canvas 협업 도구 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS canvas_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    session_id TEXT REFERENCES conversation_sessions(id),
    title TEXT NOT NULL,
    doc_type TEXT DEFAULT 'document' CHECK(doc_type IN ('document', 'code', 'diagram', 'table')),
    content TEXT,
    language TEXT,
    version INTEGER DEFAULT 1,
    is_shared BOOLEAN DEFAULT FALSE,
    share_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canvas_versions (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    change_summary TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 외부 서비스 통합 테이블
-- ============================================

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

-- ============================================
-- pgvector 벡터 임베딩 테이블 (NEW)
-- pgvector 확장 미설치 시 embedding 컬럼을 TEXT로 대체
-- ============================================

DO $$ BEGIN
    -- 테이블이 이미 존재하면 생성 건너뛰기 (vector 타입 해석 시 .so 로딩 오류 방지)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vector_embeddings') THEN
        RAISE NOTICE '[pgvector] vector_embeddings 테이블 이미 존재 — 생성 건너뜀';
    ELSE
        -- 새로 생성: pgvector 확장 로드 시도 후 폴백
        BEGIN
            EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
            EXECUTE '
                CREATE TABLE vector_embeddings (
                    id SERIAL PRIMARY KEY,
                    source_type TEXT NOT NULL CHECK(source_type IN (''document'', ''memory'', ''conversation'', ''agent'')),
                    source_id TEXT NOT NULL,
                    chunk_index INTEGER DEFAULT 0,
                    chunk_text TEXT NOT NULL,
                    embedding vector(768),
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )';
            RAISE NOTICE '[pgvector] 확장 로드 완료 — vector(768) 컬럼 사용';
        EXCEPTION WHEN OTHERS THEN
            CREATE TABLE vector_embeddings (
                id SERIAL PRIMARY KEY,
                source_type TEXT NOT NULL CHECK(source_type IN ('document', 'memory', 'conversation', 'agent')),
                source_id TEXT NOT NULL,
                chunk_index INTEGER DEFAULT 0,
                chunk_text TEXT NOT NULL,
                embedding TEXT,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            RAISE NOTICE '[pgvector] 확장 미설치 — embedding을 TEXT 컬럼으로 대체 (벡터 검색 비활성)';
        END;
    END IF;
END $$;

-- ============================================
-- Push 구독 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 인덱스
-- ============================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_date ON api_usage(date);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_time ON agent_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON agent_feedback(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON conversation_sessions(user_id);

-- Memory indexes
CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON user_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);

-- Research indexes
CREATE INDEX IF NOT EXISTS idx_research_user ON research_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_sessions(status);
CREATE INDEX IF NOT EXISTS idx_research_steps_session ON research_steps(session_id);

-- Marketplace indexes
CREATE INDEX IF NOT EXISTS idx_marketplace_category ON agent_marketplace(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_downloads ON agent_marketplace(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_status ON agent_marketplace(status);
CREATE INDEX IF NOT EXISTS idx_reviews_marketplace ON agent_reviews(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_installations_user ON agent_installations(user_id);

-- Canvas indexes
CREATE INDEX IF NOT EXISTS idx_canvas_user ON canvas_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_canvas_versions_doc ON canvas_versions(document_id);

-- External indexes
CREATE INDEX IF NOT EXISTS idx_connections_user ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_service ON external_connections(service_type);
CREATE INDEX IF NOT EXISTS idx_ext_files_connection ON external_files(connection_id);

-- Vector indexes (pgvector 확장 필요)
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON vector_embeddings(source_type, source_id);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        BEGIN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON vector_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
            RAISE NOTICE '[pgvector] ivfflat 인덱스 생성 완료';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '[pgvector] ivfflat 인덱스 생성 실패 (shared library 미설치) — 건너뜀';
        END;
    END IF;
END $$;

-- Full-text search indexes (pg_trgm 확장 필요)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON conversation_messages USING gin (content gin_trgm_ops)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_memories_value_trgm ON user_memories USING gin (value gin_trgm_ops)';
    ELSE
        RAISE NOTICE 'pg_trgm extension not installed — skipping trigram indexes. Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;';
    END IF;
END $$;

-- ============================================
-- 🔌 MCP 외부 서버 설정 테이블
-- ============================================

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

-- ============================================
-- 🔑 API Key 관리 테이블
-- ============================================

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

-- ============================================
-- 🔒 OAuth State 테이블 (CSRF 방어)
-- ============================================

CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 🔒 Token Blacklist 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS token_blacklist (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL,
    created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

-- ============================================
-- 추가 인덱스 (코드에서 동적 생성되던 것들)
-- ============================================

-- MCP indexes
CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

-- API Key indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON user_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON user_api_keys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON user_api_keys(rate_limit_tier);

-- Session & Audit indexes (from unified-database.ts)
CREATE INDEX IF NOT EXISTS idx_sessions_anon ON conversation_sessions(anon_session_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- OAuth state index (cleanup query)
CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);

-- Token blacklist index
CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at);

-- ============================================
-- 채팅 레이트 리밋 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS chat_rate_limits (
    id SERIAL PRIMARY KEY,
    user_key TEXT NOT NULL UNIQUE,    -- userId or IP
    count INTEGER NOT NULL DEFAULT 0,
    reset_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_rate_limits_user_key ON chat_rate_limits(user_key);
CREATE INDEX IF NOT EXISTS idx_chat_rate_limits_reset_at ON chat_rate_limits(reset_at);

-- ============================================
-- 에이전트 성능 메트릭 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS agent_metrics (
    agent_type TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_response_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_response_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Push 구독 저장소 테이블 (인메모리 캐시 + DB 영속화)
-- ============================================

CREATE TABLE IF NOT EXISTS push_subscriptions_store (
    user_key TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- API Key 실패 추적 테이블 (인메모리 캐시 + DB 영속화)
-- ============================================

CREATE TABLE IF NOT EXISTS api_key_failures (
    key_index INTEGER PRIMARY KEY,
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_fail_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 📄 업로드 문서 저장소 테이블 (write-through cache)
-- ============================================

CREATE TABLE IF NOT EXISTS uploaded_documents (
    doc_id TEXT PRIMARY KEY,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_expires ON uploaded_documents(expires_at);

-- ============================================
-- 📊 토큰 일별 통계 테이블 (write-through cache)
-- ============================================

CREATE TABLE IF NOT EXISTS token_daily_stats (
    date_key TEXT PRIMARY KEY,              -- YYYY-MM-DD
    total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 성능 최적화 인덱스 (Phase 2-DBA)
-- ============================================

-- Critical single-column indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_canvas_share_token ON canvas_documents(share_token);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON conversation_sessions(updated_at);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON conversation_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON conversation_messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON user_memories(user_id, category);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_user_updated ON canvas_documents(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_user_created ON research_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_steps_session_number ON research_steps(session_id, step_number);
CREATE INDEX IF NOT EXISTS idx_connections_user_service ON external_connections(user_id, service_type);
