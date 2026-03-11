/**
 * Unified Database - 엔티티 타입 및 인터페이스 정의
 *
 * 모든 도메인 엔티티의 TypeScript 인터페이스를 정의합니다.
 * unified-database.ts에서 re-export됩니다.
 *
 * @module data/models/unified-database.types
 */

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
    /** 비로그인 사용자 세션 식별자 (UUID v4) */
    anon_session_id?: string;
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
// 장기 메모리 시스템 인터페이스
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
// Deep Research 인터페이스
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
// 외부 서비스 통합 인터페이스
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
// MCP 외부 서버 인터페이스
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
// API Key 관리 인터페이스
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
