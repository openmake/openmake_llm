/**
 * External Provider 공개 타입 — deps / TTFT 계측 / 스트림 컨텍스트.
 *
 * external-provider 본체(600줄 CI 가드)에서 분리. 런타임 코드가 없으므로
 * external-tool-exec 등 하위 모듈이 순환 import 없이 참조할 수 있다.
 *
 * @module services/chat-service/external-provider-types
 */
import type { ToolDefinition } from '../../llm';
import type { Style } from '../../chat/style';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ProviderRouter } from '../../providers/provider-router';

export interface ExternalProviderDeps {
    /** Provider router — `getExternalKeysRepo()` 등 사용 */
    providerRouter?: ProviderRouter;
    /** 현재 사용자 컨텍스트 — MCP tool 실행 sandbox 에 사용 */
    currentUserContext: UserContext | null;
    /** MCP tool 호출 결과 inline 카드 콜백 (frontend 표시용) */
    mcpToolResultCallback?: (data: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;
    /** MCP tool 호출 시작 콜백 (frontend "실행 중" 진행 표시용) */
    mcpToolStartCallback?: (data: { toolName: string }) => void;
    /** Provider usage 누적 — ChatService.lastProviderUsage setter */
    onUsage?: (usage: import('../../llm').UsageMetrics) => void;
    /** 시스템 이벤트 콜백 — provider 폴백 고지 등 메타 알림 (WS 'system_event') */
    onSystemEvent?: (event: { type: string; message: string; metadata?: Record<string, unknown> }) => void;
    /** Allowed tools (agent 매칭 후) */
    allowedTools: ToolDefinition[];
    /** 활성 스킬이 required 로 바인딩한 도구 이름 — 도구 플랜의 distractor 억제 면제용 */
    skillRequiredToolNames?: readonly string[];
}

/**
 * TTFT 분해 계측 (2026-08-02).
 *
 * 종전 `[ChatMetrics] ttfb` 하나에 전처리·모델 prefill·도구 실행이 전부 뭉쳐 있어
 * "왜 느린지"를 가릴 수 없었다(실측 p50 4.2초인데 원인 미상). 절대 시각을 담아
 * 호출부가 구간을 계산하도록 한다 — external-provider 는 상위 시작 시각을 모르므로.
 */
export interface ChatTimings {
    /** external-provider 진입 시각 */
    enteredAt: number;
    /** 첫 LLM 호출 직전 시각 (이 앞은 프롬프트 조립·도구 계획) */
    firstLlmCallAt: number;
    /** 첫 응답 청크(content 또는 thinking) 도착 시각 — 모델 큐잉+prefill 종료점 */
    firstChunkAt: number;
    /** 도구 실행 누적(ms) — 웹검색·토론 등 */
    toolMs: number;
    /** 도구 루프 턴 수 */
    turns: number;
}

export interface StreamFromExternalContext {
    agentSystemMessage?: string;
    enhancedMessage?: string;
    resolvedLanguage?: string;
    /** Cross-conversation Memory 블록 (claude.ai Memory 동등). DYNAMIC BOUNDARY 뒤(세션별 영역)에 배치. */
    memoryBlock?: string;
    /** Custom Instructions 블록 (사용자 영구 지시). DYNAMIC BOUNDARY 뒤(세션별 영역)에 배치. */
    customInstructionsBlock?: string;
    /** Artifacts guide (디자인시스템·<artifact> 형식 지시). 가드/페르소나 뒤에 append. */
    artifactGuideBlock?: string;
    /** 응답 스타일 (concise/default/verbose). 정적 prefix 맨 앞에 style guard prepend. default 면 overhead 0. */
    style?: Style;
    /** 답변 형식 가드 (구조적 질문에 결론-우선·표·실행항목 분리). prose/concise 면 빈 문자열. */
    answerFormatBlock?: string;
    /** Tail 라우팅 Stage 2B — factual tail 판정 시 첫 턴 web_search tool_choice 강제. */
    tailWebGround?: boolean;
    /** P1 보고서 파이프라인 — 보고서 의도 턴에만 주입되는 reportdata 데이터 계약 가이드. */
    reportGuideBlock?: string;
    /** 오케스트레이션 배정 텔레메트리(Stage 2) — 스트림 종료 시 external-provider 가 채워
     *  되돌려준다(호출부가 셰도우 적재). 의도 미매칭 턴은 undefined 유지. */
    orchestrationTelemetry?: import('./orchestration-shadow-recorder').OrchestrationTelemetry;
    /** TTFT 분해 계측 — external-provider 가 채워 되돌려준다(호출부가 구간 계산·로깅). */
    timings?: ChatTimings;
}
