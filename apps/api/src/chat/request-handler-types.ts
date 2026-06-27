/**
 * ============================================================
 * ChatRequestHandler 타입 정의
 * ============================================================
 * request-handler.ts 에서 분리한 인터페이스 모음 (파일 크기 가드 — 로직/타입 분리).
 * 타입 전용 모듈 — `import type` 로만 참조되어 런타임 의존성/순환 없음.
 *
 * @module chat/request-handler-types
 */

import type { ExecutionPlan } from './profile-resolver';
import type { ClusterManager } from '../cluster/manager';
import type { SystemEventCallback } from '../services/chat-service-types';
import type { DiscussionProgress } from '../agents/discussion-engine';
import type { ResearchProgress } from '../services/DeepResearchService';
import type { ToolDefinition } from '../llm';

/**
 * 사용자 컨텍스트 — Express req 또는 WebSocket 연결에서 추출
 */
export interface ChatUserContext {
    /** 인증된 사용자 ID (DB FK 호환 — null이면 비로그인) */
    authenticatedUserId: string | null;
    /** 비로그인 세션 식별자 */
    anonSessionId?: string;
    /** 사용자 역할 */
    userRole: 'admin' | 'user' | 'guest';
    /**
     * 메모리/추적용 사용자 ID.
     * 인증 사용자 ID → 익명 세션 ID 순으로 채워지며, 둘 다 없으면 undefined.
     * 'guest' / 'anon-*' 같은 sentinel 문자열은 폐기 — 호출처는 표시용 fallback 만
     * (예: `userContext.userId ?? 'guest'`). DB 저장 가드는 `isPersistableUserId` 사용.
     */
    userId?: string;
}

/**
 * ExecutionPlan 해석 결과 — 모델 해석 + 클라이언트 생성에 필요한 정보
 */
export interface ExecutionPlanResult {
    /** 해석된 ExecutionPlan */
    plan: ExecutionPlan;
    /** 노드 선택에 사용할 실제 엔진 모델 */
    engineModel: string;
}

/**
 * processChat() 호출 파라미터
 */
export interface ChatRequestParams {
    /** 사용자 메시지 */
    message: string;
    /** 모델명 (모델 ID) */
    model?: string;
    /** 특정 노드 지정 */
    nodeId?: string;
    /** 대화 이력 */
    history?: Array<{ role: string; content: string; images?: string[] }>;
    /** 이미지 데이터 */
    images?: string[];
    /** 기존 세션 ID */
    sessionId?: string;
    /** 웹 검색 컨텍스트 */
    webSearchContext?: string;
    /** 첨부 파일 컨텍스트 (텍스트 파일 내용/바이너리 메타 — transient, DB 미저장) */
    fileContext?: string;
    /** 토론 모드 */
    discussionMode?: boolean;
    /** 딥 리서치 모드 */
    deepResearchMode?: boolean;
    /** 이미지 생성 모드 — ON 이면 메시지를 프롬프트로 이미지를 직접 생성 */
    imageMode?: boolean;
    /** 아티팩트 모드 — ON 이면 <artifact> 산출물 생성 유도 */
    artifactMode?: boolean;
    /** 사고 모드 */
    thinkingMode?: boolean;
    /** 사고 수준 */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /**
     * 응답 스타일 (Phase A 2026-05-26): 'concise' | 'default' | 'verbose'.
     * system prompt prepend 으로 작동. Custom Instructions 와 독립.
     */
    style?: import('./style').Style;
    /**
     * 사용자 정의 Custom Agent id (Phase 2 mainstream gap closure 2026-05-26).
     * 명시 시 18 산업 agent 자동 라우팅 우회 + agent.system_prompt 적용.
     */
    userAgentId?: string;
    /**
     * 메시지 본문을 conversation_messages 에 저장할지 여부.
     * undefined/true → 저장 (기본). false → 본문 저장 스킵, audit log 만 기록.
     * settings.html saveHistoryToggle 과 연결.
     */
    saveHistory?: boolean;
    /** 구조화된 출력 형식 ('json' 또는 JSON Schema 객체 — OpenAI response_format 호환) */
    format?: import('../llm').FormatOption;
    /** 사용자가 활성화한 MCP 도구 목록 (키: 도구명, 값: 활성화 여부) */
    enabledTools?: Record<string, boolean>;
    /** OpenAI 호환 도구 정의 배열 (외부 Tool Calling용) */
    tools?: ToolDefinition[];
    /** 도구 호출 제어 ("auto"|"none"|"required"|{type:"function",function:{name:string}}) */
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    /** 사용자 컨텍스트 */
    userContext: ChatUserContext;
    /** API Key 인증 요청 시 키 ID */
    apiKeyId?: string;
    /** 사용자가 설정에서 선택한 선호 언어 (language-policy userPreference) */
    userLanguagePreference?: string;
    /** 클러스터 매니저 */
    clusterManager: ClusterManager;
    /** 요청 중단 시그널 */
    abortSignal?: AbortSignal;
    /** 스트리밍 토큰 콜백 */
    onToken: (token: string) => void;
    /** Thinking 토큰 콜백 (추론 과정 실시간 전달) */
    onThinking?: (thinking: string) => void;
    /** 에이전트 선택 콜백 */
    onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void;
    /** 토론 진행 콜백 */
    onDiscussionProgress?: (progress: DiscussionProgress) => void;
    /** 딥 리서치 진행 콜백 */
    onResearchProgress?: (progress: ResearchProgress) => void;
    /** 스킬 활성화 콜백 - 에이전트에 주입된 스킬 이름 목록 */
    onSkillsActivated?: (skillNames: string[]) => void;
    /** 시스템 이벤트 콜백 - 자동 토론 활성화 등 메타 알림 (UI에서 토스트로 표시) */
    onSystemEvent?: SystemEventCallback;
    /**
     * MCP tool 호출이 resource content 를 반환했을 때 호출되는 콜백.
     * frontend 인라인 카드 UI (예: skill-draft) 렌더링을 트리거.
     */
    onMcpToolResult?: (event: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;
    /**
     * MCP tool 호출이 시작될 때 호출되는 콜백.
     * frontend "🔍 {도구} 실행 중" 진행 표시를 트리거 ("생각 중..." 멈춤 혼선 해소).
     */
    onMcpToolStart?: (event: { toolName: string }) => void;
    /**
     * Phase 3.4 (2026-05-26) 메시지 편집 분기:
     * 새 session 생성 시 부모 session 추적 (conversation_sessions.metadata.parentSessionId).
     * 분기된 대화의 "원본으로 돌아가기" 기능 + 사이드바 그룹화 등에 활용.
     */
    branchFromSessionId?: string;
    branchFromMessageId?: string;
}

/**
 * OpenAI 호환 tool_call 응답 형식
 * @interface OpenAIToolCall
 */
export interface OpenAIToolCall {
    /** 도구 호출 고유 ID (예: "call_abc123") */
    id: string;
    /** 호출 타입 (현재 "function"만 지원) */
    type: 'function';
    /** 호출할 함수 정보 */
    function: {
        /** 함수 이름 */
        name: string;
        /** 함수 인자 (JSON 문자열) */
        arguments: string;
    };
}

/**
 * 경로 분기 측정 메타 — TTFB 단일 라인 로그용.
 * #1 fast-path 우회, #2 agent 병렬화, #5 사전 요약 캐시 효과 분리 측정.
 */
export interface RoutingMeta {
    /** fast-path 매칭 (인사·단답형) */
    fastPath: boolean;
    /** agent LLM 라우팅 우회 (fast-path 또는 API Key) */
    agentBypass: boolean;
    /** 사전 요약 캐시 히트 (inline summarize 우회) */
    summaryCacheHit: boolean;
}

/**
 * processChat() 결과
 */
export interface ChatResult {
    /** AI 응답 전문 */
    response: string;
    /** 사용된 세션 ID */
    sessionId: string;
    /** 외부 노출용 모델명 */
    model: string;
    /** 해석된 ExecutionPlan */
    executionPlan: ExecutionPlan;
    /** 응답 소요 시간 (ms) */
    responseTime: number;
    /** OpenAI 호환 도구 호출 목록 (tools 요청 시에만 포함) */
    tool_calls?: OpenAIToolCall[];
    /** 응답 종료 사유 ("stop": 정상 완료, "tool_calls": 도구 호출 대기) */
    finish_reason?: 'stop' | 'tool_calls';
    /** 경로 분기 측정 메타 (TTFB 분석용, 일반 채팅 응답에만 포함) */
    routingMeta?: RoutingMeta;
    /**
     * Artifacts (2026-05-26): 응답에서 추출된 artifact 목록.
     * - 명시적 `<artifact>` 태그 → 그대로 변환
     * - Fallback: 긴 (≥15줄) code fence → 자동 artifact 변환 (Qwen instruction-follow 실패 대응)
     * ws-handler 가 done 직전 WS 이벤트로 발행 → 클라이언트 패널 자동 오픈.
     */
    artifacts?: Array<{ id: string; kind: string; title: string; lang: string | null; version: number; content: string }>;
}
