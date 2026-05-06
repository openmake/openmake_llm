/**
 * WebSocket 타입 정의
 * @module sockets/ws-types
 */
import { WebSocket } from 'ws';

/**
 * WebSocket 수신 메시지 인터페이스
 * 클라이언트에서 서버로 전송되는 모든 메시지 유형의 통합 타입입니다.
 */
export interface WSMessage {
    type: string;
    message?: string;
    model?: string;
    nodeId?: string;
    history?: Array<{ role: string; content: string; images?: string[] }>;
    images?: string[];
    docId?: string;
    sessionId?: string;
    anonSessionId?: string;
    userId?: string;
    discussionMode?: boolean;
    /** 사용자가 웹 검색을 명시적으로 활성화했는지 여부 */
    webSearch?: boolean;
    deepResearchMode?: boolean;
    thinkingMode?: boolean;
    thinkingLevel?: string;
    /**
     * 메시지 본문을 conversation_messages 에 저장할지 여부.
     * 기본 true (생략 시 저장). false 면 본문은 저장하지 않고
     * conversation_audit_log 에 메타만 기록한다.
     * settings.html 의 saveHistoryToggle UI 와 연결.
     */
    saveHistory?: boolean;
    /**
     * 장기 메모리 자동 추출 여부.
     * 기본 true (생략 시 추출). false 면 MemoryService 호출 자체 스킵.
     * settings.html 의 memoryLearningToggle UI 와 연결, saveHistory 와 독립.
     */
    memoryLearning?: boolean;
    enabledTools?: Record<string, boolean>;
    /** 첨부 파일 목록 */
    files?: Array<{ id: string; name: string; type: string }>;
    userRole?: string;
    userTier?: 'free' | 'pro' | 'enterprise';
    /** 사용자 선호 언어 (설정 페이지에서 선택) */
    language?: string;
    /** 구조화된 출력 형식 (Ollama format 파라미터: 'json' 또는 JSON Schema 객체) */
    format?: 'json' | Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * 확장 WebSocket 인터페이스
 * 인증 정보, 생성 중단 컨트롤러, 하트비트 상태를 포함합니다.
 */
export interface ExtendedWebSocket extends WebSocket {
    _authenticatedUserId: string | null;
    _authenticatedUserRole: 'admin' | 'user' | 'guest';
    _authenticatedUserTier: 'free' | 'pro' | 'enterprise';
    _abortController: AbortController | null;
    /** 🔒 Phase 2: heartbeat alive 플래그 */
    _isAlive: boolean;
    _authTokenExpiresAtMs?: number | null;
    _authTokenIssuedAtMs?: number | null;
    _authTokenJti?: string | null;
    _authTokenFingerprint?: string | null;
    _authMethod?: 'cookie' | 'bearer' | 'none';
    _clientIp?: string;
    _connectedAtMs?: number;
    _lastActivityAtMs?: number;
    _messageCount?: number;
    _messageTimestamps?: number[];
    _lastExpiryWarningAtMs?: number;
}
