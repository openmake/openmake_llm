/**
 * ============================================================
 * Chat Strategy Types - 채팅 전략 패턴 타입 정의
 * ============================================================
 *
 * 특수 모드 전략 2종(Discussion/DeepResearch)의 공통 인터페이스와
 * 컨텍스트 타입을 정의합니다. (구 Direct/AgentLoop/GenerateVerify/Thinking
 * 전략 타입은 2026-07-18 strategy 계층 폐기 2단계로 삭제.)
 *
 * @module services/chat-strategies/types
 */
import type { DiscussionProgress, DiscussionResult } from '../../agents/discussion-engine';
import type { LLMClient } from '../../llm';
import type { ResearchProgress } from '../DeepResearchService';
import type { ChatMessageRequest } from '../chat-service-types';

/**
 * 채팅 전략 공통 컨텍스트
 *
 * 모든 전략이 공유하는 기본 컨텍스트 속성을 정의합니다.
 *
 * @interface ChatContext
 */
export interface ChatContext {
    /** 스트리밍 토큰 콜백 (SSE를 통해 클라이언트에 실시간 전송) */
    onToken: (token: string, thinking?: string) => void;
    /** 요청 중단 시그널 (클라이언트 연결 종료 시 활성화) */
    abortSignal?: AbortSignal;
    /** 중단 상태를 확인하고 'ABORTED' 에러를 throw하는 헬퍼 함수 */
    checkAborted?: () => void;
    /**
     * MCP tool 호출이 resource content 를 반환했을 때 호출되는 콜백.
     * ws-chat-handler 가 frontend 로 `mcp_tool_result` WS 메시지로 emit.
     * 인라인 UI (예: skill-draft card) 표시용. text content 만 있는 호출은 트리거 안 됨.
     */
    onMcpToolResult?: (event: {
        toolName: string;
        resources: Array<{ uri: string; mimeType?: string; text?: string }>;
    }) => void;
    /**
     * MCP tool 호출이 시작될 때 호출되는 콜백.
     * ws-chat-handler 가 frontend 로 `mcp_tool_start` WS 메시지로 emit.
     * "🔍 {도구} 실행 중" 진행 표시용 ("생각 중..." 멈춤 혼선 해소).
     */
    onMcpToolStart?: (event: { toolName: string }) => void;
}

/**
 * 채팅 전략 공통 결과
 *
 * 모든 전략이 반환하는 기본 결과 구조를 정의합니다.
 *
 * @interface ChatResult
 */
export interface ChatResult {
    /** 생성된 응답 텍스트 */
    response: string;
    /** 응답 생성 메트릭 (토큰 수, 소요 시간 등) */
    metrics?: Record<string, unknown>;
    /** 전략 실행 성공 여부 */
    succeeded?: boolean;
}

/**
 * 채팅 전략 제네릭 인터페이스
 *
 * 모든 채팅 전략 클래스가 구현해야 하는 인터페이스입니다.
 * 제네릭을 통해 각 전략별 컨텍스트/결과 타입을 타입 안전하게 지정합니다.
 *
 * @interface ChatStrategy
 * @template TContext - 전략별 컨텍스트 타입 (ChatContext 확장)
 * @template TResult - 전략별 결과 타입 (ChatResult 확장)
 */
export interface ChatStrategy<TContext extends ChatContext = ChatContext, TResult extends ChatResult = ChatResult> {
    /**
     * 전략을 실행합니다.
     * @param context - 전략 실행에 필요한 컨텍스트
     * @returns 전략 실행 결과
     */
    execute(context: TContext): Promise<TResult>;
}

/**
 * Discussion(멀티 에이전트 토론) 전략 컨텍스트
 *
 * 여러 전문가 에이전트가 토론하여 고품질 응답을 생성하는 데 필요한 컨텍스트입니다.
 *
 * @interface DiscussionStrategyContext
 * @extends ChatContext
 */
export interface DiscussionStrategyContext extends ChatContext {
    /** 원본 채팅 메시지 요청 */
    req: ChatMessageRequest;
    /** LLM 클라이언트 인스턴스 */
    client: LLMClient;
    /** 토론 진행 상황 콜백 */
    onProgress?: (progress: DiscussionProgress) => void;
    /** 토론 결과를 마크다운으로 포맷팅하는 함수 */
    formatDiscussionResult: (result: DiscussionResult) => string;
}

/**
 * DeepResearch(심층 연구) 전략 컨텍스트
 *
 * 자율적 다단계 리서치 수행에 필요한 컨텍스트입니다.
 *
 * @interface DeepResearchStrategyContext
 * @extends ChatContext
 */
export interface DeepResearchStrategyContext extends ChatContext {
    /** 원본 채팅 메시지 요청 */
    req: ChatMessageRequest;
    /** LLM 클라이언트 인스턴스 */
    client: LLMClient;
    /** 연구 진행 상황 콜백 */
    onProgress?: (progress: ResearchProgress) => void;
    /** 연구 결과를 마크다운으로 포맷팅하는 함수 */
    formatResearchResult: (result: {
        /** 연구 주제 */
        topic: string;
        /** 종합 요약 */
        summary: string;
        /** 주요 발견사항 목록 */
        keyFindings: string[];
        /** 참고 자료 목록 */
        sources: Array<{ title: string; url: string }>;
        /** 총 연구 단계 수 */
        totalSteps: number;
        /** 총 소요 시간 (밀리초) */
        duration: number;
    }) => string;
}
