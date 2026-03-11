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
    FeedbackRepository,
    KBRepository,
    MemoryRepository,
    ResearchRepository,
    SkillRepository,
    UserRepository,
    VectorRepository
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
 * - 10개 Repository 위임: User, Conversation, Memory, Research, ApiKey, Audit, External, Feedback, Skill, Vector, KB
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

    /** 피드백 데이터 접근 Repository */
    private readonly feedbackRepository: FeedbackRepository;

    /** 스킬 데이터 접근 Repository */
    private readonly skillRepository: SkillRepository;

    /** 벡터 임베딩 데이터 접근 Repository */
    private readonly vectorRepository: VectorRepository;

    /** 지식 베이스 데이터 접근 Repository */
    private readonly kbRepository: KBRepository;

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
        this.feedbackRepository = new FeedbackRepository(this.pool);
        this.skillRepository = new SkillRepository(this.pool);
        this.vectorRepository = new VectorRepository(this.pool);
        this.kbRepository = new KBRepository(this.pool);

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

    // ============================================
    // Repository Accessor Getters
    // ============================================

    /** @returns UserRepository for user data access */
    get users(): UserRepository {
        return this.userRepository;
    }

    /** @returns ConversationRepository for session/message data access */
    get conversations(): ConversationRepository {
        return this.conversationRepository;
    }

    /** @returns MemoryRepository for long-term memory data access */
    get memories(): MemoryRepository {
        return this.memoryRepository;
    }

    /** @returns SkillRepository for agent skill data access */
    get skills(): SkillRepository {
        return this.skillRepository;
    }

    /** @returns ApiKeyRepository for API key data access */
    get apiKeys(): ApiKeyRepository {
        return this.apiKeyRepository;
    }

    /** @returns AuditRepository for audit log data access */
    get audit(): AuditRepository {
        return this.auditRepository;
    }

    /** @returns FeedbackRepository for feedback data access */
    get feedback(): FeedbackRepository {
        return this.feedbackRepository;
    }

    /** @returns ResearchRepository for deep research data access */
    get research(): ResearchRepository {
        return this.researchRepository;
    }

    /** @returns VectorRepository for vector embedding data access */
    get vectors(): VectorRepository {
        return this.vectorRepository;
    }

    /** @returns KBRepository for knowledge base data access */
    get kb(): KBRepository {
        return this.kbRepository;
    }

    /** @returns ExternalRepository for external connections and MCP servers */
    get external(): ExternalRepository {
        return this.externalRepository;
    }

    // ===== 사용자 관리 =====

    /** @deprecated Use db.users.createUser() instead */
    async createUser(id: string, username: string, passwordHash: string, email?: string, role: string = 'user') {
        return this.userRepository.createUser(id, username, passwordHash, email, role);
    }

    /** @deprecated Use db.users.getUserByUsername() instead */
    async getUserByUsername(username: string): Promise<User | undefined> {
        return this.userRepository.getUserByUsername(username);
    }

    /** @deprecated Use db.users.getUserById() instead */
    async getUserById(id: string): Promise<User | undefined> {
        return this.userRepository.getUserById(id);
    }

    /** @deprecated Use db.users.updateLastLogin() instead */
    async updateLastLogin(userId: string) {
        return this.userRepository.updateLastLogin(userId);
    }

    /** @deprecated Use db.users.getAllUsers() instead */
    async getAllUsers(limit: number = 50): Promise<User[]> {
        return this.userRepository.getAllUsers(limit);
    }

    // ===== 대화 관리 =====

    /** @deprecated Use db.conversations.createSession() instead */
    async createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null) {
        return this.conversationRepository.createSessionRaw(id, userId, title, metadata);
    }

    /** @deprecated Use db.conversations.addMessageRaw() instead */
    async addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }) {
        return this.conversationRepository.addMessageRaw(sessionId, role, content, options);
    }

    /** @deprecated Use db.conversations.getSessionMessages() instead */
    async getSessionMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        return this.conversationRepository.getSessionMessages(sessionId, limit);
    }

    /** @deprecated Use db.conversations.getUserSessions() instead */
    async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        return this.conversationRepository.getUserSessions(userId, limit);
    }

    /** @deprecated Use db.conversations.getAllSessions() instead */
    async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        return this.conversationRepository.getAllSessions(limit);
    }

    /** @deprecated Use db.conversations.deleteSession() instead */
    async deleteSession(sessionId: string) {
        return this.conversationRepository.deleteSession(sessionId);
    }

    // ===== API 사용량 관리 =====

    /** @deprecated Use db.apiKeys.recordApiUsage() instead */
    async recordApiUsage(date: string, apiKeyId: string, requests: number, tokens: number, errors: number, avgResponseTime: number, models: Record<string, unknown>) {
        return this.apiKeyRepository.recordApiUsage(date, apiKeyId, requests, tokens, errors, avgResponseTime, models);
    }

    /** @deprecated Use db.apiKeys.getDailyUsage() instead */
    async getDailyUsage(days: number = 7) {
        return this.apiKeyRepository.getDailyUsage(days);
    }

    // ===== 에이전트 로그 =====

    /** @deprecated Use db.audit.logAgentUsage() instead */
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

    /** @deprecated Use db.audit.getAgentStats() instead */
    async getAgentStats(agentId: string, userId?: string) {
        return this.auditRepository.getAgentStats(agentId, userId);
    }

    // ===== 감사 로그 =====

    /** @deprecated Use db.audit.logAudit() instead */
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

    /** @deprecated Use db.audit.getAuditLogs() instead */
    async getAuditLogs(limit: number = 100, userId?: string) {
        return this.auditRepository.getAuditLogs(limit, userId);
    }

    // ===== 통계 =====

    /** @deprecated Use db.audit.getStats() instead */
    async getStats() {
        return this.auditRepository.getStats();
    }

    // ============================================
    // 🧠 장기 메모리 시스템 메서드
    // ============================================

    /** @deprecated Use db.memories.createMemory() instead */
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

    /** @deprecated Use db.memories.getUserMemories() instead */
    async getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): Promise<UserMemory[]> {
        return this.memoryRepository.getUserMemories(userId, options);
    }

    /** @deprecated Use db.memories.getRelevantMemories() instead */
    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        return this.memoryRepository.getRelevantMemories(userId, query, limit);
    }

    /** @deprecated Use db.memories.updateMemory() instead */
    async updateMemory(memoryId: string, updates: { value?: string; importance?: number }): Promise<void> {
        return this.memoryRepository.updateMemory(memoryId, updates);
    }

    /** @deprecated Use db.memories.deleteMemory() instead */
    async deleteMemory(memoryId: string): Promise<void> {
        return this.memoryRepository.deleteMemory(memoryId);
    }

    /** @deprecated Use db.memories.deleteUserMemories() instead */
    async deleteUserMemories(userId: string): Promise<void> {
        return this.memoryRepository.deleteUserMemories(userId);
    }

    /** @deprecated Use db.memories.getOwnerUserId() instead */
    async getMemoryOwner(memoryId: string): Promise<string | null> {
        return this.memoryRepository.getOwnerUserId(memoryId);
    }

    /** @deprecated Use db.memories.cleanupExpiredMemories() instead */
    async cleanupExpiredMemories(): Promise<number> {
        return this.memoryRepository.cleanupExpiredMemories();
    }

    /** @deprecated Use db.memories.decayImportance() instead */
    async decayMemoryImportance(): Promise<number> {
        return this.memoryRepository.decayImportance();
    }

    // ============================================
    // 🔍 Deep Research 메서드
    // ============================================

    /** @deprecated Use db.research.createResearchSession() instead */
    async createResearchSession(params: {
        id: string;
        userId?: string;
        topic: string;
        depth?: ResearchDepth;
    }): Promise<void> {
        return this.researchRepository.createResearchSession(params);
    }

    /** @deprecated Use db.research.getResearchSession() instead */
    async getResearchSession(sessionId: string): Promise<ResearchSession | undefined> {
        return this.researchRepository.getResearchSession(sessionId);
    }

    /** @deprecated Use db.research.updateResearchSession() instead */
    async updateResearchSession(sessionId: string, updates: {
        status?: ResearchStatus;
        progress?: number;
        summary?: string;
        keyFindings?: string[];
        sources?: string[];
    }): Promise<void> {
        return this.researchRepository.updateResearchSession(sessionId, updates);
    }

    /** @deprecated Use db.research.addResearchStep() instead */
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

    /** @deprecated Use db.research.getResearchSteps() instead */
    async getResearchSteps(sessionId: string): Promise<ResearchStep[]> {
        return this.researchRepository.getResearchSteps(sessionId);
    }

    /** @deprecated Use db.research.getUserResearchSessions() instead */
    async getUserResearchSessions(userId: string, limit: number = 20): Promise<ResearchSession[]> {
        return this.researchRepository.getUserResearchSessions(userId, limit);
    }

    /** @deprecated Use db.research.deleteSessionWithSteps() instead */
    async deleteResearchSession(sessionId: string): Promise<void> {
        return this.researchRepository.deleteSessionWithSteps(sessionId);
    }

    // ============================================
    // 🔗 외부 서비스 통합 메서드
    // ============================================

    /** @deprecated Use db.external.createExternalConnection() instead */
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

    /** @deprecated Use db.external.getUserConnections() instead */
    async getUserConnections(userId: string): Promise<ExternalConnection[]> {
        return this.externalRepository.getUserConnections(userId);
    }

    /** @deprecated Use db.external.getExternalConnection() instead */
    async getExternalConnection(connectionId: string): Promise<ExternalConnection | undefined> {
        return this.externalRepository.getExternalConnection(connectionId);
    }

    /** @deprecated Use db.external.getUserConnectionByService() instead */
    async getUserConnectionByService(userId: string, serviceType: ExternalServiceType): Promise<ExternalConnection | undefined> {
        return this.externalRepository.getUserConnectionByService(userId, serviceType);
    }

    /** @deprecated Use db.external.updateConnectionTokens() instead */
    async updateConnectionTokens(connectionId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    }): Promise<void> {
        return this.externalRepository.updateConnectionTokens(connectionId, tokens);
    }

    /** @deprecated Use db.external.disconnectService() instead */
    async disconnectService(userId: string, serviceType: ExternalServiceType): Promise<void> {
        return this.externalRepository.disconnectService(userId, serviceType);
    }

    /** @deprecated Use db.external.cacheExternalFile() instead */
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

    /** @deprecated Use db.external.getConnectionFiles() instead */
    async getConnectionFiles(connectionId: string, limit: number = 100): Promise<ExternalFile[]> {
        return this.externalRepository.getConnectionFiles(connectionId, limit);
    }

    /** @deprecated Use db.external.getCachedFile() instead */
    async getCachedFile(connectionId: string, externalId: string): Promise<ExternalFile | undefined> {
        return this.externalRepository.getCachedFile(connectionId, externalId);
    }

    // ============================================
    // 🔌 MCP 외부 서버 메서드
    // ============================================

    /** @deprecated Use db.external.getMcpServers() instead */
    async getMcpServers(): Promise<MCPServerRow[]> {
        return this.externalRepository.getMcpServers();
    }

    /** @deprecated Use db.external.getMcpServerById() instead */
    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        return this.externalRepository.getMcpServerById(id);
    }

    /** @deprecated Use db.external.createMcpServer() instead */
    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        return this.externalRepository.createMcpServer(server);
    }

    /** @deprecated Use db.external.updateMcpServer() instead */
    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        return this.externalRepository.updateMcpServer(id, updates);
    }

    /** @deprecated Use db.external.deleteMcpServer() instead */
    async deleteMcpServer(id: string): Promise<boolean> {
        return this.externalRepository.deleteMcpServer(id);
    }

    // ============================================
    // 🔑 API Key 관리 메서드
    // ============================================

    /** @deprecated Use db.apiKeys.createApiKey() instead */
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

    /** @deprecated Use db.apiKeys.getApiKeyByHash() instead */
    async getApiKeyByHash(keyHash: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.getApiKeyByHash(keyHash);
    }

    /** @deprecated Use db.apiKeys.getApiKeyById() instead */
    async getApiKeyById(keyId: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.getApiKeyById(keyId);
    }

    /** @deprecated Use db.apiKeys.listUserApiKeys() instead */
    async listUserApiKeys(userId: string, options?: {
        includeInactive?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<UserApiKey[]> {
        return this.apiKeyRepository.listUserApiKeys(userId, options);
    }

    /** @deprecated Use db.apiKeys.updateApiKey() instead */
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

    /** @deprecated Use db.apiKeys.deleteApiKey() instead */
    async deleteApiKey(keyId: string): Promise<boolean> {
        return this.apiKeyRepository.deleteApiKey(keyId);
    }

    /** @deprecated Use db.apiKeys.rotateApiKey() instead */
    async rotateApiKey(keyId: string, newKeyHash: string, newLast4: string): Promise<UserApiKey | undefined> {
        return this.apiKeyRepository.rotateApiKey(keyId, newKeyHash, newLast4);
    }

    /** @deprecated Use db.apiKeys.recordApiKeyUsage() instead */
    async recordApiKeyUsage(keyId: string, tokens: number): Promise<void> {
        return this.apiKeyRepository.recordApiKeyUsage(keyId, tokens);
    }

    /** @deprecated Use db.apiKeys.getApiKeyUsageStats() instead */
    async getApiKeyUsageStats(keyId: string): Promise<{
        totalRequests: number;
        totalTokens: number;
        lastUsedAt: string | null;
    } | undefined> {
        return this.apiKeyRepository.getApiKeyUsageStats(keyId);
    }

    /** @deprecated Use db.apiKeys.countUserApiKeys() instead */
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
