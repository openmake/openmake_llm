-- ============================================
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
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
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

-- 에이전트 사용 로그 테이블
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

-- 에이전트 피드백 테이블
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
    created_by TEXT REFERENCES users(id) ON DELETE CASCADE,
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
-- pgvector는 필수 의존성 (미설치 시 예외 발생)
-- ============================================

DO $$ BEGIN
    -- 테이블이 이미 존재하면 생성 건너뛰기 (vector 타입 해석 시 .so 로딩 오류 방지)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vector_embeddings') THEN
        RAISE NOTICE '[pgvector] vector_embeddings 테이블 이미 존재 — 생성 건너뜀';
    ELSE
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
            EXECUTE '
                CREATE TABLE vector_embeddings (
                    id SERIAL PRIMARY KEY,
                    source_type TEXT NOT NULL CHECK(source_type IN (''document'', ''memory'', ''conversation'', ''agent'')),
                    source_id TEXT NOT NULL,
                    chunk_index INTEGER DEFAULT 0,
                    content TEXT NOT NULL,
                    embedding vector(768),
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )';
            RAISE NOTICE '[pgvector] 확장 확인 완료 — vector(768) 컬럼 사용';
        ELSE
            RAISE EXCEPTION '[pgvector] extension "vector" is required. Install pgvector first: CREATE EXTENSION IF NOT EXISTS vector;';
        END IF;
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

-- 사용자 메시지 피드백 테이블 (signal 기반 — thumbs_up / thumbs_down / regenerate)
CREATE TABLE IF NOT EXISTS message_feedback (
    id SERIAL PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT,
    signal TEXT NOT NULL CHECK (signal IN ('thumbs_up', 'thumbs_down', 'regenerate')),
    routing_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON message_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_signal  ON message_feedback(signal);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON message_feedback(created_at);

-- ============================================
-- 인덱스
-- ============================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON conversation_messages(agent_id);
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
        BEGIN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON conversation_messages USING gin (content gin_trgm_ops)';
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_memories_key_trgm ON user_memories USING gin (key gin_trgm_ops)';
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_memories_value_trgm ON user_memories USING gin (value gin_trgm_ops)';
            RAISE NOTICE '[pg_trgm] 트라이그램 인덱스 생성 완료';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '[pg_trgm] 인덱스 생성 실패 (shared library 문제) — 건너뜀: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE '[pg_trgm] 확장 미설치 — 트라이그램 인덱스 건너뜀. Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;';
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
-- Remove duplicate anon_session_id rows before creating unique index (keep the most recent row per value)
-- NOTE: id column is TEXT; use updated_at for ordering to avoid lexicographic comparison issues
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM conversation_sessions WHERE anon_session_id IS NOT NULL GROUP BY anon_session_id HAVING COUNT(*) > 1) THEN
        DELETE FROM conversation_sessions cs
        WHERE anon_session_id IS NOT NULL
          AND ctid NOT IN (
            SELECT DISTINCT ON (anon_session_id) ctid
            FROM conversation_sessions
            WHERE anon_session_id IS NOT NULL
            ORDER BY anon_session_id, updated_at DESC NULLS LAST
          );
        RAISE NOTICE '[schema] 중복 anon_session_id 로우 정리 완료';
    END IF;
END $$;
DROP INDEX IF EXISTS idx_sessions_anon;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_anon ON conversation_sessions(anon_session_id) WHERE anon_session_id IS NOT NULL;
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
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON conversation_sessions(updated_at);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON conversation_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON conversation_messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON user_memories(user_id, category);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_research_user_created ON research_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_steps_session_number ON research_steps(session_id, step_number);
CREATE INDEX IF NOT EXISTS idx_connections_user_service ON external_connections(user_id, service_type);

-- Phase 3-DBA: Additional index coverage for tables missing indexes
-- custom_agents: queried by created_by
CREATE INDEX IF NOT EXISTS idx_custom_agents_created_by ON custom_agents(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_agents_enabled ON custom_agents(enabled);

-- push_subscriptions_store: queried by user_id for subscription lookup
CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions_store(user_id);

-- alert_history: queried by type, severity, and created_at for dashboard filtering
CREATE INDEX IF NOT EXISTS idx_alert_history_type ON alert_history(type);
CREATE INDEX IF NOT EXISTS idx_alert_history_severity ON alert_history(severity);
CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_ack ON alert_history(acknowledged);

-- ============================================
-- 🎯 Agent Skills 시스템 테이블
-- ============================================

-- 에이전트 스킬 정의 테이블
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

-- 에이전트-스킬 연결 테이블
CREATE TABLE IF NOT EXISTS agent_skill_assignments (
    agent_id TEXT NOT NULL,
    skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (agent_id, skill_id)
);

-- Agent Skills 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_skills_created_by ON agent_skills(created_by);
CREATE INDEX IF NOT EXISTS idx_agent_skills_category ON agent_skills(category);
CREATE INDEX IF NOT EXISTS idx_agent_skills_public ON agent_skills(is_public);
CREATE INDEX IF NOT EXISTS idx_skill_assignments_agent ON agent_skill_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_assignments_skill ON agent_skill_assignments(skill_id);


-- ============================================
-- 🔄 마이그레이션: message_feedback 스키마 업그레이드
-- rating 기반 구버전 → signal 기반 신버전으로 자동 마이그레이션
-- 신규 설치는 위의 CREATE TABLE IF NOT EXISTS가 함
-- ============================================
DO $$ BEGIN
    -- rating 컴럼이 존재하면 구버전 스키마 → 마이그레이션 수행
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = 'message_feedback'
          AND column_name = 'rating'
    ) THEN
        -- 1. FK 제약 제거 (message_id INTEGER FK, session_id FK)
        ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS message_feedback_message_id_fkey;
        ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS message_feedback_session_id_fkey;

        -- 2. 구버전 컴럼 제거
        ALTER TABLE message_feedback DROP COLUMN IF EXISTS rating;
        ALTER TABLE message_feedback DROP COLUMN IF EXISTS feedback_text;

        -- 3. message_id 타입 변경: INTEGER → TEXT
        ALTER TABLE message_feedback ALTER COLUMN message_id TYPE TEXT USING message_id::TEXT;

        -- 4. 신규 컴럼 추가 (signal)
        ALTER TABLE message_feedback ADD COLUMN IF NOT EXISTS signal TEXT NOT NULL DEFAULT 'thumbs_up';
        ALTER TABLE message_feedback ALTER COLUMN signal DROP DEFAULT;

        -- 5. 신규 컴럼 추가 (routing_metadata)
        ALTER TABLE message_feedback ADD COLUMN IF NOT EXISTS routing_metadata JSONB;

        -- 6. signal CHECK 제약 추가
        BEGIN
            ALTER TABLE message_feedback ADD CONSTRAINT message_feedback_signal_check
                CHECK (signal IN ('thumbs_up', 'thumbs_down', 'regenerate'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        -- 7. 구버전 인덱스 제거
        DROP INDEX IF EXISTS idx_message_feedback_rating;
        DROP INDEX IF EXISTS idx_message_feedback_message;
        DROP INDEX IF EXISTS idx_message_feedback_session;
        DROP INDEX IF EXISTS idx_message_feedback_user;
        DROP INDEX IF EXISTS idx_message_feedback_created;

        -- 8. 신규 인덱스 생성
        CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_session ON message_feedback(session_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_signal  ON message_feedback(signal);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON message_feedback(created_at);

        RAISE NOTICE '[migration] message_feedback: rating 기반 → signal 기반 스키마 마이그레이션 완료';
    END IF;
END $$;

-- ============================================
-- P4 마이그레이션: api_usage.date TEXT → DATE
-- 기존 DB에 date 컬럼이 TEXT 타입이면 DATE로 변환
-- ============================================
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = 'api_usage'
          AND column_name = 'date'
          AND data_type   = 'text'
    ) THEN
        ALTER TABLE api_usage ALTER COLUMN date TYPE DATE USING date::DATE;
        RAISE NOTICE '[migration] api_usage.date: TEXT → DATE 변환 완료';
    END IF;
END $$;

-- ============================================
-- P4 마이그레이션: conversation_sessions.user_id FK → ON DELETE CASCADE
-- 기존 FK가 NO ACTION이면 CASCADE로 재생성
-- ============================================
DO $$
DECLARE
    v_constraint TEXT;
    v_delete_rule TEXT;
BEGIN
    SELECT tc.constraint_name, rc.delete_rule
      INTO v_constraint, v_delete_rule
      FROM information_schema.table_constraints  tc
      JOIN information_schema.key_column_usage   kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name   = 'conversation_sessions'
       AND kcu.column_name = 'user_id'
       AND tc.constraint_type = 'FOREIGN KEY'
     LIMIT 1;

    IF v_constraint IS NOT NULL AND v_delete_rule <> 'CASCADE' THEN
        EXECUTE 'ALTER TABLE conversation_sessions DROP CONSTRAINT ' || quote_ident(v_constraint);
        ALTER TABLE conversation_sessions
            ADD CONSTRAINT conversation_sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        RAISE NOTICE '[migration] conversation_sessions.user_id FK: ON DELETE CASCADE 추가 완료';
    ELSE
        RAISE NOTICE '[migration] conversation_sessions.user_id FK: 이미 CASCADE 또는 FK 없음 — 건너뜀';
    END IF;
END $$;

-- [D1 NO-OP] vector_embeddings는 상단 pgvector-aware DO 블록(307-343)에서 이미 처리됨
DO $$ BEGIN
    RAISE NOTICE '[schema] D1 vector_embeddings block skipped (already managed by pgvector-aware initializer)';
END $$;
