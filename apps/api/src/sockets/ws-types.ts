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
    /** 이미지 생성 모드 — ON 이면 메시지를 프롬프트로 이미지를 직접 생성 (generate_image 직접 호출) */
    imageMode?: boolean;
    /** 아티팩트 모드 — ON 이면 모델이 <artifact> 산출물을 생성하도록 유도 (wantsArtifact 강제) */
    artifactMode?: boolean;
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
    /**
     * 첨부 파일 목록 (2026-06-12 전체 파일 타입 허용).
     * 텍스트 파일은 content 에 UTF-8 디코드 내용 포함 (fileContext 주입용),
     * 문서 바이너리(PDF/docx/xlsx/pptx 등)는 data 에 base64 원본 포함 → 백엔드 doc-extractor 가 content 로 추출,
     * 그 외 바이너리는 content/data 없이 name/type/size 메타만 전달.
     * 이미지는 content 없이 images(base64 vision) 경로로 별도 전송.
     * truncated: 클라이언트가 전송 전 캡으로 내용을 절단했음 (절단 안내문 부착용).
     */
    files?: Array<{ id: string; name: string; type: string; content?: string; data?: string; size?: number; truncated?: boolean }>;
    userRole?: string;
    /** 사용자 선호 언어 (설정 페이지에서 선택) */
    language?: string;
    /** 구조화된 출력 형식 ('json' 또는 JSON Schema 객체) */
    format?: 'json' | Record<string, unknown>;
    /** Phase A (2026-05-26): 응답 스타일 (concise/default/verbose) */
    style?: 'concise' | 'default' | 'verbose';
    /** Phase 2 Custom Agent (2026-05-26): 사용자 정의 agent id */
    userAgentId?: string;
    /** Phase 3.4 (2026-05-26): 메시지 편집 분기 — 새 session 의 부모 추적 */
    branchFromSessionId?: string;
    branchFromMessageId?: string;
    [key: string]: unknown;
}

/**
 * 확장 WebSocket 인터페이스
 * 인증 정보, 생성 중단 컨트롤러, 하트비트 상태를 포함합니다.
 */
export interface ExtendedWebSocket extends WebSocket {
    _authenticatedUserId: string | null;
    _authenticatedUserRole: 'admin' | 'user' | 'guest';
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
    /** AnalyticsSystem 세션 식별자(WS 연결=세션). 세션 길이·세션당 쿼리 집계용. */
    _analyticsSessionId?: string;
}
