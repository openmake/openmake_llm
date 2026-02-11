/**
 * Unified Database Model
 * 통합 데이터베이스 모델 - PostgreSQL 기반
 */

import { Pool, QueryResult } from 'pg';
import { withTransaction, withRetry, type TransactionClient } from '../retry-wrapper';
import { getConfig } from '../../config/env';

/** Generic DB query parameter type */
type QueryParam = string | number | boolean | null | undefined;

/** Generic DB row from pg query result */
type DbRow = Record<string, unknown>;

// 데이터베이스 스키마 (PostgreSQL)
const SCHEMA = `
-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

-- 대화 세션 테이블
CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 대화 메시지 테이블
CREATE TABLE IF NOT EXISTS conversation_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    agent_id TEXT,
    thinking TEXT,
    tokens INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
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
    user_id TEXT,
    session_id TEXT,
    agent_id TEXT NOT NULL,
    query TEXT,
    response_preview TEXT,
    response_time_ms INTEGER,
    tokens_used INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);

-- 에이전트 피드백 테이블
CREATE TABLE IF NOT EXISTS agent_feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    user_id TEXT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    query TEXT,
    response TEXT,
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id)
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
    created_by TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (created_by) REFERENCES users(id)
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

-- 인덱스
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

-- ============================================
-- 🧠 장기 메모리 시스템 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, category, key)
);

CREATE TABLE IF NOT EXISTS memory_tags (
    id SERIAL PRIMARY KEY,
    memory_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE,
    UNIQUE(memory_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON user_memories(importance DESC);

-- ============================================
-- 🔍 Deep Research 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS research_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    depth TEXT DEFAULT 'standard' CHECK(depth IN ('quick', 'standard', 'deep')),
    progress INTEGER DEFAULT 0,
    summary TEXT,
    key_findings JSONB,
    sources JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS research_steps (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    query TEXT,
    result TEXT,
    sources JSONB,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES research_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_user ON research_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_sessions(status);

-- ============================================
-- 🏪 Custom Agent 마켓플레이스 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS agent_marketplace (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
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
    published_at TIMESTAMPTZ,
    FOREIGN KEY (agent_id) REFERENCES custom_agents(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agent_reviews (
    id TEXT PRIMARY KEY,
    marketplace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    title TEXT,
    content TEXT,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (marketplace_id) REFERENCES agent_marketplace(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(marketplace_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_installations (
    id SERIAL PRIMARY KEY,
    marketplace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (marketplace_id) REFERENCES agent_marketplace(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(marketplace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_category ON agent_marketplace(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_downloads ON agent_marketplace(downloads DESC);

-- ============================================
-- 📝 Canvas 협업 도구 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS canvas_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    title TEXT NOT NULL,
    doc_type TEXT DEFAULT 'document' CHECK(doc_type IN ('document', 'code', 'diagram', 'table')),
    content TEXT,
    language TEXT,
    version INTEGER DEFAULT 1,
    is_shared BOOLEAN DEFAULT FALSE,
    share_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);

CREATE TABLE IF NOT EXISTS canvas_versions (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    change_summary TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (document_id) REFERENCES canvas_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_user ON canvas_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_documents(session_id);

-- ============================================
-- 🔗 외부 서비스 통합 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS external_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, service_type)
);

CREATE TABLE IF NOT EXISTS external_files (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    web_url TEXT,
    last_synced TIMESTAMPTZ,
    cached_content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (connection_id) REFERENCES external_connections(id) ON DELETE CASCADE,
    UNIQUE(connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_user ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_service ON external_connections(service_type);

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

CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

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

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON user_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON user_api_keys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON user_api_keys(rate_limit_tier);
`;

export interface User {
    id: string;
    username: string;
    password_hash: string;
    email?: string;
    role: 'admin' | 'user' | 'guest';
    created_at: string;
    updated_at: string;
    last_login?: string;
    is_active: boolean;
}

export interface ConversationSession {
    id: string;
    user_id?: string;
    title: string;
    created_at: string;
    updated_at: string;
    metadata?: Record<string, unknown> | null;
}

export interface ConversationMessage {
    id: number;
    session_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    model?: string;
    agent_id?: string;
    thinking?: string;
    tokens?: number;
    response_time_ms?: number;
    created_at: string;
}

// ============================================
// 🧠 장기 메모리 시스템 인터페이스
// ============================================

export type MemoryCategory = 'preference' | 'fact' | 'project' | 'relationship' | 'skill' | 'context';

export interface UserMemory {
    id: string;
    user_id: string;
    category: MemoryCategory;
    key: string;
    value: string;
    importance: number;
    access_count: number;
    last_accessed?: string;
    source_session_id?: string;
    created_at: string;
    updated_at: string;
    expires_at?: string;
}

export interface MemoryTag {
    id: number;
    memory_id: string;
    tag: string;
}

// ============================================
// 🔍 Deep Research 인터페이스
// ============================================

export type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResearchDepth = 'quick' | 'standard' | 'deep';

export interface ResearchSession {
    id: string;
    user_id?: string;
    topic: string;
    status: ResearchStatus;
    depth: ResearchDepth;
    progress: number;
    summary?: string;
    key_findings?: string[];
    sources?: string[];
    created_at: string;
    updated_at: string;
    completed_at?: string;
}

export interface ResearchStep {
    id: number;
    session_id: string;
    step_number: number;
    step_type: string;
    query?: string;
    result?: string;
    sources?: string[];
    status: string;
    created_at: string;
}

// ============================================
// 🏪 마켓플레이스 인터페이스
// ============================================

export type MarketplaceStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface MarketplaceAgent {
    id: string;
    agent_id: string;
    author_id: string;
    title: string;
    description?: string;
    long_description?: string;
    category?: string;
    tags?: string[];
    icon: string;
    price: number;
    is_free: boolean;
    is_featured: boolean;
    is_verified: boolean;
    downloads: number;
    rating_avg: number;
    rating_count: number;
    version: string;
    status: MarketplaceStatus;
    created_at: string;
    updated_at: string;
    published_at?: string;
}

export interface AgentReview {
    id: string;
    marketplace_id: string;
    user_id: string;
    rating: number;
    title?: string;
    content?: string;
    helpful_count: number;
    created_at: string;
}

export interface AgentInstallation {
    id: number;
    marketplace_id: string;
    user_id: string;
    installed_at: string;
}

// ============================================
// 📝 Canvas 인터페이스
// ============================================

export type CanvasDocType = 'document' | 'code' | 'diagram' | 'table';

export interface CanvasDocument {
    id: string;
    user_id: string;
    session_id?: string;
    title: string;
    doc_type: CanvasDocType;
    content?: string;
    language?: string;
    version: number;
    is_shared: boolean;
    share_token?: string;
    created_at: string;
    updated_at: string;
}

export interface CanvasVersion {
    id: number;
    document_id: string;
    version: number;
    content: string;
    change_summary?: string;
    created_by?: string;
    created_at: string;
}

// ============================================
// 🔗 외부 서비스 통합 인터페이스
// ============================================

export type ExternalServiceType = 'google_drive' | 'notion' | 'github' | 'slack' | 'dropbox';

export interface ExternalConnection {
    id: string;
    user_id: string;
    service_type: ExternalServiceType;
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: string;
    account_email?: string;
    account_name?: string;
    metadata?: Record<string, any>;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface ExternalFile {
    id: string;
    connection_id: string;
    external_id: string;
    file_name: string;
    file_type?: string;
    file_size?: number;
    web_url?: string;
    last_synced?: string;
    cached_content?: string;
    created_at: string;
}

// ============================================
// 🔌 MCP 외부 서버 인터페이스
// ============================================

export interface MCPServerRow {
    id: string;
    name: string;
    transport_type: string;
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    url: string | null;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

// ============================================
// 🔑 API Key 관리 인터페이스
// ============================================

export type ApiKeyTier = 'free' | 'starter' | 'standard' | 'enterprise';

export interface UserApiKey {
    id: string;
    user_id: string;
    key_hash: string;
    key_prefix: string;
    last_4: string;
    name: string;
    description?: string;
    scopes: string[];
    allowed_models: string[];
    rate_limit_tier: ApiKeyTier;
    is_active: boolean;
    last_used_at?: string;
    expires_at?: string;
    created_at: string;
    updated_at: string;
    total_requests: number;
    total_tokens: number;
}

/** API Key 생성 시 반환할 공개 정보 (해시 제외) */
export interface UserApiKeyPublic {
    id: string;
    user_id: string;
    key_prefix: string;
    last_4: string;
    name: string;
    description?: string;
    scopes: string[];
    allowed_models: string[];
    rate_limit_tier: ApiKeyTier;
    is_active: boolean;
    last_used_at?: string;
    expires_at?: string;
    created_at: string;
    updated_at: string;
    total_requests: number;
    total_tokens: number;
}

/** Rate limit tier 설정 */
export const API_KEY_TIER_LIMITS: Record<ApiKeyTier, {
    rpm: number;
    tpm: number;
    dailyRequests: number;
    monthlyRequests: number;
}> = {
    free: { rpm: 10, tpm: 10_000, dailyRequests: 100, monthlyRequests: 1_000 },
    starter: { rpm: 30, tpm: 50_000, dailyRequests: 500, monthlyRequests: 10_000 },
    standard: { rpm: 60, tpm: 100_000, dailyRequests: 3_000, monthlyRequests: 100_000 },
    enterprise: { rpm: 300, tpm: 1_000_000, dailyRequests: -1, monthlyRequests: -1 }, // -1 = unlimited
};

/**
 * 통합 데이터베이스 클래스 (PostgreSQL)
 */
export class UnifiedDatabase {
    private pool: Pool;

    private schemaReady: Promise<void>;

    constructor() {
        this.pool = new Pool({
            connectionString: getConfig().databaseUrl
        });

        // 스키마 초기화 — Promise를 보관하여 초기 쿼리가 스키마 완료를 대기할 수 있도록 함
        this.schemaReady = this.initSchema().catch(err => {
            console.error('[UnifiedDB] Schema init failed:', err);
        }) as Promise<void>;

        console.log(`[UnifiedDB] PostgreSQL Pool 초기화 완료`);
    }

    private async initSchema(): Promise<void> {
        await this.retryQuery(SCHEMA);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private retryQuery(text: string, params?: QueryParam[]): Promise<QueryResult<any>> {
        return withRetry(
            () => this.pool.query(text, params),
            { operation: text.substring(0, 50) }
        );
    }

    // ===== 사용자 관리 =====

    async createUser(id: string, username: string, passwordHash: string, email?: string, role: string = 'user') {
        const result = await this.retryQuery(
            `INSERT INTO users (id, username, password_hash, email, role) VALUES ($1, $2, $3, $4, $5)`,
            [id, username, passwordHash, email, role]
        );
        return result;
    }

    async getUserByUsername(username: string): Promise<User | undefined> {
        const result = await this.retryQuery('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0] as User | undefined;
    }

    async getUserById(id: string): Promise<User | undefined> {
        const result = await this.retryQuery('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0] as User | undefined;
    }

    async updateLastLogin(userId: string) {
        const result = await this.retryQuery('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
        return result;
    }

    async getAllUsers(limit: number = 50): Promise<User[]> {
        const result = await this.retryQuery('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit]);
        return result.rows as User[];
    }

    // ===== 대화 관리 =====

    async createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null) {
        const result = await this.retryQuery(
            `INSERT INTO conversation_sessions (id, user_id, title, metadata) VALUES ($1, $2, $3, $4)`,
            [id, userId, title || '새 대화', JSON.stringify(metadata || {})]
        );
        return result;
    }

    async addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }) {
        const result = await this.retryQuery(
            `INSERT INTO conversation_messages 
            (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                sessionId, role, content,
                options?.model, options?.agentId, options?.thinking,
                options?.tokens, options?.responseTimeMs
            ]
        );
        return result;
    }

    async getSessionMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        const result = await this.retryQuery(
            `SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`,
            [sessionId, limit]
        );
        return result.rows as ConversationMessage[];
    }

    async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.retryQuery(
            `SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
            [userId, limit]
        );
        return result.rows as ConversationSession[];
    }

    async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.retryQuery(
            `SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1`,
            [limit]
        );
        return result.rows as ConversationSession[];
    }

    async deleteSession(sessionId: string) {
        const result = await this.retryQuery('DELETE FROM conversation_sessions WHERE id = $1', [sessionId]);
        return { changes: result.rowCount || 0 };
    }

    // ===== API 사용량 관리 =====

    async recordApiUsage(date: string, apiKeyId: string, requests: number, tokens: number, errors: number, avgResponseTime: number, models: Record<string, unknown>) {
        const result = await this.retryQuery(
            `INSERT INTO api_usage (date, api_key_id, requests, tokens, errors, avg_response_time, models)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(date, api_key_id) DO UPDATE SET
                requests = api_usage.requests + EXCLUDED.requests,
                tokens = api_usage.tokens + EXCLUDED.tokens,
                errors = api_usage.errors + EXCLUDED.errors,
                avg_response_time = (api_usage.avg_response_time + EXCLUDED.avg_response_time) / 2,
                models = EXCLUDED.models,
                updated_at = NOW()`,
            [date, apiKeyId, requests, tokens, errors, avgResponseTime, JSON.stringify(models)]
        );
        return result;
    }

    async getDailyUsage(days: number = 7) {
        const result = await this.retryQuery(
            `SELECT date, SUM(requests) as requests, SUM(tokens) as tokens, SUM(errors) as errors, AVG(avg_response_time) as avg_response_time
            FROM api_usage
            WHERE date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::text
            GROUP BY date
            ORDER BY date DESC`,
            [days]
        );
        return result.rows;
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
        const result = await this.retryQuery(
            `INSERT INTO agent_usage_logs 
            (user_id, session_id, agent_id, query, response_preview, response_time_ms, tokens_used, success, error_message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                params.userId, params.sessionId, params.agentId,
                params.query, params.responsePreview,
                params.responseTimeMs, params.tokensUsed,
                params.success !== false,
                params.errorMessage
            ]
        );
        return result;
    }

    async getAgentStats(agentId: string) {
        const result = await this.retryQuery(
            `SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_requests,
                AVG(response_time_ms) as avg_response_time,
                AVG(tokens_used) as avg_tokens
            FROM agent_usage_logs
            WHERE agent_id = $1`,
            [agentId]
        );
        return result.rows[0];
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
        const result = await this.retryQuery(
            `INSERT INTO audit_logs 
            (action, user_id, resource_type, resource_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.action, params.userId, params.resourceType, params.resourceId,
                JSON.stringify(params.details || {}), params.ipAddress, params.userAgent
            ]
        );
        return result;
    }

    async getAuditLogs(limit: number = 100) {
        const result = await this.retryQuery(
            `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1`,
            [limit]
        );
        return result.rows;
    }

    // ===== 통계 =====

    async getStats() {
        const tables = ['users', 'conversation_sessions', 'conversation_messages',
            'api_usage', 'agent_usage_logs', 'agent_feedback',
            'custom_agents', 'audit_logs', 'alert_history'];

        const stats: Record<string, number> = {};

        for (const table of tables) {
            const result = await this.retryQuery(`SELECT COUNT(*) as count FROM ${table}`);
            stats[table] = parseInt(result.rows[0].count, 10);
        }

        return stats;
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
        await withTransaction(this.pool, async (client) => {
            await client.query(
                `INSERT INTO user_memories (id, user_id, category, key, value, importance, source_session_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT(user_id, category, key) DO UPDATE SET
                    value = EXCLUDED.value,
                    importance = CASE WHEN EXCLUDED.importance > user_memories.importance THEN EXCLUDED.importance ELSE user_memories.importance END,
                    updated_at = NOW(),
                    access_count = user_memories.access_count + 1`,
                [
                    params.id, params.userId, params.category,
                    params.key, params.value, params.importance || 0.5,
                    params.sourceSessionId
                ]
            );

            // 태그 저장 (멀티 로우 INSERT로 N+1 쿼리 방지)
            if (params.tags && params.tags.length > 0) {
                const tagValues = params.tags.map((_, i) => `($1, $${i + 2})`).join(', ');
                await client.query(
                    `INSERT INTO memory_tags (memory_id, tag) VALUES ${tagValues} ON CONFLICT DO NOTHING`,
                    [params.id, ...params.tags]
                );
            }
        });
    }

    async getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): Promise<UserMemory[]> {
        let query = 'SELECT * FROM user_memories WHERE user_id = $1';
        const params: QueryParam[] = [userId];
        let paramIdx = 2;

        if (options?.category) {
            query += ` AND category = $${paramIdx++}`;
            params.push(options.category);
        }
        if (options?.minImportance) {
            query += ` AND importance >= $${paramIdx++}`;
            params.push(options.minImportance);
        }

        query += ' ORDER BY importance DESC, updated_at DESC';

        if (options?.limit) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(options.limit);
        }

        const result = await this.retryQuery(query, params);
        return result.rows as UserMemory[];
    }

    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        // 간단한 키워드 기반 검색 (나중에 벡터 검색으로 업그레이드 가능)
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
        if (keywords.length === 0) {
            return this.getUserMemories(userId, { limit });
        }

        // 키워드 매칭 쿼리
        const params: QueryParam[] = [userId];
        let paramIdx = 2;
        const conditions = keywords.map(kw => {
            const p1 = paramIdx++;
            const p2 = paramIdx++;
            params.push(`%${kw}%`, `%${kw}%`);
            return `(LOWER(key) LIKE $${p1} OR LOWER(value) LIKE $${p2})`;
        }).join(' OR ');
        
        params.push(limit);
        const limitParam = paramIdx++;

        const sqlQuery = `
            SELECT * FROM user_memories 
            WHERE user_id = $1 AND (${conditions})
            ORDER BY importance DESC, updated_at DESC
            LIMIT $${limitParam}
        `;

        // access_count 업데이트
        const result = await this.retryQuery(sqlQuery, params);
        const rows = result.rows as UserMemory[];
        
        if (rows.length > 0) {
            const ids = rows.map(m => m.id);
            const idPlaceholders = ids.map((_, i) => `$${i + 1}`).join(',');
            await this.retryQuery(
                `UPDATE user_memories 
                SET access_count = access_count + 1, last_accessed = NOW() 
                WHERE id IN (${idPlaceholders})`,
                ids
            );
        }

        return rows;
    }

    async updateMemory(memoryId: string, updates: { value?: string; importance?: number }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.value !== undefined) {
            sets.push(`value = $${paramIdx++}`);
            params.push(updates.value);
        }
        if (updates.importance !== undefined) {
            sets.push(`importance = $${paramIdx++}`);
            params.push(updates.importance);
        }

        params.push(memoryId);
        await this.retryQuery(`UPDATE user_memories SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    async deleteMemory(memoryId: string): Promise<void> {
        await this.retryQuery('DELETE FROM user_memories WHERE id = $1', [memoryId]);
    }

    async deleteUserMemories(userId: string): Promise<void> {
        await this.retryQuery('DELETE FROM user_memories WHERE user_id = $1', [userId]);
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
        await this.retryQuery(
            `INSERT INTO research_sessions (id, user_id, topic, depth) VALUES ($1, $2, $3, $4)`,
            [params.id, params.userId, params.topic, params.depth || 'standard']
        );
    }

    async getResearchSession(sessionId: string): Promise<ResearchSession | undefined> {
        const result = await this.retryQuery('SELECT * FROM research_sessions WHERE id = $1', [sessionId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            key_findings: row.key_findings || [],
            sources: row.sources || []
        };
    }

    async updateResearchSession(sessionId: string, updates: {
        status?: ResearchStatus;
        progress?: number;
        summary?: string;
        keyFindings?: string[];
        sources?: string[];
    }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.status) {
            sets.push(`status = $${paramIdx++}`);
            params.push(updates.status);
            if (updates.status === 'completed' || updates.status === 'failed') {
                sets.push('completed_at = NOW()');
            }
        }
        if (updates.progress !== undefined) {
            sets.push(`progress = $${paramIdx++}`);
            params.push(updates.progress);
        }
        if (updates.summary !== undefined) {
            sets.push(`summary = $${paramIdx++}`);
            params.push(updates.summary);
        }
        if (updates.keyFindings) {
            sets.push(`key_findings = $${paramIdx++}`);
            params.push(JSON.stringify(updates.keyFindings));
        }
        if (updates.sources) {
            sets.push(`sources = $${paramIdx++}`);
            params.push(JSON.stringify(updates.sources));
        }

        params.push(sessionId);
        await this.retryQuery(`UPDATE research_sessions SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
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
        await this.retryQuery(
            `INSERT INTO research_steps (session_id, step_number, step_type, query, result, sources, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.sessionId, params.stepNumber, params.stepType,
                params.query, params.result,
                params.sources ? JSON.stringify(params.sources) : null,
                params.status || 'pending'
            ]
        );
    }

    async getResearchSteps(sessionId: string): Promise<ResearchStep[]> {
        const result = await this.retryQuery(
            `SELECT * FROM research_steps WHERE session_id = $1 ORDER BY step_number ASC`,
            [sessionId]
        );
        return result.rows.map((row) => ({
            ...row,
            sources: row.sources || []
        }));
    }

    async getUserResearchSessions(userId: string, limit: number = 20): Promise<ResearchSession[]> {
        const result = await this.retryQuery(
            `SELECT * FROM research_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]
        );
        return result.rows.map((row) => ({
            ...row,
            key_findings: row.key_findings || [],
            sources: row.sources || []
        }));
    }

    // ============================================
    // 🏪 마켓플레이스 메서드
    // ============================================

    async publishToMarketplace(params: {
        id: string;
        agentId: string;
        authorId: string;
        title: string;
        description?: string;
        longDescription?: string;
        category?: string;
        tags?: string[];
        icon?: string;
        price?: number;
    }): Promise<void> {
        await this.retryQuery(
            `INSERT INTO agent_marketplace 
            (id, agent_id, author_id, title, description, long_description, category, tags, icon, price, is_free)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                params.id, params.agentId, params.authorId, params.title,
                params.description, params.longDescription, params.category,
                params.tags ? JSON.stringify(params.tags) : null,
                params.icon || '🤖',
                params.price || 0,
                (params.price || 0) === 0
            ]
        );
    }

    async getMarketplaceAgents(options?: {
        category?: string;
        status?: MarketplaceStatus;
        featured?: boolean;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<MarketplaceAgent[]> {
        let query = 'SELECT * FROM agent_marketplace WHERE 1=1';
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (options?.status) {
            query += ` AND status = $${paramIdx++}`;
            params.push(options.status);
        } else {
            query += ` AND status = $${paramIdx++}`;
            params.push('approved');
        }

        if (options?.category) {
            query += ` AND category = $${paramIdx++}`;
            params.push(options.category);
        }
        if (options?.featured) {
            query += ' AND is_featured = TRUE';
        }
        if (options?.search) {
            query += ` AND (LOWER(title) LIKE $${paramIdx} OR LOWER(description) LIKE $${paramIdx})`;
            params.push(`%${options.search.toLowerCase()}%`);
            paramIdx++;
        }

        query += ' ORDER BY is_featured DESC, downloads DESC, rating_avg DESC';

        if (options?.limit) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(options.limit);
        }
        if (options?.offset) {
            query += ` OFFSET $${paramIdx++}`;
            params.push(options.offset);
        }

        const result = await this.retryQuery(query, params);
        return result.rows.map((row) => ({
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        }));
    }

    async getMarketplaceAgent(marketplaceId: string): Promise<MarketplaceAgent | undefined> {
        const result = await this.retryQuery('SELECT * FROM agent_marketplace WHERE id = $1', [marketplaceId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        };
    }

    async updateMarketplaceStatus(marketplaceId: string, status: MarketplaceStatus): Promise<void> {
        await this.retryQuery(
            `UPDATE agent_marketplace 
            SET status = $1, updated_at = NOW(),
                published_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE published_at END
            WHERE id = $2`,
            [status, marketplaceId]
        );
    }

    async installAgent(marketplaceId: string, userId: string): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            const result = await client.query(
                `INSERT INTO agent_installations (marketplace_id, user_id)
                VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [marketplaceId, userId]
            );

            if ((result.rowCount || 0) > 0) {
                await client.query(
                    'UPDATE agent_marketplace SET downloads = downloads + 1 WHERE id = $1',
                    [marketplaceId]
                );
            }
        });
    }

    async uninstallAgent(marketplaceId: string, userId: string): Promise<void> {
        await this.retryQuery(
            'DELETE FROM agent_installations WHERE marketplace_id = $1 AND user_id = $2',
            [marketplaceId, userId]
        );
    }

    async getUserInstalledAgents(userId: string): Promise<MarketplaceAgent[]> {
        const result = await this.retryQuery(
            `SELECT m.* FROM agent_marketplace m
            JOIN agent_installations i ON m.id = i.marketplace_id
            WHERE i.user_id = $1
            ORDER BY i.installed_at DESC`,
            [userId]
        );
        return result.rows.map((row) => ({
            ...row,
            tags: row.tags || [],
            is_free: !!row.is_free,
            is_featured: !!row.is_featured,
            is_verified: !!row.is_verified
        }));
    }

    async addAgentReview(params: {
        id: string;
        marketplaceId: string;
        userId: string;
        rating: number;
        title?: string;
        content?: string;
    }): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            await client.query(
                `INSERT INTO agent_reviews (id, marketplace_id, user_id, rating, title, content)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT(marketplace_id, user_id) DO UPDATE SET
                    rating = EXCLUDED.rating,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content`,
                [params.id, params.marketplaceId, params.userId, params.rating, params.title, params.content]
            );

            // 평균 평점 업데이트
            await client.query(
                `UPDATE agent_marketplace SET
                    rating_avg = (SELECT AVG(rating) FROM agent_reviews WHERE marketplace_id = $1),
                    rating_count = (SELECT COUNT(*) FROM agent_reviews WHERE marketplace_id = $1)
                WHERE id = $1`,
                [params.marketplaceId]
            );
        });
    }

    async getAgentReviews(marketplaceId: string, limit: number = 20): Promise<AgentReview[]> {
        const result = await this.retryQuery(
            `SELECT * FROM agent_reviews WHERE marketplace_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [marketplaceId, limit]
        );
        return result.rows as AgentReview[];
    }

    // ============================================
    // 📝 Canvas 메서드
    // ============================================

    async createCanvasDocument(params: {
        id: string;
        userId: string;
        sessionId?: string;
        title: string;
        docType?: CanvasDocType;
        content?: string;
        language?: string;
    }): Promise<void> {
        await this.retryQuery(
            `INSERT INTO canvas_documents (id, user_id, session_id, title, doc_type, content, language)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.id, params.userId, params.sessionId,
                params.title, params.docType || 'document',
                params.content, params.language
            ]
        );
    }

    async getCanvasDocument(documentId: string): Promise<CanvasDocument | undefined> {
        const result = await this.retryQuery('SELECT * FROM canvas_documents WHERE id = $1', [documentId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_shared: !!row.is_shared
        };
    }

    async updateCanvasDocument(documentId: string, updates: {
        title?: string;
        content?: string;
        changeSummary?: string;
        updatedBy?: string;
    }): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            // 버전 히스토리 저장
            const current = await this.getCanvasDocument(documentId);
            if (current && updates.content !== undefined && updates.content !== current.content) {
                await client.query(
                    `INSERT INTO canvas_versions (document_id, version, content, change_summary, created_by)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [
                        documentId, current.version, current.content || '',
                        updates.changeSummary || 'Auto-saved version',
                        updates.updatedBy
                    ]
                );
            }

            const sets: string[] = ['updated_at = NOW()'];
            const params: QueryParam[] = [];
            let paramIdx = 1;

            if (updates.title !== undefined) {
                sets.push(`title = $${paramIdx++}`);
                params.push(updates.title);
            }
            if (updates.content !== undefined) {
                sets.push(`content = $${paramIdx++}`);
                sets.push('version = version + 1');
                params.push(updates.content);
            }

            params.push(documentId);
            await client.query(`UPDATE canvas_documents SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
        });
    }

    async getCanvasVersions(documentId: string): Promise<CanvasVersion[]> {
        const result = await this.retryQuery(
            `SELECT * FROM canvas_versions WHERE document_id = $1 ORDER BY version DESC`,
            [documentId]
        );
        return result.rows as CanvasVersion[];
    }

    async getUserCanvasDocuments(userId: string, limit: number = 50): Promise<CanvasDocument[]> {
        const result = await this.retryQuery(
            `SELECT * FROM canvas_documents WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
            [userId, limit]
        );
        return result.rows.map((row) => ({
            ...row,
            is_shared: !!row.is_shared
        }));
    }

    async shareCanvasDocument(documentId: string, shareToken: string): Promise<void> {
        await this.retryQuery(
            `UPDATE canvas_documents SET is_shared = TRUE, share_token = $1, updated_at = NOW() WHERE id = $2`,
            [shareToken, documentId]
        );
    }

    async getCanvasDocumentByShareToken(shareToken: string): Promise<CanvasDocument | undefined> {
        const result = await this.retryQuery(
            'SELECT * FROM canvas_documents WHERE share_token = $1 AND is_shared = TRUE',
            [shareToken]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_shared: !!row.is_shared
        };
    }

    async deleteCanvasDocument(documentId: string): Promise<void> {
        await this.retryQuery('DELETE FROM canvas_documents WHERE id = $1', [documentId]);
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
        metadata?: Record<string, any>;
    }): Promise<void> {
        await this.retryQuery(
            `INSERT INTO external_connections 
            (id, user_id, service_type, access_token, refresh_token, token_expires_at, account_email, account_name, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT(user_id, service_type) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                account_email = EXCLUDED.account_email,
                account_name = EXCLUDED.account_name,
                metadata = EXCLUDED.metadata,
                is_active = TRUE,
                updated_at = NOW()`,
            [
                params.id, params.userId, params.serviceType,
                params.accessToken, params.refreshToken, params.tokenExpiresAt,
                params.accountEmail, params.accountName,
                params.metadata ? JSON.stringify(params.metadata) : null
            ]
        );
    }

    async getUserConnections(userId: string): Promise<ExternalConnection[]> {
        const result = await this.retryQuery(
            `SELECT * FROM external_connections WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows.map((row) => ({
            ...row,
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        }));
    }

    async getExternalConnection(connectionId: string): Promise<ExternalConnection | undefined> {
        const result = await this.retryQuery('SELECT * FROM external_connections WHERE id = $1', [connectionId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        };
    }

    async getUserConnectionByService(userId: string, serviceType: ExternalServiceType): Promise<ExternalConnection | undefined> {
        const result = await this.retryQuery(
            'SELECT * FROM external_connections WHERE user_id = $1 AND service_type = $2 AND is_active = TRUE',
            [userId, serviceType]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        };
    }

    async updateConnectionTokens(connectionId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    }): Promise<void> {
        await this.retryQuery(
            `UPDATE external_connections 
            SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3, updated_at = NOW()
            WHERE id = $4`,
            [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, connectionId]
        );
    }

    async disconnectService(userId: string, serviceType: ExternalServiceType): Promise<void> {
        await this.retryQuery(
            `UPDATE external_connections 
            SET is_active = FALSE, access_token = NULL, refresh_token = NULL, updated_at = NOW()
            WHERE user_id = $1 AND service_type = $2`,
            [userId, serviceType]
        );
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
        await this.retryQuery(
            `INSERT INTO external_files 
            (id, connection_id, external_id, file_name, file_type, file_size, web_url, cached_content, last_synced)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT(connection_id, external_id) DO UPDATE SET
                file_name = EXCLUDED.file_name,
                file_type = EXCLUDED.file_type,
                file_size = EXCLUDED.file_size,
                web_url = EXCLUDED.web_url,
                cached_content = EXCLUDED.cached_content,
                last_synced = NOW()`,
            [
                params.id, params.connectionId, params.externalId,
                params.fileName, params.fileType, params.fileSize,
                params.webUrl, params.cachedContent
            ]
        );
    }

    async getConnectionFiles(connectionId: string, limit: number = 100): Promise<ExternalFile[]> {
        const result = await this.retryQuery(
            `SELECT * FROM external_files WHERE connection_id = $1 ORDER BY last_synced DESC LIMIT $2`,
            [connectionId, limit]
        );
        return result.rows as ExternalFile[];
    }

    async getCachedFile(connectionId: string, externalId: string): Promise<ExternalFile | undefined> {
        const result = await this.retryQuery(
            'SELECT * FROM external_files WHERE connection_id = $1 AND external_id = $2',
            [connectionId, externalId]
        );
        return result.rows[0] as ExternalFile | undefined;
    }

    // ============================================
    // 🔌 MCP 외부 서버 메서드
    // ============================================

    async getMcpServers(): Promise<MCPServerRow[]> {
        const result = await this.retryQuery(
            'SELECT * FROM mcp_servers ORDER BY created_at DESC'
        );
        return result.rows.map((row: DbRow) => ({
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled,
        })) as MCPServerRow[];
    }

    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        const result = await this.retryQuery(
            'SELECT * FROM mcp_servers WHERE id = $1',
            [id]
        );
        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled,
        } as MCPServerRow;
    }

    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        const result = await this.retryQuery(
            `INSERT INTO mcp_servers (id, name, transport_type, command, args, env, url, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                server.id, server.name, server.transport_type,
                server.command, server.args ? JSON.stringify(server.args) : null,
                server.env ? JSON.stringify(server.env) : null,
                server.url, server.enabled
            ]
        );
        const row = result.rows[0] as DbRow;
        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled,
        } as MCPServerRow;
    }

    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(updates.name);
        }
        if (updates.transport_type !== undefined) {
            sets.push(`transport_type = $${paramIdx++}`);
            params.push(updates.transport_type);
        }
        if (updates.command !== undefined) {
            sets.push(`command = $${paramIdx++}`);
            params.push(updates.command);
        }
        if (updates.args !== undefined) {
            sets.push(`args = $${paramIdx++}`);
            params.push(updates.args ? JSON.stringify(updates.args) : null);
        }
        if (updates.env !== undefined) {
            sets.push(`env = $${paramIdx++}`);
            params.push(updates.env ? JSON.stringify(updates.env) : null);
        }
        if (updates.url !== undefined) {
            sets.push(`url = $${paramIdx++}`);
            params.push(updates.url);
        }
        if (updates.enabled !== undefined) {
            sets.push(`enabled = $${paramIdx++}`);
            params.push(updates.enabled);
        }

        params.push(id);
        const result = await this.retryQuery(
            `UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled,
        } as MCPServerRow;
    }

    async deleteMcpServer(id: string): Promise<boolean> {
        const result = await this.retryQuery(
            'DELETE FROM mcp_servers WHERE id = $1',
            [id]
        );
        return (result.rowCount || 0) > 0;
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
        const result = await this.retryQuery(
            `INSERT INTO user_api_keys 
            (id, user_id, key_hash, key_prefix, last_4, name, description, scopes, allowed_models, rate_limit_tier, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                params.id, params.userId, params.keyHash, params.keyPrefix, params.last4,
                params.name, params.description || null,
                JSON.stringify(params.scopes || ['*']),
                JSON.stringify(params.allowedModels || ['*']),
                params.rateLimitTier || 'free',
                params.expiresAt || null
            ]
        );
        const row = result.rows[0];
        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        } as UserApiKey;
    }

    async getApiKeyByHash(keyHash: string): Promise<UserApiKey | undefined> {
        const result = await this.retryQuery(
            'SELECT * FROM user_api_keys WHERE key_hash = $1 AND is_active = TRUE',
            [keyHash]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        } as UserApiKey;
    }

    async getApiKeyById(keyId: string): Promise<UserApiKey | undefined> {
        const result = await this.retryQuery(
            'SELECT * FROM user_api_keys WHERE id = $1',
            [keyId]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        } as UserApiKey;
    }

    async listUserApiKeys(userId: string, options?: {
        includeInactive?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<UserApiKey[]> {
        let query = 'SELECT * FROM user_api_keys WHERE user_id = $1';
        const params: QueryParam[] = [userId];
        let paramIdx = 2;

        if (!options?.includeInactive) {
            query += ' AND is_active = TRUE';
        }

        query += ' ORDER BY created_at DESC';

        if (options?.limit) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(options.limit);
        }
        if (options?.offset) {
            query += ` OFFSET $${paramIdx++}`;
            params.push(options.offset);
        }

        const result = await this.retryQuery(query, params);
        return result.rows.map((row) => ({
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        })) as UserApiKey[];
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
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(updates.name);
        }
        if (updates.description !== undefined) {
            sets.push(`description = $${paramIdx++}`);
            params.push(updates.description);
        }
        if (updates.scopes !== undefined) {
            sets.push(`scopes = $${paramIdx++}`);
            params.push(JSON.stringify(updates.scopes));
        }
        if (updates.allowedModels !== undefined) {
            sets.push(`allowed_models = $${paramIdx++}`);
            params.push(JSON.stringify(updates.allowedModels));
        }
        if (updates.rateLimitTier !== undefined) {
            sets.push(`rate_limit_tier = $${paramIdx++}`);
            params.push(updates.rateLimitTier);
        }
        if (updates.isActive !== undefined) {
            sets.push(`is_active = $${paramIdx++}`);
            params.push(updates.isActive);
        }
        if (updates.expiresAt !== undefined) {
            sets.push(`expires_at = $${paramIdx++}`);
            params.push(updates.expiresAt);
        }

        params.push(keyId);
        const result = await this.retryQuery(
            `UPDATE user_api_keys SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        } as UserApiKey;
    }

    async deleteApiKey(keyId: string): Promise<boolean> {
        const result = await this.retryQuery(
            'DELETE FROM user_api_keys WHERE id = $1',
            [keyId]
        );
        return (result.rowCount || 0) > 0;
    }

    async rotateApiKey(keyId: string, newKeyHash: string, newLast4: string): Promise<UserApiKey | undefined> {
        const result = await this.retryQuery(
            `UPDATE user_api_keys 
            SET key_hash = $1, last_4 = $2, updated_at = NOW()
            WHERE id = $3 AND is_active = TRUE
            RETURNING *`,
            [newKeyHash, newLast4, keyId]
        );

        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        } as UserApiKey;
    }

    async recordApiKeyUsage(keyId: string, tokens: number): Promise<void> {
        await this.retryQuery(
            `UPDATE user_api_keys 
            SET total_requests = total_requests + 1, 
                total_tokens = total_tokens + $1,
                last_used_at = NOW()
            WHERE id = $2`,
            [tokens, keyId]
        );
    }

    async getApiKeyUsageStats(keyId: string): Promise<{
        totalRequests: number;
        totalTokens: number;
        lastUsedAt: string | null;
    } | undefined> {
        const result = await this.retryQuery(
            'SELECT total_requests, total_tokens, last_used_at FROM user_api_keys WHERE id = $1',
            [keyId]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            totalRequests: row.total_requests,
            totalTokens: row.total_tokens,
            lastUsedAt: row.last_used_at
        };
    }

    async countUserApiKeys(userId: string): Promise<number> {
        const result = await this.retryQuery(
            'SELECT COUNT(*) as count FROM user_api_keys WHERE user_id = $1 AND is_active = TRUE',
            [userId]
        );
        return parseInt(result.rows[0].count, 10);
    }

    // ===== 유틸리티 =====

    async close(): Promise<void> {
        await this.pool.end();
        console.log('[UnifiedDB] 연결 종료');
    }
}

// 싱글톤 인스턴스
let dbInstance: UnifiedDatabase | null = null;

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

export async function closeDatabase(): Promise<void> {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
    }
}
