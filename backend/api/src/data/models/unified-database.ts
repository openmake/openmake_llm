/**
 * ============================================================
 * Unified Database Model - PostgreSQL 통합 데이터베이스 추상화
 * ============================================================
 *
 * 애플리케이션의 모든 데이터 접근을 단일 클래스로 추상화하는 핵심 데이터 레이어입니다.
 * Repository 패턴을 통해 도메인별 데이터 접근을 분리하며, 싱글톤으로 관리됩니다.
 *
 * @module data/models/unified-database
 * @description
 * - PostgreSQL Pool 기반 커넥션 관리 (pg 드라이버)
 * - 서버 시작 시 스키마 자동 생성 (CREATE TABLE IF NOT EXISTS)
 * - Repository 위임 패턴 (User, Conversation, Memory, Research, ApiKey, Audit)
 * - 재시도 로직 내장 (withRetry 래퍼)
 * - 싱글톤 접근: getUnifiedDatabase(), getPool()
 */

import { Pool, QueryResult, type PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { withRetry } from '../retry-wrapper';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import {
    ApiKeyRepository,
    AuditRepository,
    ConversationRepository,
    ExternalRepository,
    MemoryRepository,
    ResearchRepository,
    UserRepository
} from '../repositories';

const logger = createLogger('UnifiedDB');

type SpanLike = {
    setAttribute: (key: string, value: string | number | boolean) => SpanLike;
};

type WithSpanLike = <T>(
    tracerName: string,
    spanName: string,
    fn: (span: SpanLike) => Promise<T>,
    options?: { kind?: number; attributes?: Record<string, string | number | boolean> }
) => Promise<T>;

let cachedWithSpan: WithSpanLike | null | undefined;

function getWithSpan(): WithSpanLike | null {
    if (cachedWithSpan !== undefined) {
        return cachedWithSpan;
    }

    try {
        const otelModule = require('../../observability/otel') as { withSpan?: WithSpanLike };
        cachedWithSpan = typeof otelModule.withSpan === 'function' ? otelModule.withSpan : null;
    } catch (err) {
        logger.debug('[UnifiedDB] OTel withSpan load skipped', err);
        cachedWithSpan = null;
    }

    return cachedWithSpan;
}

/** SQL 쿼리 파라미터 타입 - $1, $2 등의 플레이스홀더에 바인딩되는 값 */
type QueryParam = string | number | boolean | null | undefined;

const SCHEMA_FILE_RELATIVE_PATH = 'services/database/init/002-schema.sql';

// Source of truth policy:
// 1) services/database/init/002-schema.sql is canonical for schema evolution.
// 2) LEGACY_SCHEMA is fallback-only for packaged/deployed environments where file access fails.
// 3) Keep LEGACY_SCHEMA aligned with core CREATE TABLE definitions and essential lookup indexes.
const LEGACY_SCHEMA = `
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
CREATE INDEX IF NOT EXISTS idx_messages_agent ON conversation_messages(agent_id);
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
    message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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

-- [P3 LEGACY] vector_embeddings: LEGACY_SCHEMA 폴백 버전은 embedding TEXT로 유지합니다.
-- 실제 프로덕션 스키마(002-schema.sql)는 embedding vector(768)을 사용합니다.
-- pgvector 미설치 환경에서의 graceful degradation을 위해 TEXT 타입을 유지합니다.
-- vector(768) 변환은 Migration 008이 담당합니다 (pgvector 설치 시 자동 변환).
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
-- P2-5: external_files 정렬 인덱스 (created_at DESC — 파일 목록 조회 시 정렬 성능)
CREATE INDEX IF NOT EXISTS idx_ext_files_created ON external_files(connection_id, created_at DESC);
-- P2-6: user_memories LIKE 풀스캔 대응 — pg_trgm GIN 인덱스 (LIKE '%keyword%' 인덱스 사용 가능)
-- pg_trgm 미설치 환경 graceful 처리: Migration 011에서 조건부 생성
CREATE INDEX IF NOT EXISTS idx_memories_user_importance ON user_memories(user_id, importance DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON vector_embeddings(source_type, source_id);

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

// ============================================
// 엔티티 타입 (unified-database.types.ts에서 import + re-export)
// ============================================
import type {
    User,
    ConversationSession,
    ConversationMessage,
    MemoryCategory,
    UserMemory,
    MemoryTag,
    ResearchStatus,
    ResearchDepth,
    ResearchSession,
    ResearchStep,
    ExternalServiceType,
    ExternalConnection,
    ExternalFile,
    MCPServerRow,
    ApiKeyTier,
    UserApiKey,
    UserApiKeyPublic,
} from './unified-database.types';
import { API_KEY_TIER_LIMITS as _API_KEY_TIER_LIMITS } from './unified-database.types';

export type {
    User,
    ConversationSession,
    ConversationMessage,
    MemoryCategory,
    UserMemory,
    MemoryTag,
    ResearchStatus,
    ResearchDepth,
    ResearchSession,
    ResearchStep,
    ExternalServiceType,
    ExternalConnection,
    ExternalFile,
    MCPServerRow,
    ApiKeyTier,
    UserApiKey,
    UserApiKeyPublic,
};
export { _API_KEY_TIER_LIMITS as API_KEY_TIER_LIMITS };

/**
 * 통합 데이터베이스 클래스 (PostgreSQL)
 *
 * 모든 도메인의 데이터 접근을 단일 진입점으로 제공합니다.
 * 내부적으로 Repository 패턴을 사용하여 각 도메인별 쿼리를 위임합니다.
 *
 * @class UnifiedDatabase
 * @description
 * - 서버 시작 시 스키마 자동 초기화 (SQL 파일 또는 LEGACY_SCHEMA 폴백)
 * - pg Pool 기반 커넥션 풀링 (statement_timeout: 30s, idle_timeout: 30s)
 * - 7개 Repository 위임: User, Conversation, Memory, Research, ApiKey, Audit, External
 * - withRetry 래퍼를 통한 일시적 연결 오류 자동 재시도
 */
export class UnifiedDatabase {
    /** PostgreSQL 커넥션 풀 */
    private pool: Pool;

    /** 스키마 초기화 완료 Promise (외부에서 ensureReady()로 대기 가능) */
    private schemaReady: Promise<void>;

    /** 사용자 데이터 접근 Repository */
    private readonly userRepository: UserRepository;

    /** 대화 세션/메시지 데이터 접근 Repository */
    private readonly conversationRepository: ConversationRepository;

    /** 장기 메모리 데이터 접근 Repository */
    private readonly memoryRepository: MemoryRepository;

    /** 딥 리서치 데이터 접근 Repository */
    private readonly researchRepository: ResearchRepository;

    /** API Key 관리 데이터 접근 Repository */
    private readonly apiKeyRepository: ApiKeyRepository;

    /** 감사 로그 데이터 접근 Repository */
    private readonly auditRepository: AuditRepository;

    /** 외부 연동 및 MCP 서버 데이터 접근 Repository */
    private readonly externalRepository: ExternalRepository;

    constructor() {
        const config = getConfig();
        const poolConfig: PoolConfig = {
            connectionString: config.databaseUrl,
            max: config.dbPoolMax,
            min: config.dbPoolMin,
            statement_timeout: 30000,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        };
        this.pool = new Pool(poolConfig);

        // Prevent process crash on idle client error
        this.pool.on('error', (err) => {
            logger.error('[UnifiedDB] Pool idle client error:', err);
        });

        // 스키마 초기화 — Promise를 보관하여 초기 쿼리가 스키마 완료를 대기할 수 있도록 함
        this.schemaReady = this.initSchema().catch(err => {
            logger.error('[UnifiedDB] Schema init failed:', err);
        }) as Promise<void>;

        this.userRepository = new UserRepository(this.pool);
        this.conversationRepository = new ConversationRepository(this.pool);
        this.memoryRepository = new MemoryRepository(this.pool);
        this.researchRepository = new ResearchRepository(this.pool);
        this.apiKeyRepository = new ApiKeyRepository(this.pool);
        this.auditRepository = new AuditRepository(this.pool);
        this.externalRepository = new ExternalRepository(this.pool);

        logger.info('[UnifiedDB] PostgreSQL Pool initialized');
    }

    private async initSchema(): Promise<void> {
        const { schema, source } = this.getSchemaSql();
        logger.info(`[UnifiedDB] Initializing schema from ${source}`);
        await withRetry(
            () => this.pool.query(schema),
            { operation: 'initialize schema from SQL source' }
        );
        // Migration: fix agent_usage_logs FK to use SET NULL on delete
        try {
            await this.retryQuery(`
                ALTER TABLE agent_usage_logs DROP CONSTRAINT IF EXISTS agent_usage_logs_session_id_fkey;
                ALTER TABLE agent_usage_logs ADD CONSTRAINT agent_usage_logs_session_id_fkey
                    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE SET NULL;
            `);
        } catch (_e: unknown) {
            // Constraint may already be correct — ignore
        }

        // pg_trgm GIN 인덱스 생성 시도 (LEGACY_SCHEMA 폴백 시에도 적용)
        try {
            await this.pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_memories_key_trgm ON user_memories USING gin (key gin_trgm_ops)`);
            await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_memories_value_trgm ON user_memories USING gin (value gin_trgm_ops)`);
            logger.info('[UnifiedDB] pg_trgm 트라이그램 인덱스 생성 완료');
        } catch (_e: unknown) {
            logger.info('[UnifiedDB] pg_trgm 인덱스 생성 건너뜀 (확장 미지원 환경)');
        }
    }

    private getSchemaSql(): { schema: string; source: string } {
        const candidatePaths = [
            path.resolve(process.cwd(), SCHEMA_FILE_RELATIVE_PATH),
            path.resolve(__dirname, '../../../../../services/database/init/002-schema.sql'),
            path.resolve(__dirname, '../../../../services/database/init/002-schema.sql')
        ];

        for (const filePath of candidatePaths) {
            try {
                const schema = fs.readFileSync(filePath, 'utf8');
                return { schema, source: `file:${filePath}` };
            } catch (error: unknown) {
                const err = error as NodeJS.ErrnoException;
                if (err.code !== 'ENOENT') {
                    logger.warn(`[UnifiedDB] Failed reading schema file at ${filePath}:`, err);
                }
            }
        }

        logger.warn('[UnifiedDB] Schema SQL file not found; falling back to LEGACY_SCHEMA');
        return { schema: LEGACY_SCHEMA, source: 'inline:LEGACY_SCHEMA' };
    }

    /**
     * 스키마 초기화 완료를 보장하는 헬퍼
     * 외부에서 DB를 사용하기 전에 호출하여 race condition 방지
     */
    async ensureReady(): Promise<void> {
        await this.schemaReady;
    }

    /**
     * Pool 직접 접근 (raw SQL 소비자용)
     */
    getPool(): Pool {
        return this.pool;
    }

    /**
     * 재시도 가능한 쿼리 래퍼
     * 일시적 연결 오류 시 자동 재시도 (지수 백오프)
     */
    private retryQuery(text: string, params?: QueryParam[]): Promise<QueryResult<Record<string, unknown>>> {
        const withSpan = getWithSpan();

        if (!withSpan) {
            return withRetry(
                () => this.pool.query(text, params),
                { operation: text.substring(0, 50) }
            );
        }

        return withSpan('UnifiedDB', 'db.query', async (span) => {
            span.setAttribute('db.system', 'postgresql');
            span.setAttribute('db.statement', text.substring(0, 200));

            const result = await withRetry(
                () => this.pool.query(text, params),
                { operation: text.substring(0, 50) }
            );

            span.setAttribute('db.rows_affected', result.rowCount ?? 0);
            return result;
        });
    }

    // ===== 사용자 관리 =====

    async createUser(id: string, username: string, passwordHash: string, email?: string, role: string = 'user') {
        return this.userRepository.createUser(id, username, passwordHash, email, role);
    }

    async getUserByUsername(username: string): Promise<User | undefined> {
        return this.userRepository.getUserByUsername(username);
    }

    async getUserById(id: string): Promise<User | undefined> {
        return this.userRepository.getUserById(id);
    }

    async updateLastLogin(userId: string) {
        return this.userRepository.updateLastLogin(userId);
    }

    async getAllUsers(limit: number = 50): Promise<User[]> {
        return this.userRepository.getAllUsers(limit);
    }

    // ===== 대화 관리 =====

    async createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null) {
        return this.conversationRepository.createSession(id, userId, title, metadata);
    }

    async addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }) {
        return this.conversationRepository.addMessage(sessionId, role, content, options);
    }

    async getSessionMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        return this.conversationRepository.getSessionMessages(sessionId, limit);
    }

    async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        return this.conversationRepository.getUserSessions(userId, limit);
    }

    async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        return this.conversationRepository.getAllSessions(limit);
    }

    async deleteSession(sessionId: string) {
        return this.conversationRepository.deleteSession(sessionId);
    }

    // ===== API 사용량 관리 =====

    async recordApiUsage(date: string, apiKeyId: string, requests: number, tokens: number, errors: number, avgResponseTime: number, models: Record<string, unknown>) {
        return this.apiKeyRepository.recordApiUsage(date, apiKeyId, requests, tokens, errors, avgResponseTime, models);
    }

    async getDailyUsage(days: number = 7) {
        return this.apiKeyRepository.getDailyUsage(days);
    }

    // ===== 에이전트 로그 =====

    async logAgentUsage(params: {
        userId?: string;
        sessionId?: string;
        agentId: string;
        query: string;
        responsePreview?: string;
        responseTimeMs?: number;
        tokensUsed?: number;
        success?: boolean;
        errorMessage?: string;
    }) {
        return this.auditRepository.logAgentUsage(params);
    }

    async getAgentStats(agentId: string, userId?: string) {
        return this.auditRepository.getAgentStats(agentId, userId);
    }

    // ===== 감사 로그 =====

    async logAudit(params: {
        action: string;
        userId?: string;
        resourceType?: string;
        resourceId?: string;
        details?: Record<string, unknown>;
        ipAddress?: string;
        userAgent?: string;
    }) {
        return this.auditRepository.logAudit(params);
    }

    async getAuditLogs(limit: number = 100, userId?: string) {
        return this.auditRepository.getAuditLogs(limit, userId);
    }

    // ===== 통계 =====

    async getStats() {
        return this.auditRepository.getStats();
    }

    // ============================================
    // 🧠 장기 메모리 시스템 메서드
    // ============================================

    async createMemory(params: {
        id: string;
        userId: string;
        category: MemoryCategory;
        key: string;
        value: string;
        importance?: number;
        sourceSessionId?: string;
        tags?: string[];
    }): Promise<void> {
        return this.memoryRepository.createMemory(params);
    }

    async getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): Promise<UserMemory[]> {
        return this.memoryRepository.getUserMemories(userId, options);
    }

    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        return this.memoryRepository.getRelevantMemories(userId, query, limit);
    }

    async updateMemory(memoryId: string, updates: { value?: string; importance?: number }): Promise<void> {
        return this.memoryRepository.updateMemory(memoryId, updates);
    }

    async deleteMemory(memoryId: string): Promise<void> {
        return this.memoryRepository.deleteMemory(memoryId);
    }

    async deleteUserMemories(userId: string): Promise<void> {
        return this.memoryRepository.deleteUserMemories(userId);
    }

    async getMemoryOwner(memoryId: string): Promise<string | null> {
        return this.memoryRepository.getOwnerUserId(memoryId);
    }

    async cleanupExpiredMemories(): Promise<number> {
        return this.memoryRepository.cleanupExpiredMemories();
    }

    async decayMemoryImportance(): Promise<number> {
        return this.memoryRepository.decayImportance();
    }

    // ============================================
    // 🔍 Deep Research 메서드
    // ============================================

    async createResearchSession(params: {
        id: string;
        userId?: string;
        topic: string;
        depth?: ResearchDepth;
    }): Promise<void> {
        return this.researchRepository.createResearchSession(params);
    }

    async getResearchSession(sessionId: string): Promise<ResearchSession | undefined> {
        return this.researchRepository.getResearchSession(sessionId);
    }

    async updateResearchSession(sessionId: string, updates: {
        status?: ResearchStatus;
        progress?: number;
        summary?: string;
        keyFindings?: string[];
        sources?: string[];
    }): Promise<void> {
        return this.researchRepository.updateResearchSession(sessionId, updates);
    }

    async addResearchStep(params: {
        sessionId: string;
        stepNumber: number;
        stepType: string;
        query?: string;
        result?: string;
        sources?: string[];
        status?: string;
    }): Promise<void> {
        return this.researchRepository.addResearchStep(params);
    }

    async getResearchSteps(sessionId: string): Promise<ResearchStep[]> {
        return this.researchRepository.getResearchSteps(sessionId);
    }

    async getUserResearchSessions(userId: string, limit: number = 20): Promise<ResearchSession[]> {
        return this.researchRepository.getUserResearchSessions(userId, limit);
    }

    async deleteResearchSession(sessionId: string): Promise<void> {
        return this.researchRepository.deleteSessionWithSteps(sessionId);
    }

    // ============================================
    // 🔗 외부 서비스 통합 메서드
    // ============================================

    async createExternalConnection(params: {
        id: string;
        userId: string;
        serviceType: ExternalServiceType;
        accessToken?: string;
        refreshToken?: string;
        tokenExpiresAt?: string;
        accountEmail?: string;
        accountName?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        return this.externalRepository.createExternalConnection(params);
    }

    async getUserConnections(userId: string): Promise<ExternalConnection[]> {
        return this.externalRepository.getUserConnections(userId);
    }

    async getExternalConnection(connectionId: string): Promise<ExternalConnection | undefined> {
        return this.externalRepository.getExternalConnection(connectionId);
    }

    async getUserConnectionByService(userId: string, serviceType: ExternalServiceType): Promise<ExternalConnection | undefined> {
        return this.externalRepository.getUserConnectionByService(userId, serviceType);
    }

    async updateConnectionTokens(connectionId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    }): Promise<void> {
        return this.externalRepository.updateConnectionTokens(connectionId, tokens);
    }

    async disconnectService(userId: string, serviceType: ExternalServiceType): Promise<void> {
        return this.externalRepository.disconnectService(userId, serviceType);
    }

    // 외부 파일 캐시
    async cacheExternalFile(params: {
        id: string;
        connectionId: string;
        externalId: string;
        fileName: string;
        fileType?: string;
        fileSize?: number;
        webUrl?: string;
        cachedContent?: string;
    }): Promise<void> {
        return this.externalRepository.cacheExternalFile(params);
    }

    async getConnectionFiles(connectionId: string, limit: number = 100): Promise<ExternalFile[]> {
        return this.externalRepository.getConnectionFiles(connectionId, limit);
    }

    async getCachedFile(connectionId: string, externalId: string): Promise<ExternalFile | undefined> {
        return this.externalRepository.getCachedFile(connectionId, externalId);
    }

    // ============================================
    // 🔌 MCP 외부 서버 메서드
    // ============================================

    async getMcpServers(): Promise<MCPServerRow[]> {
        return this.externalRepository.getMcpServers();
    }

    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        return this.externalRepository.getMcpServerById(id);
    }

    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        return this.externalRepository.createMcpServer(server);
    }

    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        return this.externalRepository.updateMcpServer(id, updates);
    }

    async deleteMcpServer(id: string): Promise<boolean> {
        return this.externalRepository.deleteMcpServer(id);
    }

    // ============================================
    // 🔑 API Key 관리 메서드
    // ============================================

    async createApiKey(params: {
        id: string;
        userId: string;
        keyHash: string;
        keyPrefix: string;
        last4: string;
        name: string;
        description?: string;
        scopes?: string[];
        allowedModels?: string[];
        rateLimitTier?: ApiKeyTier;
        expiresAt?: string;
    }): Promise<UserApiKey> {
        return this.apiKeyRepository.createApiKey(params);
    }

    async getApiKeyByHash(keyHash: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.getApiKeyByHash(keyHash);
    }

    async getApiKeyById(keyId: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.getApiKeyById(keyId);
    }

    async listUserApiKeys(userId: string, options?: {
        includeInactive?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<UserApiKey[]> {
        return this.apiKeyRepository.listUserApiKeys(userId, options);
    }

    async updateApiKey(keyId: string, updates: {
        name?: string;
        description?: string;
        scopes?: string[];
        allowedModels?: string[];
        rateLimitTier?: ApiKeyTier;
        isActive?: boolean;
        expiresAt?: string | null;
    }): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.updateApiKey(keyId, updates);
    }

    async deleteApiKey(keyId: string): Promise<boolean> {
        return this.apiKeyRepository.deleteApiKey(keyId);
    }

    async rotateApiKey(keyId: string, newKeyHash: string, newLast4: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.rotateApiKey(keyId, newKeyHash, newLast4);
    }

    async recordApiKeyUsage(keyId: string, tokens: number): Promise<void> {
        return this.apiKeyRepository.recordApiKeyUsage(keyId, tokens);
    }

    async getApiKeyUsageStats(keyId: string): Promise<{
        totalRequests: number;
        totalTokens: number;
        lastUsedAt: string | null;
    } | undefined> {
        return this.apiKeyRepository.getApiKeyUsageStats(keyId);
    }

    async countUserApiKeys(userId: string): Promise<number> {
        return this.apiKeyRepository.countUserApiKeys(userId);
    }

    // ===== 유틸리티 =====

    async close(): Promise<void> {
        await this.pool.end();
        logger.info('[UnifiedDB] Connection closed');
    }
}

/** 싱글톤 인스턴스 */
let dbInstance: UnifiedDatabase | null = null;

/**
 * UnifiedDatabase 싱글톤 인스턴스를 반환합니다.
 * 최초 호출 시 인스턴스를 생성하고 스키마를 초기화합니다.
 *
 * @returns UnifiedDatabase 싱글톤 인스턴스
 */
export function getUnifiedDatabase(): UnifiedDatabase {
    if (!dbInstance) {
        dbInstance = new UnifiedDatabase();
    }
    return dbInstance;
}

/**
 * Pool 직접 접근 (raw SQL 소비자용)
 */
export function getPool(): Pool {
    return getUnifiedDatabase().getPool();
}

/**
 * 데이터베이스 커넥션 풀을 종료하고 싱글톤을 해제합니다.
 * 서버 종료(graceful shutdown) 시 호출합니다.
 */
export async function closeDatabase(): Promise<void> {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
    }
}
