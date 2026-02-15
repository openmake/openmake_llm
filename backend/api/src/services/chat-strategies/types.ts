/**
 * ============================================================
 * Chat Strategy Types - 채팅 전략 패턴 타입 정의
 * ============================================================
 *
 * ChatService에서 사용하는 전략 패턴의 공통 인터페이스와
 * 각 전략별 컨텍스트/결과 타입을 정의합니다.
 *
 * @module services/chat-strategies/types
 * @description
 * - 공통 ChatContext/ChatResult 기반 타입
 * - 5가지 전략별 컨텍스트 인터페이스 (A2A, Direct, AgentLoop, Discussion, DeepResearch)
 * - 제네릭 ChatStrategy 인터페이스로 타입 안전한 전략 교체 지원
 */
import type { DiscussionProgress, DiscussionResult } from '../../agents/discussion-engine';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { DocumentStore } from '../../documents/store';
import type { UserContext } from '../../mcp/user-sandbox';
import type { OllamaClient } from '../../ollama/client';
import type { ChatMessage, ModelOptions, ToolCall, ToolDefinition } from '../../ollama/types';
import type { ResearchProgress } from '../DeepResearchService';
import type { ChatMessageRequest } from '../ChatService';

/**
 * 채팅 전략 공통 컨텍스트
 *
 * 모든 전략이 공유하는 기본 컨텍스트 속성을 정의합니다.
 *
 * @interface ChatContext
 */
export interface ChatContext {
    /** 스트리밍 토큰 콜백 (SSE를 통해 클라이언트에 실시간 전송) */
    onToken: (token: string) => void;
    /** 요청 중단 시그널 (클라이언트 연결 종료 시 활성화) */
    abortSignal?: AbortSignal;
    /** 중단 상태를 확인하고 'ABORTED' 에러를 throw하는 헬퍼 함수 */
    checkAborted?: () => void;
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
 * A2A(Agent-to-Agent) 전략 컨텍스트
 *
 * 다중 모델 병렬 생성에 필요한 메시지 이력과 채팅 옵션을 포함합니다.
 *
 * @interface A2AStrategyContext
 * @extends ChatContext
 */
export interface A2AStrategyContext extends ChatContext {
    /** LLM에 전달할 메시지 배열 (시스템 프롬프트 + 대화 이력 + 사용자 메시지) */
    messages: ChatMessage[];
    /** 모델 옵션 (temperature, top_p 등) */
    chatOptions: ModelOptions;
}

/**
 * A2A 전략 결과
 *
 * @interface A2AStrategyResult
 * @extends ChatResult
 */
export interface A2AStrategyResult extends ChatResult {
    /** A2A 병렬 생성 성공 여부 (실패 시 AgentLoop으로 폴백) */
    succeeded: boolean;
}

/**
 * Direct(직접 호출) 전략 컨텍스트
 *
 * 단일 LLM에 한 번 요청하여 응답과 도구 호출 정보를 받는 데 필요한 컨텍스트입니다.
 *
 * @interface DirectStrategyContext
 * @extends ChatContext
 */
export interface DirectStrategyContext extends ChatContext {
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
    /** 현재 대화 히스토리 (시스템 프롬프트 + 이전 메시지 + 사용자 메시지) */
    currentHistory: ChatMessage[];
    /** 모델 옵션 */
    chatOptions: ModelOptions;
    /** 사용 가능한 도구 정의 목록 */
    allowedTools: ToolDefinition[];
    /** Thinking 깊이 옵션 */
    thinkOption?: 'low' | 'medium' | 'high';
}

/**
 * Direct 전략 결과
 *
 * @interface DirectStrategyResult
 * @extends ChatResult
 */
export interface DirectStrategyResult extends ChatResult {
    /** LLM이 반환한 어시스턴트 메시지 (대화 히스토리에 추가용) */
    assistantMessage: ChatMessage;
    /** LLM이 요청한 도구 호출 목록 (빈 배열이면 최종 응답) */
    toolCalls: ToolCall[];
}

/**
 * AgentLoop(Multi-turn 도구 호출) 전략 컨텍스트
 *
 * 도구 호출이 없을 때까지 LLM ↔ 도구 실행을 반복하는 루프에 필요한 컨텍스트입니다.
 *
 * @interface AgentLoopStrategyContext
 * @extends ChatContext
 */
export interface AgentLoopStrategyContext extends ChatContext {
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
    /** 현재 대화 히스토리 (루프 진행에 따라 도구 결과가 추가됨) */
    currentHistory: ChatMessage[];
    /** 모델 옵션 */
    chatOptions: ModelOptions;
    /** 최대 루프 반복 횟수 (무한 루프 방지) */
    maxTurns: number;
    /** 현재 모델의 도구 호출 지원 여부 */
    supportsTools: boolean;
    /** 현재 모델의 Thinking 모드 지원 여부 */
    supportsThinking: boolean;
    /** Sequential Thinking 모드 활성화 여부 */
    thinkingMode?: boolean;
    /** Thinking 깊이 수준 */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /** Brand Model 실행 계획 */
    executionPlan?: ExecutionPlan;
    /** 현재 사용자 컨텍스트 (도구 접근 권한 확인용) */
    currentUserContext: UserContext | null;
    /** 허용된 도구 목록을 반환하는 함수 */
    getAllowedTools: () => ToolDefinition[];
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
    /** 업로드된 문서 저장소 (토론 컨텍스트에 문서 포함용) */
    uploadedDocuments: DocumentStore;
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
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
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
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
