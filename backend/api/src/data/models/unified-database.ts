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
 * - Repository 위임 패턴 (User, Conversation, Memory, Research, ApiKey, Canvas, Marketplace, Audit)
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
    CanvasRepository,
    ConversationRepository,
    MarketplaceRepository,
    MemoryRepository,
    ResearchRepository,
    UserRepository
} from '../repositories';

const logger = createLogger('UnifiedDB');

/** SQL 쿼리 파라미터 타입 - $1, $2 등의 플레이스홀더에 바인딩되는 값 */
type QueryParam = string | number | boolean | null | undefined;

/** PostgreSQL 쿼리 결과 행의 제네릭 타입 */
type DbRow = Record<string, unknown>;

const SCHEMA_FILE_RELATIVE_PATH = 'services/database/init/002-schema.sql';

// Fallback schema for packaged/deployed environments where the SQL file is unavailable.
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
    user_id TEXT REFERENCES users(id),
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
CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_date ON api_usage(date);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON conversation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_anon ON conversation_sessions(anon_session_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at);
`;

/**
 * 사용자 엔티티 인터페이스
 * @interface User
 */
export interface User {
    /** 사용자 고유 식별자 (숫자 문자열) */
    id: string;
    /** 로그인 사용자명 (이메일과 동일) */
    username: string;
    /** bcrypt 해시된 비밀번호 */
    password_hash: string;
    /** 이메일 주소 (선택적) */
    email?: string;
    /** 사용자 역할 - admin: 관리자, user: 일반, guest: 게스트 */
    role: 'admin' | 'user' | 'guest';
    /** 계정 생성 일시 (ISO 8601) */
    created_at: string;
    /** 마지막 정보 수정 일시 (ISO 8601) */
    updated_at: string;
    /** 마지막 로그인 일시 (ISO 8601) */
    last_login?: string;
    /** 계정 활성화 상태 */
    is_active: boolean;
}

/**
 * 대화 세션 엔티티 인터페이스
 * @interface ConversationSession
 */
export interface ConversationSession {
    /** 세션 고유 식별자 (UUID) */
    id: string;
    /** 소유 사용자 ID (FK → users.id) */
    user_id?: string;
    /** 대화 제목 */
    title: string;
    /** 세션 생성 일시 (ISO 8601) */
    created_at: string;
    /** 마지막 업데이트 일시 (ISO 8601) */
    updated_at: string;
    /** 세션 메타데이터 (모델 정보, 설정 등 JSONB) */
    metadata?: Record<string, unknown> | null;
}

/**
 * 대화 메시지 엔티티 인터페이스
 * @interface ConversationMessage
 */
export interface ConversationMessage {
    /** 메시지 고유 식별자 (SERIAL) */
    id: number;
    /** 소속 세션 ID (FK → conversation_sessions.id) */
    session_id: string;
    /** 메시지 발화자 역할 */
    role: 'user' | 'assistant' | 'system';
    /** 메시지 본문 */
    content: string;
    /** 응답 생성에 사용된 모델명 */
    model?: string;
    /** 응답 생성에 사용된 에이전트 ID */
    agent_id?: string;
    /** AI의 사고 과정 (thinking mode 응답) */
    thinking?: string;
    /** 사용된 토큰 수 */
    tokens?: number;
    /** 응답 생성 시간 (밀리초) */
    response_time_ms?: number;
    /** 메시지 생성 일시 (ISO 8601) */
    created_at: string;
}

// ============================================
// 🧠 장기 메모리 시스템 인터페이스
// ============================================

export type MemoryCategory = 'preference' | 'fact' | 'project' | 'relationship' | 'skill' | 'context';

/**
 * 사용자 장기 메모리 엔티티
 * 대화에서 추출된 중요 정보를 저장하여 향후 대화에 재활용
 * @interface UserMemory
 */
export interface UserMemory {
    /** 메모리 고유 식별자 (UUID) */
    id: string;
    /** 소유 사용자 ID */
    user_id: string;
    /** 메모리 카테고리 (선호도, 사실, 프로젝트 등) */
    category: MemoryCategory;
    /** 메모리 키 (검색용 요약) */
    key: string;
    /** 메모리 값 (상세 내용) */
    value: string;
    /** 중요도 점수 (높을수록 우선 참조) */
    importance: number;
    /** 참조 횟수 */
    access_count: number;
    /** 마지막 참조 일시 */
    last_accessed?: string;
    /** 메모리 추출 원본 세션 ID */
    source_session_id?: string;
    /** 생성 일시 */
    created_at: string;
    /** 수정 일시 */
    updated_at: string;
    /** 만료 일시 (자동 삭제) */
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
    metadata?: Record<string, unknown>;
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

/**
 * 사용자 API Key 엔티티
 * 외부 개발자 API 접근을 위한 키 정보
 * @interface UserApiKey
 */
export interface UserApiKey {
    /** API Key 고유 식별자 (UUID) */
    id: string;
    /** 소유 사용자 ID */
    user_id: string;
    /** HMAC-SHA-256 해시된 키 (DB 저장용, 평문 복원 불가) */
    key_hash: string;
    /** 키 접두사 (omk_live_) */
    key_prefix: string;
    /** 키 마지막 4자리 (표시용) */
    last_4: string;
    /** 키 이름 (사용자 지정) */
    name: string;
    /** 키 설명 */
    description?: string;
    /** 허용된 스코프 목록 (예: ["chat:write", "models:read"]) */
    scopes: string[];
    /** 접근 허용된 모델 목록 */
    allowed_models: string[];
    /** Rate Limit 등급 (free/starter/standard/enterprise) */
    rate_limit_tier: ApiKeyTier;
    /** 키 활성화 상태 */
    is_active: boolean;
    /** 마지막 사용 일시 */
    last_used_at?: string;
    /** 키 만료 일시 */
    expires_at?: string;
    /** 생성 일시 */
    created_at: string;
    /** 수정 일시 */
    updated_at: string;
    /** 누적 요청 수 */
    total_requests: number;
    /** 누적 토큰 사용량 */
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
 *
 * 모든 도메인의 데이터 접근을 단일 진입점으로 제공합니다.
 * 내부적으로 Repository 패턴을 사용하여 각 도메인별 쿼리를 위임합니다.
 *
 * @class UnifiedDatabase
 * @description
 * - 서버 시작 시 스키마 자동 초기화 (SQL 파일 또는 LEGACY_SCHEMA 폴백)
 * - pg Pool 기반 커넥션 풀링 (statement_timeout: 30s, idle_timeout: 30s)
 * - 8개 Repository 위임: User, Conversation, Memory, Research, ApiKey, Canvas, Marketplace, Audit
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

    /** 캔버스 문서 데이터 접근 Repository */
    private readonly canvasRepository: CanvasRepository;

    /** 마켓플레이스 데이터 접근 Repository */
    private readonly marketplaceRepository: MarketplaceRepository;

    /** 감사 로그 및 외부 연동 데이터 접근 Repository */
    private readonly auditRepository: AuditRepository;

    constructor() {
        const poolConfig: PoolConfig & { idle_timeout: number } = {
            connectionString: getConfig().databaseUrl,
            statement_timeout: 30000,
            idle_timeout: 30000,
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
        this.canvasRepository = new CanvasRepository(this.pool);
        this.marketplaceRepository = new MarketplaceRepository(this.pool);
        this.auditRepository = new AuditRepository(this.pool);

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
        return withRetry(
            () => this.pool.query(text, params),
            { operation: text.substring(0, 50) }
        );
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

    async getAgentStats(agentId: string) {
        return this.auditRepository.getAgentStats(agentId);
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

    async getAuditLogs(limit: number = 100) {
        return this.auditRepository.getAuditLogs(limit);
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
    }): Promise<MarketplaceAgent> {
        return this.marketplaceRepository.publishToMarketplace(params);
    }

    async getMarketplaceAgents(options?: {
        category?: string;
        status?: MarketplaceStatus;
        featured?: boolean;
        search?: string;
        sortBy?: string;
        limit?: number;
        offset?: number;
    }): Promise<MarketplaceAgent[]> {
        return this.marketplaceRepository.getMarketplaceAgents(options);
    }

    async getMarketplaceAgent(marketplaceId: string): Promise<MarketplaceAgent | undefined> {
        return this.marketplaceRepository.getMarketplaceAgent(marketplaceId);
    }

    async updateMarketplaceStatus(marketplaceId: string, status: MarketplaceStatus): Promise<void> {
        return this.marketplaceRepository.updateMarketplaceStatus(marketplaceId, status);
    }

    async installAgent(marketplaceId: string, userId: string): Promise<void> {
        return this.marketplaceRepository.installAgent(marketplaceId, userId);
    }

    async uninstallAgent(marketplaceId: string, userId: string): Promise<void> {
        return this.marketplaceRepository.uninstallAgent(marketplaceId, userId);
    }

    async getUserInstalledAgents(userId: string): Promise<MarketplaceAgent[]> {
        return this.marketplaceRepository.getUserInstalledAgents(userId);
    }

    async addAgentReview(params: {
        id: string;
        marketplaceId: string;
        userId: string;
        rating: number;
        title?: string;
        content?: string;
    }): Promise<void> {
        return this.marketplaceRepository.addAgentReview(params);
    }

    async getAgentReviews(marketplaceId: string, limit: number = 20): Promise<AgentReview[]> {
        return this.marketplaceRepository.getAgentReviews(marketplaceId, limit);
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
        return this.canvasRepository.createCanvasDocument(params);
    }

    async getCanvasDocument(documentId: string): Promise<CanvasDocument | undefined> {
        return this.canvasRepository.getCanvasDocument(documentId);
    }

    async updateCanvasDocument(documentId: string, updates: {
        title?: string;
        content?: string;
        changeSummary?: string;
        updatedBy?: string;
    }): Promise<void> {
        return this.canvasRepository.updateCanvasDocument(documentId, updates);
    }

    async getCanvasVersions(documentId: string): Promise<CanvasVersion[]> {
        return this.canvasRepository.getCanvasVersions(documentId);
    }

    async getUserCanvasDocuments(userId: string, limit: number = 50): Promise<CanvasDocument[]> {
        return this.canvasRepository.getUserCanvasDocuments(userId, limit);
    }

    async shareCanvasDocument(documentId: string, shareToken: string): Promise<void> {
        return this.canvasRepository.shareCanvasDocument(documentId, shareToken);
    }

    async getCanvasDocumentByShareToken(shareToken: string): Promise<CanvasDocument | undefined> {
        return this.canvasRepository.getCanvasDocumentByShareToken(shareToken);
    }

    async deleteCanvasDocument(documentId: string): Promise<void> {
        return this.canvasRepository.deleteCanvasDocument(documentId);
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
        return this.auditRepository.createExternalConnection(params);
    }

    async getUserConnections(userId: string): Promise<ExternalConnection[]> {
        return this.auditRepository.getUserConnections(userId);
    }

    async getExternalConnection(connectionId: string): Promise<ExternalConnection | undefined> {
        return this.auditRepository.getExternalConnection(connectionId);
    }

    async getUserConnectionByService(userId: string, serviceType: ExternalServiceType): Promise<ExternalConnection | undefined> {
        return this.auditRepository.getUserConnectionByService(userId, serviceType);
    }

    async updateConnectionTokens(connectionId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    }): Promise<void> {
        return this.auditRepository.updateConnectionTokens(connectionId, tokens);
    }

    async disconnectService(userId: string, serviceType: ExternalServiceType): Promise<void> {
        return this.auditRepository.disconnectService(userId, serviceType);
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
        return this.auditRepository.cacheExternalFile(params);
    }

    async getConnectionFiles(connectionId: string, limit: number = 100): Promise<ExternalFile[]> {
        return this.auditRepository.getConnectionFiles(connectionId, limit);
    }

    async getCachedFile(connectionId: string, externalId: string): Promise<ExternalFile | undefined> {
        return this.auditRepository.getCachedFile(connectionId, externalId);
    }

    // ============================================
    // 🔌 MCP 외부 서버 메서드
    // ============================================

    async getMcpServers(): Promise<MCPServerRow[]> {
        return this.auditRepository.getMcpServers();
    }

    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        return this.auditRepository.getMcpServerById(id);
    }

    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        return this.auditRepository.createMcpServer(server);
    }

    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        return this.auditRepository.updateMcpServer(id, updates);
    }

    async deleteMcpServer(id: string): Promise<boolean> {
        return this.auditRepository.deleteMcpServer(id);
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
