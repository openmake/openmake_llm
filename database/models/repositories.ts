/**
 * #11 개선: Repository 패턴 도메인별 분리
 * 
 * UnifiedDatabase의 God Class를 도메인별 Repository 파사드로 분리합니다.
 * 기존 UnifiedDatabase는 그대로 유지하되, 외부에서는 Repository를 통해 접근합니다.
 * 
 * 사용법:
 * ```typescript
 * const repos = getRepositories();
 * const user = repos.users.getById('user-1');
 * const sessions = repos.conversations.getUserSessions('user-1');
 * const memories = repos.memory.getUserMemories('user-1');
 * ```
 */

import {
    getUnifiedDatabase,
    UnifiedDatabase,
    User,
    ConversationSession,
    ConversationMessage,
    UserMemory,
    MemoryCategory,
    ResearchSession,
    ResearchStep,
    ResearchDepth,
    ResearchStatus,
    MarketplaceAgent,
    MarketplaceStatus,
    AgentReview,
    CanvasDocument,
    CanvasDocType,
    CanvasVersion,
    ExternalConnection,
    ExternalServiceType,
    ExternalFile
} from './unified-database';

// ===== User Repository =====
export class UserRepository {
    constructor(private db: UnifiedDatabase) {}

    create(id: string, username: string, passwordHash: string, email?: string, role?: string) {
        return this.db.createUser(id, username, passwordHash, email, role);
    }
    getByUsername(username: string): User | undefined {
        return this.db.getUserByUsername(username);
    }
    getById(id: string): User | undefined {
        return this.db.getUserById(id);
    }
    updateLastLogin(userId: string) {
        return this.db.updateLastLogin(userId);
    }
    getAll(limit?: number): User[] {
        return this.db.getAllUsers(limit);
    }
}

// ===== Conversation Repository =====
export class ConversationRepository {
    constructor(private db: UnifiedDatabase) {}

    createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown>) {
        return this.db.createSession(id, userId, title, metadata);
    }
    addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string; agentId?: string; thinking?: string; tokens?: number; responseTimeMs?: number;
    }) {
        return this.db.addMessage(sessionId, role, content, options);
    }
    getSessionMessages(sessionId: string, limit?: number): ConversationMessage[] {
        return this.db.getSessionMessages(sessionId, limit);
    }
    getUserSessions(userId: string, limit?: number): ConversationSession[] {
        return this.db.getUserSessions(userId, limit);
    }
    getAllSessions(limit?: number): ConversationSession[] {
        return this.db.getAllSessions(limit);
    }
    deleteSession(sessionId: string) {
        return this.db.deleteSession(sessionId);
    }
}

// ===== Memory Repository =====
export class MemoryRepository {
    constructor(private db: UnifiedDatabase) {}

    create(params: {
        id: string; userId: string; category: MemoryCategory; key: string; value: string;
        importance?: number; sourceSessionId?: string; expiresAt?: string; tags?: string[];
    }) {
        return this.db.createMemory(params);
    }
    getUserMemories(userId: string, options?: {
        category?: MemoryCategory; limit?: number; minImportance?: number;
    }): UserMemory[] {
        return this.db.getUserMemories(userId, options);
    }
    getRelevantMemories(userId: string, query: string, limit?: number): UserMemory[] {
        return this.db.getRelevantMemories(userId, query, limit);
    }
    update(memoryId: string, updates: { value?: string; importance?: number }) {
        return this.db.updateMemory(memoryId, updates);
    }
    delete(memoryId: string) {
        return this.db.deleteMemory(memoryId);
    }
    deleteAll(userId: string) {
        return this.db.deleteUserMemories(userId);
    }
}

// ===== Research Repository =====
export class ResearchRepository {
    constructor(private db: UnifiedDatabase) {}

    createSession(params: { id: string; userId?: string; topic: string; depth?: ResearchDepth }) {
        return this.db.createResearchSession(params);
    }
    updateSession(sessionId: string, updates: {
        status?: ResearchStatus; progress?: number; summary?: string;
        keyFindings?: string[]; sources?: Array<Record<string, unknown>>;
    }) {
        return this.db.updateResearchSession(sessionId, updates);
    }
    addStep(params: {
        sessionId: string; stepNumber: number; stepType: string;
        query?: string; result?: string; sources?: Array<Record<string, unknown>>; status?: string;
    }) {
        return this.db.addResearchStep(params);
    }
    getSession(sessionId: string): ResearchSession | undefined {
        return this.db.getResearchSession(sessionId);
    }
    getSteps(sessionId: string): ResearchStep[] {
        return this.db.getResearchSteps(sessionId);
    }
    getUserSessions(userId: string, limit?: number): ResearchSession[] {
        return this.db.getUserResearchSessions(userId, limit);
    }
}

// ===== Marketplace Repository =====
export class MarketplaceRepository {
    constructor(private db: UnifiedDatabase) {}

    publish(params: {
        id: string; agentId: string; authorId: string; title: string;
        description?: string; longDescription?: string; category?: string;
        tags?: string[]; icon?: string; price?: number;
    }) {
        return this.db.publishAgentToMarketplace(params);
    }
    getAgents(options?: {
        category?: string; featured?: boolean; status?: MarketplaceStatus;
        search?: string; limit?: number; offset?: number; sortBy?: 'downloads' | 'rating' | 'newest';
    }): MarketplaceAgent[] {
        return this.db.getMarketplaceAgents(options);
    }
    install(marketplaceId: string, userId: string) {
        return this.db.installAgent(marketplaceId, userId);
    }
    addReview(params: {
        id: string; marketplaceId: string; userId: string; rating: number; title?: string; content?: string;
    }) {
        return this.db.addAgentReview(params);
    }
    getReviews(marketplaceId: string, limit?: number): AgentReview[] {
        return this.db.getAgentReviews(marketplaceId, limit);
    }
    getUserInstalled(userId: string): MarketplaceAgent[] {
        return this.db.getUserInstalledAgents(userId);
    }
}

// ===== Canvas Repository =====
export class CanvasRepository {
    constructor(private db: UnifiedDatabase) {}

    createDocument(params: {
        id: string; userId: string; sessionId?: string; title: string;
        docType?: CanvasDocType; content?: string; language?: string;
    }) {
        return this.db.createCanvasDocument(params);
    }
    updateDocument(documentId: string, updates: {
        title?: string; content?: string; changeSummary?: string; updatedBy?: string;
    }) {
        return this.db.updateCanvasDocument(documentId, updates);
    }
    getDocument(documentId: string): CanvasDocument | undefined {
        return this.db.getCanvasDocument(documentId);
    }
    getByShareToken(shareToken: string): CanvasDocument | undefined {
        return this.db.getCanvasDocumentByShareToken(shareToken);
    }
    getUserDocuments(userId: string, limit?: number): CanvasDocument[] {
        return this.db.getUserCanvasDocuments(userId, limit);
    }
    getVersions(documentId: string): CanvasVersion[] {
        return this.db.getCanvasVersions(documentId);
    }
    share(documentId: string, shareToken: string) {
        return this.db.shareCanvasDocument(documentId, shareToken);
    }
    unshare(documentId: string) {
        return this.db.unshareCanvasDocument(documentId);
    }
}

// ===== External Connections Repository =====
export class ExternalConnectionRepository {
    constructor(private db: UnifiedDatabase) {}

    create(params: {
        id: string; userId: string; serviceType: ExternalServiceType;
        accessToken?: string; refreshToken?: string; tokenExpiresAt?: string;
        accountEmail?: string; accountName?: string; metadata?: Record<string, unknown>;
    }) {
        return this.db.createExternalConnection(params);
    }
    getUserConnections(userId: string): ExternalConnection[] {
        return this.db.getUserConnections(userId);
    }
    getConnection(userId: string, serviceType: ExternalServiceType): ExternalConnection | undefined {
        return this.db.getConnection(userId, serviceType);
    }
    updateTokens(connectionId: string, params: {
        accessToken: string; refreshToken?: string; tokenExpiresAt?: string;
    }) {
        return this.db.updateConnectionTokens(connectionId, params);
    }
    disconnect(userId: string, serviceType: ExternalServiceType) {
        return this.db.disconnectService(userId, serviceType);
    }
    addFile(params: {
        id: string; connectionId: string; externalId: string; fileName: string;
        fileType?: string; fileSize?: number; webUrl?: string; cachedContent?: string;
    }) {
        return this.db.addExternalFile(params);
    }
    getFiles(connectionId: string): ExternalFile[] {
        return this.db.getExternalFiles(connectionId);
    }
}

// ===== Repository Container =====
export interface Repositories {
    users: UserRepository;
    conversations: ConversationRepository;
    memory: MemoryRepository;
    research: ResearchRepository;
    marketplace: MarketplaceRepository;
    canvas: CanvasRepository;
    externalConnections: ExternalConnectionRepository;
}

let _repos: Repositories | null = null;

/**
 * Repository 컨테이너 싱글톤 획득
 * 
 * @example
 * ```typescript
 * const repos = getRepositories();
 * const user = repos.users.getById('user-1');
 * ```
 */
export function getRepositories(dataDir?: string): Repositories {
    if (!_repos) {
        const db = getUnifiedDatabase(dataDir);
        _repos = {
            users: new UserRepository(db),
            conversations: new ConversationRepository(db),
            memory: new MemoryRepository(db),
            research: new ResearchRepository(db),
            marketplace: new MarketplaceRepository(db),
            canvas: new CanvasRepository(db),
            externalConnections: new ExternalConnectionRepository(db),
        };
    }
    return _repos;
}
