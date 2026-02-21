/**
 * ============================================================
 * ChatService 타입 정의 모듈
 * ============================================================
 *
 * ChatService에서 사용되는 모든 인터페이스와 타입을 정의합니다.
 *
 * @module services/chat-service-types
 */
import type { UserTier } from '../data/user-manager';
import type { OllamaClient } from '../ollama/client';

/**
 * 채팅 히스토리 메시지 인터페이스
 *
 * 대화 이력에 포함되는 단일 메시지의 구조를 정의합니다.
 * user/assistant/system/tool 역할을 지원하며, 이미지 및 도구 호출 정보를 포함할 수 있습니다.
 *
 * @interface ChatHistoryMessage
 */
export interface ChatHistoryMessage {
    /** 메시지 발신자 역할 (user: 사용자, assistant: AI, system: 시스템, tool: 도구 실행 결과) */
    role: 'user' | 'assistant' | 'system' | 'tool';
    /** 메시지 본문 텍스트 */
    content: string;
    /** Base64 인코딩된 이미지 데이터 배열 (비전 모델용) */
    images?: string[];
    /** LLM이 요청한 도구 호출 목록 */
    tool_calls?: Array<{
        /** 도구 호출 유형 (기본: 'function') */
        type?: string;
        /** 호출할 함수 정보 */
        function: {
            /** 함수 이름 */
            name: string;
            /** 함수 인자 (객체 또는 JSON 문자열) */
            arguments: Record<string, unknown> | string;
        };
    }>;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * 에이전트 선택 결과 정보
 *
 * 사용자 메시지 분석 후 선택된 에이전트의 상세 정보를 담습니다.
 *
 * @interface AgentSelectionInfo
 */
export interface AgentSelectionInfo {
    /** 에이전트 유형 식별자 (예: 'code', 'math', 'creative') */
    type?: string;
    /** 에이전트 표시 이름 */
    name?: string;
    /** 에이전트 이모지 아이콘 */
    emoji?: string;
    /** 현재 처리 단계 (예: 'planning', 'executing') */
    phase?: string;
    /** 에이전트 선택 사유 */
    reason?: string;
    /** 에이전트 선택 신뢰도 (0.0 ~ 1.0) */
    confidence?: number;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * 도구 호출 정보 인터페이스
 *
 * LLM이 요청한 단일 도구 호출의 구조를 정의합니다.
 *
 * @interface ToolCallInfo
 */
export interface ToolCallInfo {
    /** 도구 호출 유형 */
    type?: string;
    /** 호출할 함수 상세 정보 */
    function: {
        /** 함수 이름 */
        name: string;
        /** 함수 인자 객체 */
        arguments: Record<string, unknown>;
    };
}

/**
 * 웹 검색 결과 인터페이스
 * @interface WebSearchResult
 */
export interface WebSearchResult {
    /** 검색 결과 제목 */
    title: string;
    /** 검색 결과 URL */
    url: string;
    /** 검색 결과 요약 스니펫 */
    snippet?: string;
}

/**
 * 웹 검색 함수 타입
 *
 * 쿼리 문자열을 받아 웹 검색 결과 배열을 반환하는 비동기 함수입니다.
 *
 * @param query - 검색 쿼리 문자열
 * @param options - 검색 옵션
 * @param options.maxResults - 최대 결과 수
 * @returns 웹 검색 결과 배열
 */
export type WebSearchFunction = (
    query: string,
    options?: { maxResults?: number }
) => Promise<WebSearchResult[]>;

/**
 * 채팅 응답 메타데이터 인터페이스
 *
 * 채팅 응답에 첨부되는 부가 정보 (모델명, 토큰 수, 소요 시간 등)를 담습니다.
 *
 * @interface ChatResponseMeta
 */
export interface ChatResponseMeta {
    /** 사용된 모델 이름 */
    model?: string;
    /** 생성된 토큰 수 */
    tokens?: number;
    /** 응답 생성 소요 시간 (밀리초) */
    duration?: number;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * ChatService 설정 인터페이스
 * @interface ChatServiceConfig
 */
export interface ChatServiceConfig {
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
    /** 사용할 모델 이름 */
    model: string;
}

/**
 * 채팅 메시지 요청 인터페이스
 *
 * ChatService.processMessage()에 전달되는 요청 객체의 구조를 정의합니다.
 * 사용자 메시지, 대화 이력, 문서/이미지 컨텍스트, 실행 모드 옵션 등을 포함합니다.
 *
 * @interface ChatMessageRequest
 */
export interface ChatMessageRequest {
    /** 사용자 입력 메시지 */
    message: string;
    /** 이전 대화 히스토리 배열 */
    history?: Array<{ role: string; content: string; images?: string[] }>;
    /** 참조할 업로드 문서 ID */
    docId?: string;
    /** Base64 인코딩된 이미지 데이터 배열 */
    images?: string[];
    /** 웹 검색 결과 컨텍스트 문자열 */
    webSearchContext?: string;
    /** 멀티 에이전트 토론 모드 활성화 여부 */
    discussionMode?: boolean;
    /** 심층 연구 모드 활성화 여부 */
    deepResearchMode?: boolean;
    /** Sequential Thinking 모드 활성화 여부 */
    thinkingMode?: boolean;
    /** Thinking 깊이 수준 */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /** 요청한 사용자의 ID */
    userId?: string;
    /** 사용자 역할 (접근 권한 결정에 사용) */
    userRole?: 'admin' | 'user' | 'guest';
    /** 사용자 구독 등급 (도구 접근 티어 결정에 사용) */
    userTier?: UserTier;
    /** 사용자가 활성화한 MCP 도구 목록 (키: 도구명, 값: 활성화 여부) */
    enabledTools?: Record<string, boolean>;
    /** 요청 중단 시그널 (SSE 연결 종료 시 사용) */
    abortSignal?: AbortSignal;
}
