/**
 * ============================================================
 * Conversation Types - 대화 관련 타입 정의
 * ============================================================
 *
 * ConversationDB에서 사용하는 인터페이스, 내부 Row 타입, 헬퍼 함수를 정의합니다.
 *
 * @module data/conversation-types
 */

/**
 * 대화 세션 인터페이스 (프론트엔드 호환 camelCase)
 * @interface ConversationSession
 */
export interface ConversationSession {
    /** 세션 고유 식별자 (UUID) */
    id: string;
    /** 소유 사용자 ID (로그인 사용자) */
    userId?: string;
    /** 비로그인 사용자 세션 식별자 (UUID v4) */
    anonSessionId?: string;
    /** 대화 제목 */
    title: string;
    /** 세션 생성 일시 (ISO 8601) */
    created_at: string;
    /** 마지막 업데이트 일시 (ISO 8601) */
    updated_at: string;
    /** 세션 메타데이터 (JSONB) */
    metadata?: Record<string, unknown> | null;
    /** 세션에 속한 메시지 목록 */
    messages: ConversationMessage[];
}

/**
 * 대화 메시지 인터페이스 (프론트엔드 호환 camelCase)
 * @interface ConversationMessage
 */
export interface ConversationMessage {
    /** 메시지 고유 식별자 */
    id: string;
    /** 소속 세션 ID */
    sessionId: string;
    /** 메시지 발화자 역할 */
    role: 'user' | 'assistant' | 'system';
    /** 메시지 본문 */
    content: string;
    /** 메시지 생성 일시 (ISO 8601) */
    timestamp: string;
    /** 응답 생성에 사용된 모델명 */
    model?: string;
    /** AI의 사고 과정 */
    thinking?: string;
}

/**
 * 메시지 저장 시 추가 옵션
 * @interface MessageOptions
 */
export interface MessageOptions {
    /** 사용된 모델명 */
    model?: string;
    /** AI 사고 과정 텍스트 */
    thinking?: string;
    /** 사용된 토큰 수 */
    tokensUsed?: number;
    /** 응답 생성 시간 (밀리초) */
    responseTime?: number;
}

// Internal row types for PostgreSQL mapping
export interface SessionRow {
    id: string;
    user_id: string | null;
    anon_session_id: string | null;
    title: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, unknown> | null;
}

export interface MessageRow {
    id: number;
    session_id: string;
    role: string;
    content: string;
    model: string | null;
    agent_id: string | null;
    thinking: string | null;
    tokens: number | null;
    response_time_ms: number | null;
    created_at: string;
}

/**
 * PostgreSQL MessageRow -> ConversationMessage 변환
 */
export function rowToMessage(row: MessageRow): ConversationMessage {
    return {
        id: String(row.id),
        sessionId: row.session_id,
        role: row.role as 'user' | 'assistant' | 'system',
        content: row.content,
        timestamp: row.created_at,
        model: row.model || undefined,
        thinking: row.thinking || undefined
    };
}

/**
 * PostgreSQL SessionRow -> ConversationSession 변환
 */
export function rowToSession(row: SessionRow, messages: ConversationMessage[]): ConversationSession {
    return {
        id: row.id,
        userId: row.user_id || undefined,
        anonSessionId: row.anon_session_id || undefined,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: row.metadata || undefined,
        messages
    };
}

/**
 * duplicate key (23505) 에러 판별
 */
export function isDuplicateKeyError(err: unknown): boolean {
    if (err instanceof Error && err.message.includes('duplicate key')) {
        return true;
    }

    if (typeof err === 'object' && err !== null && 'code' in err) {
        const code = (err as { code?: unknown }).code;
        return code === '23505';
    }

    return false;
}
