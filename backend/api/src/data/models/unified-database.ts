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
import { DB_POOL_TIMEOUTS } from '../../config/timeouts';
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
import { LEGACY_SCHEMA } from './legacy-schema';

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
            statement_timeout: DB_POOL_TIMEOUTS.STATEMENT_TIMEOUT_MS,
            idleTimeoutMillis: DB_POOL_TIMEOUTS.IDLE_TIMEOUT_MS,
            connectionTimeoutMillis: DB_POOL_TIMEOUTS.CONNECTION_TIMEOUT_MS
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
