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

import { Pool, type PoolConfig } from 'pg';
import { getConfig } from '../../config/env';
import { DB_POOL_TIMEOUTS } from '../../config/timeouts';
import { createLogger } from '../../utils/logger';
import {
    ApiKeyRepository,
    AuditRepository,
    ConversationRepository,
    ExternalRepository,
    ResearchRepository,
    AgentTaskRepository,
    UserRepository
} from '../repositories';
import { initSchema as initSchemaFn } from './schema-initializer';

const logger = createLogger('UnifiedDB');


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
    UserApiKey,
    UserApiKeyPublic,
    AgentTask,
    AgentTaskStatus,
    AgentTaskStep,
} from './unified-database.types';
import { API_KEY_LIMITS as _API_KEY_LIMITS } from './unified-database.types';

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
    UserApiKey,
    UserApiKeyPublic,
};
export { _API_KEY_LIMITS as API_KEY_LIMITS };

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

    /** 딥 리서치 데이터 접근 Repository */
    private readonly researchRepository: ResearchRepository;

    /** 자율 에이전트 작업 데이터 접근 Repository */
    private readonly agentTaskRepository: AgentTaskRepository;

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
        this.schemaReady = initSchemaFn(this.pool).catch((err: unknown) => {
            logger.error('[UnifiedDB] Schema init failed:', err);
        }) as Promise<void>;

        this.userRepository = new UserRepository(this.pool);
        this.conversationRepository = new ConversationRepository(this.pool);
        this.researchRepository = new ResearchRepository(this.pool);
        this.agentTaskRepository = new AgentTaskRepository(this.pool);
        this.apiKeyRepository = new ApiKeyRepository(this.pool);
        this.auditRepository = new AuditRepository(this.pool);
        this.externalRepository = new ExternalRepository(this.pool);

        logger.info('[UnifiedDB] PostgreSQL Pool initialized');
    }

    // initSchema / getSchemaSql 은 data/models/schema-initializer.ts 로 분리.

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

    // retryQuery 는 모든 사용처가 repository 위임으로 이행되어 dead code — 제거.
    // base-repository.ts 의 query() 가 동일한 withRetry 패턴 제공.

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
    // 장기 메모리 시스템 메서드: 2026-05-19 제거 (MemoryService 폐기)

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

    // 🤖 자율 에이전트 작업 메서드

    async createAgentTask(params: {
        id: string;
        userId?: string;
        goal: string;
        maxTurns?: number;
        model?: string;
        inputFiles?: unknown;
        inputImages?: unknown;
        gitRepoUrl?: string; gitBranch?: string;
    }): Promise<void> {
        return this.agentTaskRepository.createAgentTask(params);
    }

    async getAgentTask(taskId: string): Promise<AgentTask | undefined> {
        return this.agentTaskRepository.getAgentTask(taskId);
    }

    async updateAgentTask(taskId: string, updates: {
        status?: AgentTaskStatus;
        progress?: number;
        currentTurn?: number;
        result?: string;
        error?: string;
        checkpoint?: unknown;
        sandboxContainerId?: string;
        workspacePath?: string;
        plan?: unknown;
        totalTokens?: number;
    }): Promise<void> {
        return this.agentTaskRepository.updateAgentTask(taskId, updates);
    }

    async addAgentTaskStep(params: {
        taskId: string;
        stepNumber: number;
        stepType: string;
        toolName?: string;
        content?: string;
        messagesSnapshot?: unknown;
        status?: string;
    }): Promise<void> {
        return this.agentTaskRepository.addAgentTaskStep(params);
    }

    async getAgentTaskSteps(taskId: string): Promise<AgentTaskStep[]> {
        return this.agentTaskRepository.getAgentTaskSteps(taskId);
    }

    async deleteAgentTaskSteps(taskId: string): Promise<void> {
        return this.agentTaskRepository.deleteAgentTaskSteps(taskId);
    }

    async getUserAgentTasks(userId: string, limit: number = 20): Promise<AgentTask[]> {
        return this.agentTaskRepository.getUserAgentTasks(userId, limit);
    }

    async deleteAgentTask(taskId: string): Promise<void> {
        return this.agentTaskRepository.deleteAgentTaskWithSteps(taskId);
    }

    // 🔗 외부 서비스 통합 메서드

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

    async getGlobalMcpServers(): Promise<MCPServerRow[]> {
        return this.externalRepository.getGlobalMcpServers();
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
