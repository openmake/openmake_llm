/**
 * @fileoverview 통합 데이터베이스 모델
 * 
 * OpenMake LLM 플랫폼의 모든 데이터를 단일 SQLite 데이터베이스로 관리합니다.
 * 
 * ## 주요 기능
 * - 사용자 관리 (인증, 권한)
 * - 대화 세션 및 메시지 관리
 * - API 사용량 추적
 * - 에이전트 사용 로그 및 피드백
 * - 장기 메모리 시스템 (사용자별 컨텍스트 저장)
 * - Deep Research 세션 관리
 * - 에이전트 마켓플레이스
 * - Canvas 협업 문서
 * - 외부 서비스 연동 (Google Drive, Notion, GitHub 등)
 * 
 * @module database/unified-database
 * 
 * @example
 * ```typescript
 * import { getUnifiedDatabase, closeDatabase } from './unified-database';
 * 
 * const db = getUnifiedDatabase('./data');
 * 
 * // 사용자 생성
 * db.createUser('user-1', 'john', 'hashedPassword', 'john@example.com');
 * 
 * // 대화 세션 생성
 * db.createSession('session-1', 'user-1', '첫 번째 대화');
 * db.addMessage('session-1', 'user', '안녕하세요');
 * 
 * // 종료 시
 * closeDatabase();
 * ```
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { encrypt, decrypt } from './crypto-utils';

// 데이터베이스 스키마
const SCHEMA = `
-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active INTEGER DEFAULT 1
);

-- 대화 세션 테이블
CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 대화 메시지 테이블
CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    agent_id TEXT,
    thinking TEXT,
    tokens INTEGER,
    response_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);

-- API 사용량 테이블
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    api_key_id TEXT,
    requests INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    avg_response_time REAL DEFAULT 0,
    models JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, api_key_id)
);

-- 에이전트 사용 로그 테이블
CREATE TABLE IF NOT EXISTS agent_usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    session_id TEXT,
    agent_id TEXT NOT NULL,
    query TEXT,
    response_preview TEXT,
    response_time_ms INTEGER,
    tokens_used INTEGER,
    success INTEGER DEFAULT 1,
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
    tags JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 커스텀 에이전트 테이블
CREATE TABLE IF NOT EXISTS custom_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    keywords JSON,
    category TEXT,
    emoji TEXT DEFAULT '🤖',
    temperature REAL,
    max_tokens INTEGER,
    created_by TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 시스템 감사 로그 테이블
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action TEXT NOT NULL,
    user_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    details JSON,
    ip_address TEXT,
    user_agent TEXT
);

-- 알림 히스토리 테이블
CREATE TABLE IF NOT EXISTS alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    data JSON,
    acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME
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

-- 🔒 추가 인덱스 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON conversation_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON conversation_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_custom_agents_enabled ON custom_agents(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_severity ON alert_history(severity);
CREATE INDEX IF NOT EXISTS idx_alert_created ON alert_history(created_at);

-- ============================================
-- 🧠 장기 메모리 시스템 테이블
-- ============================================

-- 사용자 메모리 테이블 (세션 간 기억)
CREATE TABLE IF NOT EXISTS user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('preference', 'fact', 'project', 'relationship', 'skill', 'context')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    last_accessed DATETIME,
    source_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_session_id) REFERENCES conversation_sessions(id),
    UNIQUE(user_id, category, key)
);

-- 메모리 태그 테이블
CREATE TABLE IF NOT EXISTS memory_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE,
    UNIQUE(memory_id, tag)
);

-- 메모리 인덱스
CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON user_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON user_memories(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

-- ============================================
-- 🔍 Deep Research 테이블
-- ============================================

-- 리서치 세션 테이블
CREATE TABLE IF NOT EXISTS research_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    depth TEXT DEFAULT 'standard' CHECK(depth IN ('quick', 'standard', 'deep')),
    progress INTEGER DEFAULT 0,
    summary TEXT,
    key_findings JSON,
    sources JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 리서치 단계 테이블
CREATE TABLE IF NOT EXISTS research_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    query TEXT,
    result TEXT,
    sources JSON,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES research_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_user ON research_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_research_status ON research_sessions(status);
CREATE INDEX IF NOT EXISTS idx_research_steps_session ON research_steps(session_id);

-- ============================================
-- 🏪 Custom Agent 마켓플레이스 테이블
-- ============================================

-- 에이전트 마켓플레이스 테이블 (공유된 에이전트)
CREATE TABLE IF NOT EXISTS agent_marketplace (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    long_description TEXT,
    category TEXT,
    tags JSON,
    icon TEXT DEFAULT '🤖',
    banner_url TEXT,
    price REAL DEFAULT 0,
    is_free INTEGER DEFAULT 1,
    is_featured INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    version TEXT DEFAULT '1.0.0',
    changelog TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    FOREIGN KEY (agent_id) REFERENCES custom_agents(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);

-- 에이전트 리뷰 테이블
CREATE TABLE IF NOT EXISTS agent_reviews (
    id TEXT PRIMARY KEY,
    marketplace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    title TEXT,
    content TEXT,
    helpful_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (marketplace_id) REFERENCES agent_marketplace(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(marketplace_id, user_id)
);

-- 에이전트 설치 기록
CREATE TABLE IF NOT EXISTS agent_installations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    uninstalled_at DATETIME,
    FOREIGN KEY (marketplace_id) REFERENCES agent_marketplace(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(marketplace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_category ON agent_marketplace(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_featured ON agent_marketplace(is_featured);
CREATE INDEX IF NOT EXISTS idx_marketplace_downloads ON agent_marketplace(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_rating ON agent_marketplace(rating_avg DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_marketplace ON agent_reviews(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_installations_user ON agent_installations(user_id);

-- ============================================
-- 📝 Canvas 협업 도구 테이블
-- ============================================

-- Canvas 문서 테이블
CREATE TABLE IF NOT EXISTS canvas_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    title TEXT NOT NULL,
    doc_type TEXT DEFAULT 'document' CHECK(doc_type IN ('document', 'code', 'diagram', 'table')),
    content TEXT,
    language TEXT,
    version INTEGER DEFAULT 1,
    is_shared INTEGER DEFAULT 0,
    share_token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);

-- Canvas 버전 히스토리
CREATE TABLE IF NOT EXISTS canvas_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    change_summary TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES canvas_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Canvas AI 수정 요청
CREATE TABLE IF NOT EXISTS canvas_ai_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    instruction TEXT NOT NULL,
    original_content TEXT,
    modified_content TEXT,
    accepted INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES canvas_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_user ON canvas_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_canvas_shared ON canvas_documents(is_shared);
CREATE INDEX IF NOT EXISTS idx_canvas_versions_doc ON canvas_versions(document_id);

-- ============================================
-- 🔗 외부 서비스 통합 테이블
-- ============================================

-- 외부 서비스 연결
CREATE TABLE IF NOT EXISTS external_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    service_type TEXT NOT NULL CHECK(service_type IN ('google_drive', 'notion', 'github', 'slack', 'dropbox')),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at DATETIME,
    account_email TEXT,
    account_name TEXT,
    metadata JSON,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, service_type)
);

-- 외부 파일 참조
CREATE TABLE IF NOT EXISTS external_files (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    web_url TEXT,
    last_synced DATETIME,
    cached_content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (connection_id) REFERENCES external_connections(id) ON DELETE CASCADE,
    UNIQUE(connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_user ON external_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_service ON external_connections(service_type);
CREATE INDEX IF NOT EXISTS idx_external_files_connection ON external_files(connection_id);
`;

/**
 * 사용자 정보 인터페이스
 */
export interface User {
    /** 사용자 고유 ID (UUID) */
    id: string;
    /** 로그인용 사용자명 (고유) */
    username: string;
    /** 해시된 비밀번호 */
    password_hash: string;
    /** 이메일 주소 (선택) */
    email?: string;
    /** 사용자 역할 */
    role: 'admin' | 'user' | 'guest';
    /** 계정 생성 시각 */
    created_at: string;
    /** 마지막 정보 수정 시각 */
    updated_at: string;
    /** 마지막 로그인 시각 */
    last_login?: string;
    /** 계정 활성화 상태 */
    is_active: boolean;
}

/**
 * 대화 세션 인터페이스
 * #12 개선: any → 구체적 타입
 */
export interface ConversationSession {
    /** 세션 고유 ID */
    id: string;
    /** 소유 사용자 ID */
    user_id?: string;
    /** 세션 제목 */
    title: string;
    /** 생성 시각 */
    created_at: string;
    /** 마지막 업데이트 시각 */
    updated_at: string;
    /** 추가 메타데이터 (JSON) */
    metadata?: Record<string, unknown>;
}

/**
 * 대화 메시지 인터페이스
 */
export interface ConversationMessage {
    /** 메시지 고유 ID (자동 증가) */
    id: number;
    /** 소속 세션 ID */
    session_id: string;
    /** 메시지 역할 */
    role: 'user' | 'assistant' | 'system';
    /** 메시지 내용 */
    content: string;
    /** 사용된 LLM 모델 */
    model?: string;
    /** 응답한 에이전트 ID */
    agent_id?: string;
    /** 사고 과정 (Thinking) */
    thinking?: string;
    /** 사용된 토큰 수 */
    tokens?: number;
    /** 응답 시간 (밀리초) */
    response_time_ms?: number;
    /** 생성 시각 */
    created_at: string;
}

// ============================================
// 🧠 장기 메모리 인터페이스
// ============================================

/**
 * 메모리 카테고리 타입
 * 
 * - `preference`: 사용자 선호도 (언어, 스타일 등)
 * - `fact`: 사실 정보 (직업, 거주지 등)
 * - `project`: 진행 중인 프로젝트 정보
 * - `relationship`: 관계 정보 (동료, 회사 등)
 * - `skill`: 보유 기술/역량
 * - `context`: 맥락 정보
 */
export type MemoryCategory = 'preference' | 'fact' | 'project' | 'relationship' | 'skill' | 'context';

/**
 * 사용자 메모리 인터페이스
 * 
 * 세션 간 유지되는 장기 메모리 항목입니다.
 */
export interface UserMemory {
    /** 메모리 고유 ID */
    id: string;
    /** 소유 사용자 ID */
    user_id: string;
    /** 메모리 카테고리 */
    category: MemoryCategory;
    /** 메모리 키 (카테고리 내 고유) */
    key: string;
    /** 메모리 값 */
    value: string;
    /** 중요도 (0.0 ~ 1.0) */
    importance: number;
    /** 접근 횟수 */
    access_count: number;
    /** 마지막 접근 시각 */
    last_accessed?: string;
    /** 원본 세션 ID */
    source_session_id?: string;
    /** 생성 시각 */
    created_at: string;
    /** 수정 시각 */
    updated_at: string;
    /** 만료 시각 */
    expires_at?: string;
    /** 연관 태그 목록 */
    tags?: string[];
}

// ============================================
// 🔍 Deep Research 인터페이스
// ============================================

/**
 * 리서치 상태 타입
 */
export type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 리서치 깊이 타입
 * 
 * - `quick`: 빠른 검색 (1-2분)
 * - `standard`: 표준 검색 (5-10분)
 * - `deep`: 심층 검색 (15분 이상)
 */
export type ResearchDepth = 'quick' | 'standard' | 'deep';

/**
 * 리서치 세션 인터페이스
 */
export interface ResearchSession {
    /** 세션 고유 ID */
    id: string;
    /** 요청 사용자 ID */
    user_id?: string;
    /** 리서치 주제 */
    topic: string;
    /** 현재 상태 */
    status: ResearchStatus;
    /** 검색 깊이 */
    depth: ResearchDepth;
    /** 진행률 (0-100) */
    progress: number;
    /** 최종 요약 */
    summary?: string;
    /** 핵심 발견 사항 목록 */
    key_findings?: string[];
    /** 참고 출처 목록 (#12 개선: any → 구체적 타입) */
    sources?: Array<{ url?: string; title?: string; snippet?: string; [key: string]: unknown }>;
    /** 생성 시각 */
    created_at: string;
    /** 수정 시각 */
    updated_at: string;
    /** 완료 시각 */
    completed_at?: string;
}

/**
 * 리서치 단계 인터페이스
 */
export interface ResearchStep {
    /** 단계 고유 ID */
    id: number;
    /** 소속 세션 ID */
    session_id: string;
    /** 단계 번호 */
    step_number: number;
    /** 단계 유형 (search, analyze, summarize 등) */
    step_type: string;
    /** 검색 쿼리 */
    query?: string;
    /** 단계 결과 */
    result?: string;
    /** 이 단계의 출처 (#12 개선) */
    sources?: Array<{ url?: string; title?: string; snippet?: string; [key: string]: unknown }>;
    /** 단계 상태 */
    status: string;
    /** 생성 시각 */
    created_at: string;
}

// ============================================
// 🏪 Agent 마켓플레이스 인터페이스
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
    banner_url?: string;
    price: number;
    is_free: boolean;
    is_featured: boolean;
    is_verified: boolean;
    downloads: number;
    rating_avg: number;
    rating_count: number;
    version: string;
    changelog?: string;
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
    updated_at: string;
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

/**
 * 통합 데이터베이스 클래스
 * 
 * SQLite 기반의 통합 데이터 저장소입니다. better-sqlite3를 사용하여
 * 동기식 API와 WAL 모드로 높은 성능을 제공합니다.
 * 
 * @class UnifiedDatabase
 * 
 * @example
 * ```typescript
 * const db = new UnifiedDatabase('./data');
 * 
 * // 사용자 관리
 * db.createUser('id', 'username', 'hash', 'email@test.com');
 * const user = db.getUserByUsername('username');
 * 
 * // 대화 관리
 * db.createSession('session-1', user.id, '새 대화');
 * db.addMessage('session-1', 'user', '안녕하세요');
 * 
 * // 메모리 시스템
 * db.createMemory({
 *   id: 'mem-1',
 *   userId: user.id,
 *   category: 'preference',
 *   key: 'language',
 *   value: 'Korean'
 * });
 * 
 * db.close();
 * ```
 */
export class UnifiedDatabase {
    /** better-sqlite3 데이터베이스 인스턴스 */
    private db: Database.Database;
    
    /** 데이터베이스 파일 경로 */
    private dbPath: string;

    /** #13 개선: Prepared Statement 캐시 */
    private stmtCache: Map<string, Database.Statement> = new Map();

    /**
     * UnifiedDatabase 인스턴스 생성
     * 
     * 지정된 디렉토리에 unified.db 파일을 생성하거나 열고
     * 스키마를 초기화합니다.
     * 
     * @param dataDir - 데이터 디렉토리 경로 (기본값: './data')
     */
    constructor(dataDir: string = './data') {
        // 디렉토리 생성
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.dbPath = path.join(dataDir, 'unified.db');
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');

        // 스키마 초기화
        this.initSchema();

        console.log(`[UnifiedDB] 초기화 완료: ${this.dbPath}`);
    }

    /**
     * 데이터베이스 스키마 초기화
     * @internal
     */
    private initSchema(): void {
        this.db.exec(SCHEMA);
    }

    /**
     * 원시 데이터베이스 인스턴스 획득
     * 
     * 직접적인 SQL 쿼리 실행이 필요할 때 사용합니다.
     * 
     * @returns better-sqlite3 Database 인스턴스
     */
    getDatabase(): Database.Database {
        return this.db;
    }

    /**
     * #13 개선: Prepared Statement 캐싱
     * 동일 SQL을 반복 실행할 때 prepare() 비용 절감
     */
    private cachedPrepare(sql: string): Database.Statement {
        let stmt = this.stmtCache.get(sql);
        if (!stmt) {
            stmt = this.db.prepare(sql);
            this.stmtCache.set(sql, stmt);
        }
        return stmt;
    }

    // ===== 사용자 관리 =====

    /**
     * 새 사용자 생성
     * 
     * @param id - 사용자 고유 ID
     * @param username - 로그인용 사용자명
     * @param passwordHash - 해시된 비밀번호
     * @param email - 이메일 주소 (선택)
     * @param role - 역할 (기본값: 'user')
     * @returns SQLite 실행 결과
     */
    createUser(id: string, username: string, passwordHash: string, email?: string, role: string = 'user') {
        const stmt = this.db.prepare(`
            INSERT INTO users (id, username, password_hash, email, role)
            VALUES (?, ?, ?, ?, ?)
        `);
        return stmt.run(id, username, passwordHash, email, role);
    }

    /**
     * 사용자명으로 사용자 조회
     * 
     * @param username - 검색할 사용자명
     * @returns 사용자 정보 또는 undefined
     */
    getUserByUsername(username: string): User | undefined {
        const stmt = this.cachedPrepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username) as User | undefined;
    }

    /**
     * ID로 사용자 조회
     * 
     * @param id - 사용자 ID
     * @returns 사용자 정보 또는 undefined
     */
    getUserById(id: string): User | undefined {
        const stmt = this.cachedPrepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(id) as User | undefined;
    }

    /**
     * 마지막 로그인 시각 업데이트
     * 
     * @param userId - 사용자 ID
     * @returns SQLite 실행 결과
     */
    updateLastLogin(userId: string) {
        const stmt = this.cachedPrepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    }

    /**
     * 전체 사용자 목록 조회
     * 
     * @param limit - 최대 조회 수 (기본값: 50)
     * @returns 사용자 배열
     */
    getAllUsers(limit: number = 50): User[] {
        const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?');
        return stmt.all(limit) as User[];
    }

    // ===== 대화 관리 =====

    /**
     * 새 대화 세션 생성
     * 
     * @param id - 세션 고유 ID
     * @param userId - 소유 사용자 ID (선택)
     * @param title - 세션 제목 (기본값: '새 대화')
     * @param metadata - 추가 메타데이터 (선택)
     * @returns SQLite 실행 결과
     */
    createSession(id: string, userId?: string, title?: string, metadata?: any) {
        const stmt = this.db.prepare(`
            INSERT INTO conversation_sessions (id, user_id, title, metadata)
            VALUES (?, ?, ?, ?)
        `);
        return stmt.run(id, userId, title || '새 대화', JSON.stringify(metadata || {}));
    }

    /**
     * 대화 메시지 추가
     * 
     * @param sessionId - 세션 ID
     * @param role - 메시지 역할 ('user', 'assistant', 'system')
     * @param content - 메시지 내용
     * @param options - 추가 옵션
     * @param options.model - 사용된 모델명
     * @param options.agentId - 응답 에이전트 ID
     * @param options.thinking - 사고 과정
     * @param options.tokens - 사용 토큰 수
     * @param options.responseTimeMs - 응답 시간(ms)
     * @returns SQLite 실행 결과
     */
    addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }) {
        const stmt = this.db.prepare(`
            INSERT INTO conversation_messages 
            (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            sessionId, role, content,
            options?.model, options?.agentId, options?.thinking,
            options?.tokens, options?.responseTimeMs
        );
    }

    getSessionMessages(sessionId: string, limit: number = 100): ConversationMessage[] {
        const stmt = this.cachedPrepare(`SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`);
        return stmt.all(sessionId, limit) as ConversationMessage[];
    }

    getUserSessions(userId: string, limit: number = 50): ConversationSession[] {
        const stmt = this.db.prepare(`
            SELECT * FROM conversation_sessions 
            WHERE user_id = ? 
            ORDER BY updated_at DESC 
            LIMIT ?
        `);
        return stmt.all(userId, limit) as ConversationSession[];
    }

    getAllSessions(limit: number = 50): ConversationSession[] {
        const stmt = this.db.prepare(`
            SELECT * FROM conversation_sessions 
            ORDER BY updated_at DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as ConversationSession[];
    }

    deleteSession(sessionId: string) {
        const stmt = this.db.prepare('DELETE FROM conversation_sessions WHERE id = ?');
        return stmt.run(sessionId);
    }

    // ===== API 사용량 관리 =====

    recordApiUsage(date: string, apiKeyId: string, requests: number, tokens: number, errors: number, avgResponseTime: number, models: any) {
        const stmt = this.db.prepare(`
            INSERT INTO api_usage (date, api_key_id, requests, tokens, errors, avg_response_time, models)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, api_key_id) DO UPDATE SET
                requests = requests + excluded.requests,
                tokens = tokens + excluded.tokens,
                errors = errors + excluded.errors,
                avg_response_time = (avg_response_time + excluded.avg_response_time) / 2,
                models = excluded.models,
                updated_at = CURRENT_TIMESTAMP
        `);
        return stmt.run(date, apiKeyId, requests, tokens, errors, avgResponseTime, JSON.stringify(models));
    }

    getDailyUsage(days: number = 7) {
        const stmt = this.db.prepare(`
            SELECT date, SUM(requests) as requests, SUM(tokens) as tokens, SUM(errors) as errors, AVG(avg_response_time) as avg_response_time
            FROM api_usage
            WHERE date >= date('now', '-' || ? || ' days')
            GROUP BY date
            ORDER BY date DESC
        `);
        return stmt.all(days);
    }

    // ===== 에이전트 로그 =====

    logAgentUsage(params: {
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
        const stmt = this.db.prepare(`
            INSERT INTO agent_usage_logs 
            (user_id, session_id, agent_id, query, response_preview, response_time_ms, tokens_used, success, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            params.userId, params.sessionId, params.agentId,
            params.query, params.responsePreview,
            params.responseTimeMs, params.tokensUsed,
            params.success !== false ? 1 : 0,
            params.errorMessage
        );
    }

    getAgentStats(agentId: string) {
        const stmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
                AVG(response_time_ms) as avg_response_time,
                AVG(tokens_used) as avg_tokens
            FROM agent_usage_logs
            WHERE agent_id = ?
        `);
        return stmt.get(agentId);
    }

    // ===== 감사 로그 =====

    logAudit(params: {
        action: string;
        userId?: string;
        resourceType?: string;
        resourceId?: string;
        details?: any;
        ipAddress?: string;
        userAgent?: string;
    }) {
        const stmt = this.db.prepare(`
            INSERT INTO audit_logs 
            (action, user_id, resource_type, resource_id, details, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            params.action, params.userId, params.resourceType, params.resourceId,
            JSON.stringify(params.details || {}), params.ipAddress, params.userAgent
        );
    }

    getAuditLogs(limit: number = 100) {
        const stmt = this.db.prepare(`
            SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?
        `);
        return stmt.all(limit);
    }

    // ===== 통계 =====

    /**
     * #2 개선: tables와 validTables 불일치 수정 → 단일 화이트리스트로 통합
     * 모든 테이블의 통계를 반환합니다.
     */
    getStats(): Record<string, number> {
        // #2: 단일 화이트리스트 - 모든 테이블 포함
        const VALID_TABLES = [
            'users', 'conversation_sessions', 'conversation_messages',
            'api_usage', 'agent_usage_logs', 'agent_feedback',
            'custom_agents', 'audit_logs', 'alert_history',
            'user_memories', 'memory_tags',
            'research_sessions', 'research_steps',
            'agent_marketplace', 'agent_reviews', 'agent_installations',
            'canvas_documents', 'canvas_versions', 'canvas_ai_edits',
            'external_connections', 'external_files'
        ] as const;

        const stats: Record<string, number> = {};

        for (const table of VALID_TABLES) {
            // #2: const assertion으로 안전한 테이블명 보장 (런타임 인젝션 불가)
            const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
            const result = stmt.get() as { count: number };
            stats[table] = result.count;
        }

        return stats;
    }

    // ============================================
    // 🧠 장기 메모리 관리
    // ============================================

    /**
     * 새 메모리 생성 또는 업데이트
     * 
     * 동일한 (user_id, category, key) 조합이 있으면 업데이트합니다.
     * 
     * @param params - 메모리 생성 파라미터
     * @param params.id - 메모리 고유 ID
     * @param params.userId - 소유 사용자 ID
     * @param params.category - 메모리 카테고리
     * @param params.key - 메모리 키
     * @param params.value - 메모리 값
     * @param params.importance - 중요도 (0.0~1.0, 기본값: 0.5)
     * @param params.sourceSessionId - 원본 세션 ID
     * @param params.expiresAt - 만료 시각
     * @param params.tags - 연관 태그 목록
     */
    createMemory(params: {
        id: string;
        userId: string;
        category: MemoryCategory;
        key: string;
        value: string;
        importance?: number;
        sourceSessionId?: string;
        expiresAt?: string;
        tags?: string[];
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO user_memories (id, user_id, category, key, value, importance, source_session_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, category, key) DO UPDATE SET
                value = excluded.value,
                importance = excluded.importance,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(
            params.id, params.userId, params.category, params.key, params.value,
            params.importance || 0.5, params.sourceSessionId, params.expiresAt
        );

        // 태그 추가
        if (params.tags && params.tags.length > 0) {
            const tagStmt = this.db.prepare(`
                INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)
            `);
            for (const tag of params.tags) {
                tagStmt.run(params.id, tag);
            }
        }
    }

    /**
     * 사용자 메모리 조회
     * 
     * @param userId - 사용자 ID
     * @param options - 필터 옵션
     * @param options.category - 특정 카테고리만 조회
     * @param options.limit - 최대 조회 수 (기본값: 50)
     * @param options.minImportance - 최소 중요도 필터
     * @returns 메모리 배열 (중요도순 정렬)
     */
    getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): UserMemory[] {
        let sql = `
            SELECT m.*, GROUP_CONCAT(t.tag) as tags_str
            FROM user_memories m
            LEFT JOIN memory_tags t ON m.id = t.memory_id
            WHERE m.user_id = ?
        `;
        const params: any[] = [userId];

        if (options?.category) {
            sql += ` AND m.category = ?`;
            params.push(options.category);
        }
        if (options?.minImportance) {
            sql += ` AND m.importance >= ?`;
            params.push(options.minImportance);
        }

        sql += ` GROUP BY m.id ORDER BY m.importance DESC, m.last_accessed DESC LIMIT ?`;
        params.push(options?.limit || 50);

        const stmt = this.db.prepare(sql);
        const results = stmt.all(...params) as any[];
        
        return results.map(r => ({
            ...r,
            tags: r.tags_str ? r.tags_str.split(',') : []
        }));
    }

    /**
     * 질문과 관련된 메모리 검색
     * 
     * 키워드 기반으로 관련 메모리를 검색합니다.
     * 검색된 메모리의 접근 횟수가 자동으로 증가합니다.
     * 
     * @param userId - 사용자 ID
     * @param query - 검색 질문
     * @param limit - 최대 결과 수 (기본값: 10)
     * @returns 관련 메모리 배열 (중요도순)
     * 
     * @example
     * ```typescript
     * const memories = db.getRelevantMemories('user-1', '프로젝트 진행 상황');
     * memories.forEach(m => console.log(`${m.key}: ${m.value}`));
     * ```
     */
    getRelevantMemories(userId: string, query: string, limit: number = 10): UserMemory[] {
        // 간단한 키워드 매칭 기반 검색 (추후 벡터 검색으로 개선 가능)
        const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
        if (keywords.length === 0) return [];

        const conditions = keywords.map(() => `(LOWER(m.key) LIKE ? OR LOWER(m.value) LIKE ?)`).join(' OR ');
        const params: any[] = [userId];
        keywords.forEach(k => {
            params.push(`%${k}%`, `%${k}%`);
        });
        params.push(limit);

        const sql = `
            SELECT m.*, GROUP_CONCAT(t.tag) as tags_str
            FROM user_memories m
            LEFT JOIN memory_tags t ON m.id = t.memory_id
            WHERE m.user_id = ? AND (${conditions})
            GROUP BY m.id
            ORDER BY m.importance DESC
            LIMIT ?
        `;

        const stmt = this.db.prepare(sql);
        const results = stmt.all(...params) as any[];

        // 접근 횟수 업데이트
        const updateStmt = this.db.prepare(`
            UPDATE user_memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        results.forEach(r => updateStmt.run(r.id));

        return results.map(r => ({
            ...r,
            tags: r.tags_str ? r.tags_str.split(',') : []
        }));
    }

    updateMemory(memoryId: string, updates: { value?: string; importance?: number }): void {
        const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
        const params: any[] = [];

        if (updates.value !== undefined) {
            sets.push('value = ?');
            params.push(updates.value);
        }
        if (updates.importance !== undefined) {
            sets.push('importance = ?');
            params.push(updates.importance);
        }
        params.push(memoryId);

        const stmt = this.db.prepare(`UPDATE user_memories SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    deleteMemory(memoryId: string): void {
        const stmt = this.db.prepare('DELETE FROM user_memories WHERE id = ?');
        stmt.run(memoryId);
    }

    deleteUserMemories(userId: string): void {
        const stmt = this.db.prepare('DELETE FROM user_memories WHERE user_id = ?');
        stmt.run(userId);
    }

    // ============================================
    // 🔍 Deep Research 관리
    // ============================================

    createResearchSession(params: {
        id: string;
        userId?: string;
        topic: string;
        depth?: ResearchDepth;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO research_sessions (id, user_id, topic, depth)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(params.id, params.userId, params.topic, params.depth || 'standard');
    }

    updateResearchSession(sessionId: string, updates: {
        status?: ResearchStatus;
        progress?: number;
        summary?: string;
        keyFindings?: string[];
        sources?: any[];
    }): void {
        const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
        const params: any[] = [];

        if (updates.status !== undefined) {
            sets.push('status = ?');
            params.push(updates.status);
            if (updates.status === 'completed') {
                sets.push('completed_at = CURRENT_TIMESTAMP');
            }
        }
        if (updates.progress !== undefined) {
            sets.push('progress = ?');
            params.push(updates.progress);
        }
        if (updates.summary !== undefined) {
            sets.push('summary = ?');
            params.push(updates.summary);
        }
        if (updates.keyFindings !== undefined) {
            sets.push('key_findings = ?');
            params.push(JSON.stringify(updates.keyFindings));
        }
        if (updates.sources !== undefined) {
            sets.push('sources = ?');
            params.push(JSON.stringify(updates.sources));
        }
        params.push(sessionId);

        const stmt = this.db.prepare(`UPDATE research_sessions SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    addResearchStep(params: {
        sessionId: string;
        stepNumber: number;
        stepType: string;
        query?: string;
        result?: string;
        sources?: any[];
        status?: string;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO research_steps (session_id, step_number, step_type, query, result, sources, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            params.sessionId, params.stepNumber, params.stepType,
            params.query, params.result,
            params.sources ? JSON.stringify(params.sources) : null,
            params.status || 'pending'
        );
    }

    getResearchSession(sessionId: string): ResearchSession | undefined {
        const stmt = this.db.prepare('SELECT * FROM research_sessions WHERE id = ?');
        const result = stmt.get(sessionId) as any;
        if (!result) return undefined;

        return {
            ...result,
            key_findings: result.key_findings ? JSON.parse(result.key_findings) : [],
            sources: result.sources ? JSON.parse(result.sources) : []
        };
    }

    getResearchSteps(sessionId: string): ResearchStep[] {
        const stmt = this.db.prepare(`
            SELECT * FROM research_steps WHERE session_id = ? ORDER BY step_number
        `);
        return stmt.all(sessionId).map((r: any) => ({
            ...r,
            sources: r.sources ? JSON.parse(r.sources) : []
        })) as ResearchStep[];
    }

    getUserResearchSessions(userId: string, limit: number = 20): ResearchSession[] {
        const stmt = this.db.prepare(`
            SELECT * FROM research_sessions WHERE user_id = ?
            ORDER BY created_at DESC LIMIT ?
        `);
        return stmt.all(userId, limit).map((r: any) => ({
            ...r,
            key_findings: r.key_findings ? JSON.parse(r.key_findings) : [],
            sources: r.sources ? JSON.parse(r.sources) : []
        })) as ResearchSession[];
    }

    // ============================================
    // 🏪 Agent 마켓플레이스 관리
    // ============================================

    publishAgentToMarketplace(params: {
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
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO agent_marketplace 
            (id, agent_id, author_id, title, description, long_description, category, tags, icon, price, is_free)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            params.id, params.agentId, params.authorId, params.title,
            params.description, params.longDescription, params.category,
            params.tags ? JSON.stringify(params.tags) : null,
            params.icon || '🤖',
            params.price || 0,
            (params.price || 0) === 0 ? 1 : 0
        );
    }

    getMarketplaceAgents(options?: {
        category?: string;
        featured?: boolean;
        status?: MarketplaceStatus;
        search?: string;
        limit?: number;
        offset?: number;
        sortBy?: 'downloads' | 'rating' | 'newest';
    }): MarketplaceAgent[] {
        let sql = 'SELECT * FROM agent_marketplace WHERE 1=1';
        const params: any[] = [];

        if (options?.status) {
            sql += ' AND status = ?';
            params.push(options.status);
        } else {
            sql += ' AND status = ?';
            params.push('approved');
        }

        if (options?.category) {
            sql += ' AND category = ?';
            params.push(options.category);
        }
        if (options?.featured) {
            sql += ' AND is_featured = 1';
        }
        if (options?.search) {
            sql += ' AND (title LIKE ? OR description LIKE ?)';
            params.push(`%${options.search}%`, `%${options.search}%`);
        }

        const sortColumn = options?.sortBy === 'rating' ? 'rating_avg' 
            : options?.sortBy === 'newest' ? 'created_at' 
            : 'downloads';
        sql += ` ORDER BY ${sortColumn} DESC`;
        sql += ` LIMIT ? OFFSET ?`;
        params.push(options?.limit || 20, options?.offset || 0);

        const stmt = this.db.prepare(sql);
        return stmt.all(...params).map((r: any) => ({
            ...r,
            tags: r.tags ? JSON.parse(r.tags) : [],
            is_free: !!r.is_free,
            is_featured: !!r.is_featured,
            is_verified: !!r.is_verified
        })) as MarketplaceAgent[];
    }

    /**
     * #18 개선: 다운로드 수 경쟁조건 수정 — INSERT 성공 시에만 카운트 증가
     * 트랜잭션으로 원자성 보장
     */
    installAgent(marketplaceId: string, userId: string): void {
        const installTransaction = this.db.transaction(() => {
            const installStmt = this.db.prepare(`
                INSERT OR IGNORE INTO agent_installations (marketplace_id, user_id)
                VALUES (?, ?)
            `);
            const result = installStmt.run(marketplaceId, userId);

            // #18: INSERT가 실제로 새 행을 추가한 경우에만 다운로드 수 증가
            if (result.changes > 0) {
                const updateStmt = this.db.prepare(`
                    UPDATE agent_marketplace SET downloads = downloads + 1 WHERE id = ?
                `);
                updateStmt.run(marketplaceId);
            }
        });
        installTransaction();
    }

    addAgentReview(params: {
        id: string;
        marketplaceId: string;
        userId: string;
        rating: number;
        title?: string;
        content?: string;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO agent_reviews (id, marketplace_id, user_id, rating, title, content)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(marketplace_id, user_id) DO UPDATE SET
                rating = excluded.rating,
                title = excluded.title,
                content = excluded.content,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(params.id, params.marketplaceId, params.userId, params.rating, params.title, params.content);

        // 평균 평점 업데이트
        const updateStmt = this.db.prepare(`
            UPDATE agent_marketplace SET 
                rating_avg = (SELECT AVG(rating) FROM agent_reviews WHERE marketplace_id = ?),
                rating_count = (SELECT COUNT(*) FROM agent_reviews WHERE marketplace_id = ?)
            WHERE id = ?
        `);
        updateStmt.run(params.marketplaceId, params.marketplaceId, params.marketplaceId);
    }

    getAgentReviews(marketplaceId: string, limit: number = 20): AgentReview[] {
        const stmt = this.db.prepare(`
            SELECT * FROM agent_reviews WHERE marketplace_id = ?
            ORDER BY created_at DESC LIMIT ?
        `);
        return stmt.all(marketplaceId, limit) as AgentReview[];
    }

    getUserInstalledAgents(userId: string): MarketplaceAgent[] {
        const stmt = this.db.prepare(`
            SELECT m.* FROM agent_marketplace m
            JOIN agent_installations i ON m.id = i.marketplace_id
            WHERE i.user_id = ? AND i.uninstalled_at IS NULL
            ORDER BY i.installed_at DESC
        `);
        return stmt.all(userId).map((r: any) => ({
            ...r,
            tags: r.tags ? JSON.parse(r.tags) : [],
            is_free: !!r.is_free,
            is_featured: !!r.is_featured,
            is_verified: !!r.is_verified
        })) as MarketplaceAgent[];
    }

    // ============================================
    // 📝 Canvas 문서 관리
    // ============================================

    createCanvasDocument(params: {
        id: string;
        userId: string;
        sessionId?: string;
        title: string;
        docType?: CanvasDocType;
        content?: string;
        language?: string;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO canvas_documents (id, user_id, session_id, title, doc_type, content, language)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            params.id, params.userId, params.sessionId,
            params.title, params.docType || 'document',
            params.content, params.language
        );
    }

    updateCanvasDocument(documentId: string, updates: {
        title?: string;
        content?: string;
        changeSummary?: string;
        updatedBy?: string;
    }): void {
        // 현재 버전 가져오기
        const doc = this.getCanvasDocument(documentId);
        if (!doc) return;

        // 버전 히스토리에 저장
        if (updates.content !== undefined && doc.content !== updates.content) {
            const versionStmt = this.db.prepare(`
                INSERT INTO canvas_versions (document_id, version, content, change_summary, created_by)
                VALUES (?, ?, ?, ?, ?)
            `);
            versionStmt.run(documentId, doc.version, doc.content, updates.changeSummary, updates.updatedBy);
        }

        // 문서 업데이트
        const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
        const params: any[] = [];

        if (updates.title !== undefined) {
            sets.push('title = ?');
            params.push(updates.title);
        }
        if (updates.content !== undefined) {
            sets.push('content = ?');
            sets.push('version = version + 1');
            params.push(updates.content);
        }
        params.push(documentId);

        const stmt = this.db.prepare(`UPDATE canvas_documents SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    getCanvasDocument(documentId: string): CanvasDocument | undefined {
        const stmt = this.db.prepare('SELECT * FROM canvas_documents WHERE id = ?');
        const result = stmt.get(documentId) as any;
        if (!result) return undefined;

        return {
            ...result,
            is_shared: !!result.is_shared
        };
    }

    getCanvasDocumentByShareToken(shareToken: string): CanvasDocument | undefined {
        const stmt = this.db.prepare('SELECT * FROM canvas_documents WHERE share_token = ? AND is_shared = 1');
        const result = stmt.get(shareToken) as any;
        if (!result) return undefined;

        return {
            ...result,
            is_shared: !!result.is_shared
        };
    }

    getUserCanvasDocuments(userId: string, limit: number = 50): CanvasDocument[] {
        const stmt = this.db.prepare(`
            SELECT * FROM canvas_documents WHERE user_id = ?
            ORDER BY updated_at DESC LIMIT ?
        `);
        return stmt.all(userId, limit).map((r: any) => ({
            ...r,
            is_shared: !!r.is_shared
        })) as CanvasDocument[];
    }

    getCanvasVersions(documentId: string): CanvasVersion[] {
        const stmt = this.db.prepare(`
            SELECT * FROM canvas_versions WHERE document_id = ?
            ORDER BY version DESC
        `);
        return stmt.all(documentId) as CanvasVersion[];
    }

    shareCanvasDocument(documentId: string, shareToken: string): void {
        const stmt = this.db.prepare(`
            UPDATE canvas_documents SET is_shared = 1, share_token = ? WHERE id = ?
        `);
        stmt.run(shareToken, documentId);
    }

    unshareCanvasDocument(documentId: string): void {
        const stmt = this.db.prepare(`
            UPDATE canvas_documents SET is_shared = 0, share_token = NULL WHERE id = ?
        `);
        stmt.run(documentId);
    }

    recordCanvasAiEdit(params: {
        documentId: string;
        instruction: string;
        originalContent?: string;
        modifiedContent?: string;
        accepted?: boolean;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO canvas_ai_edits (document_id, instruction, original_content, modified_content, accepted)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(
            params.documentId, params.instruction,
            params.originalContent, params.modifiedContent,
            params.accepted ? 1 : 0
        );
    }

    // ============================================
    // 🔗 외부 서비스 연결 관리
    // ============================================

    /**
     * #1 개선: access_token/refresh_token을 AES-256-GCM으로 암호화 저장
     */
    createExternalConnection(params: {
        id: string;
        userId: string;
        serviceType: ExternalServiceType;
        accessToken?: string;
        refreshToken?: string;
        tokenExpiresAt?: string;
        accountEmail?: string;
        accountName?: string;
        metadata?: Record<string, unknown>;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO external_connections 
            (id, user_id, service_type, access_token, refresh_token, token_expires_at, account_email, account_name, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, service_type) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at,
                account_email = excluded.account_email,
                account_name = excluded.account_name,
                metadata = excluded.metadata,
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(
            params.id, params.userId, params.serviceType,
            // #1: 토큰 암호화 저장
            params.accessToken ? encrypt(params.accessToken) : null,
            params.refreshToken ? encrypt(params.refreshToken) : null,
            params.tokenExpiresAt,
            params.accountEmail, params.accountName,
            params.metadata ? JSON.stringify(params.metadata) : null
        );
    }

    /**
     * #1 개선: 토큰 복호화하여 반환
     */
    getUserConnections(userId: string): ExternalConnection[] {
        const stmt = this.db.prepare(`
            SELECT * FROM external_connections WHERE user_id = ? AND is_active = 1
        `);
        return stmt.all(userId).map((r: any) => ({
            ...r,
            // #1: 토큰 복호화
            access_token: r.access_token ? decrypt(r.access_token) : undefined,
            refresh_token: r.refresh_token ? decrypt(r.refresh_token) : undefined,
            metadata: r.metadata ? JSON.parse(r.metadata) : null,
            is_active: !!r.is_active
        })) as ExternalConnection[];
    }

    /**
     * #1 개선: 토큰 복호화하여 반환
     */
    getConnection(userId: string, serviceType: ExternalServiceType): ExternalConnection | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM external_connections WHERE user_id = ? AND service_type = ? AND is_active = 1
        `);
        const result = stmt.get(userId, serviceType) as any;
        if (!result) return undefined;

        return {
            ...result,
            // #1: 토큰 복호화
            access_token: result.access_token ? decrypt(result.access_token) : undefined,
            refresh_token: result.refresh_token ? decrypt(result.refresh_token) : undefined,
            metadata: result.metadata ? JSON.parse(result.metadata) : null,
            is_active: !!result.is_active
        };
    }

    /**
     * #1 개선: 토큰 암호화하여 업데이트
     */
    updateConnectionTokens(connectionId: string, params: {
        accessToken: string;
        refreshToken?: string;
        tokenExpiresAt?: string;
    }): void {
        const stmt = this.db.prepare(`
            UPDATE external_connections SET 
                access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(
            encrypt(params.accessToken),
            params.refreshToken ? encrypt(params.refreshToken) : null,
            params.tokenExpiresAt,
            connectionId
        );
    }

    disconnectService(userId: string, serviceType: ExternalServiceType): void {
        const stmt = this.db.prepare(`
            UPDATE external_connections SET is_active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND service_type = ?
        `);
        stmt.run(userId, serviceType);
    }

    addExternalFile(params: {
        id: string;
        connectionId: string;
        externalId: string;
        fileName: string;
        fileType?: string;
        fileSize?: number;
        webUrl?: string;
        cachedContent?: string;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO external_files 
            (id, connection_id, external_id, file_name, file_type, file_size, web_url, cached_content, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(connection_id, external_id) DO UPDATE SET
                file_name = excluded.file_name,
                file_type = excluded.file_type,
                file_size = excluded.file_size,
                web_url = excluded.web_url,
                cached_content = excluded.cached_content,
                last_synced = CURRENT_TIMESTAMP
        `);
        stmt.run(
            params.id, params.connectionId, params.externalId,
            params.fileName, params.fileType, params.fileSize,
            params.webUrl, params.cachedContent
        );
    }

    getExternalFiles(connectionId: string): ExternalFile[] {
        const stmt = this.db.prepare(`
            SELECT * FROM external_files WHERE connection_id = ?
            ORDER BY last_synced DESC
        `);
        return stmt.all(connectionId) as ExternalFile[];
    }

    // ===== 유틸리티 =====

    close(): void {
        this.db.close();
        console.log('[UnifiedDB] 연결 종료');
    }
}

/** 싱글톤 UnifiedDatabase 인스턴스 */
let dbInstance: UnifiedDatabase | null = null;

/**
 * UnifiedDatabase 싱글톤 인스턴스 획득
 * 
 * 애플리케이션 전역에서 동일한 데이터베이스 연결을 공유합니다.
 * 
 * @param dataDir - 데이터 디렉토리 (첫 호출 시에만 사용)
 * @returns UnifiedDatabase 싱글톤 인스턴스
 * 
 * @example
 * ```typescript
 * const db = getUnifiedDatabase('./data');
 * // 이후 호출에서는 동일 인스턴스 반환
 * const sameDb = getUnifiedDatabase();
 * ```
 */
export function getUnifiedDatabase(dataDir?: string): UnifiedDatabase {
    if (!dbInstance) {
        dbInstance = new UnifiedDatabase(dataDir);
    }
    return dbInstance;
}

/**
 * 데이터베이스 연결 종료
 * 
 * 애플리케이션 종료 시 호출하여 리소스를 정리합니다.
 * 
 * @example
 * ```typescript
 * process.on('SIGINT', () => {
 *   closeDatabase();
 *   process.exit(0);
 * });
 * ```
 */
export function closeDatabase(): void {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
