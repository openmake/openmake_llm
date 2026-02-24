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
    deepResearchMode?: boolean;
    thinkingMode?: boolean;
    thinkingLevel?: string;
    enabledTools?: Record<string, boolean>;
    userRole?: string;
    userTier?: 'free' | 'pro' | 'enterprise';
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
    _lastExpiryWarningAtMs?: number;
}
