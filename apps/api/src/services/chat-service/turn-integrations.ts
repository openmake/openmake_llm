/**
 * 채팅 턴 통합 확장점 — 통합형 add-on 이 채팅 파이프라인에 끼어드는 **유일한 계약** (2026-09-19).
 *
 * Base 파이프라인은 특정 통합 기능(지도·노트북 등)의 도구 이름·블록 형식·프롬프트 문구를 알지 않는다.
 * 단계마다 등록된 통합을 순회할 뿐이다: 의도 판정 → 도구 강제 포함 → 첫 턴 tool_choice 강제 →
 * 시스템 프롬프트 조각 → 도구 결과에서 결정적 첨부 블록 분리 → 최종 본문 후처리·첨부.
 * 통합은 addon-host 가 켜진 add-on 에서 모아 준다(`addon-host/chat-integrations.ts`). 통합이 0개면
 * 모든 단계가 빈 순회다.
 *
 * 훅은 순수 함수여야 한다(같은 입력 → 같은 출력) — 평가 하네스와 프롬프트 지문이 이 결과에 의존한다.
 *
 * @module services/chat-service/turn-integrations
 */
import { loadEnabledChatIntegrations } from '../../addon-host/chat-integrations';
import { TURN_CONTEXT_TIMEOUT_MS } from '../../config/service-limits';
import { createLogger } from '../../utils/logger';

const turnContextLog = createLogger('TurnContext');

/** 요청에서 통합이 볼 수 있는 부분 — 필요한 필드만 좁혀 둔다. */
export interface TurnIntegrationRequest {
    message?: string;
    userLocation?: { lat: number; lng: number } | null;
    /** 클라이언트가 고정한 외부 컨텍스트 참조 — add-on id → 참조 (컴포저의 컨텍스트 선택기) */
    contextRefs?: Record<string, { id: string; title: string }>;
}

/** add-on 이 기여하는 오케스트레이션 도구 — 의도 프리필터에 걸린 턴에만 노출되고 같은 턴에 모델이 호출을 결정한다 */
export interface ContributedOrchestrationTool {
    name: string;
    detectIntent(message: string): boolean;
    buildTool(): import('../../llm/types').ToolDefinition;
    /** 배정 가이드의 한 절 — "<도구> 은 ~할 때" (여러 도구의 절을 이어 한 문장으로 만든다) */
    promptGuideClause: string;
    /** 노출 로그 문구 */
    exposureLog: string;
    /** 실패는 'Error: …' 문자열로 돌려준다(채팅 루프를 죽이지 않는다) */
    run(params: { args: Record<string, unknown>; userLanguage?: string; signal?: AbortSignal }): Promise<string>;
}

/** add-on 이 에이전트 작업 스텝에 기여하는 도구 */
export interface ContributedAgentTaskTool {
    tool: { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } };
    run(args: Record<string, unknown>, ctx: { userId: string }): Promise<{ text: string; isError?: boolean }>;
}

/** 턴 전 컨텍스트 준비 입력 — 세션·사용자 문맥이 필요한 통합(문서 검색 등)이 쓴다 */
export interface TurnContextInput {
    /** 인증 사용자 — 게스트면 없다 */
    userId?: string;
    /** 기존 대화의 세션 — 새 대화의 첫 턴이면 없다 */
    sessionId?: string;
    message: string;
    userLang: string;
    /** 이 통합이 붙일 출처 번호의 시작 오프셋 — 앞서 붙은 출처(웹검색 등)가 N 개면 N+1 부터 쓴다 */
    sourceOffset: number;
    signal?: AbortSignal;
}

/** 턴 전 컨텍스트 기여 — 컨텍스트 블록은 이 턴에만 실리고(다음 턴 재주입 없음) 출처는 기존 출처 계약으로 간다 */
export interface TurnContextContribution {
    /** 사용자 메시지 쪽 컨텍스트 채널(첨부와 같은 채널)에 붙일 블록 */
    contextBlock?: string;
    /** 이 턴의 출처 — 번호(n)는 sourceOffset+1 부터 연속이어야 한다 */
    sources?: import('../../tools/web-search/types').SearchSourceRef[];
}

export interface ChatTurnIntegration {
    /** add-on id */
    id: string;
    /**
     * 턴 전 비동기 컨텍스트 준비 — 순수 훅과 달리 세션·사용자 문맥을 받고 I/O 를 할 수 있다.
     * 실패는 통합 스스로 처리해 안내 블록으로 돌려주는 것이 원칙이며, 던지면 Base 가 그 통합만 건너뛴다.
     */
    prepareTurnContext?(input: TurnContextInput): Promise<TurnContextContribution | undefined>;
    /** 이 턴이 통합의 의도 턴인가 — 프롬프트 지문·관측 플래그에 그대로 실린다 */
    detectIntent?(message: string): boolean;
    /** cap·relevance 선택과 무관하게 포함할 도구 (이름 부분 일치). 의도와 무관하게 메시지로 판정한다. */
    forceIncludeTools?(message: string): Array<{ nameIncludes: string; reason: string }>;
    /** 첫 턴 tool_choice 강제 대상 — 없으면 undefined */
    forcedFirstTurnTool?(message: string, toolNames: readonly string[]): string | undefined;
    /** 시스템 프롬프트에 덧붙일 조각 */
    systemPromptParts?(req: TurnIntegrationRequest): string[];
    /** 기기 위치가 첨부된 턴의 위치 안내 뒤에 이어 붙일 문장 (도구 인자 사용법 등) */
    userLocationHint?(): string | undefined;
    /** 사용자 메시지(LLM 전용 enhancedMessage) 앞에 붙일 접두 */
    enhancedMessagePrefix?(req: TurnIntegrationRequest, language: string): string | undefined;
    /** MCP 도구 노출 매칭용 메시지에 덧붙일 힌트 (그 서버를 "언급된 것" 으로 취급) */
    mcpSelectionHint?(req: TurnIntegrationRequest): string | undefined;
    /** 길이 상한 절단 전에 원문에서 보존할 블록 — 반환값은 직렬화 결과 앞에 붙는다 */
    preserveFromRawResult?(rawText: string): string | undefined;
    /** 도구 결과에서 결정적 첨부 블록을 떼어 내고, 모델에게 보낼 텍스트를 돌려준다 */
    extractBlocks?(toolResult: string): { blocks: string[]; modelFacing: string };
    /** 최종 본문 후처리 (모델 환각 제거 등) */
    scrubFinalContent?(content: string): { content: string; removed: number };
    /** 첨부 로그용 이름 */
    blockLabel?: string;
    /** 채팅 도구 루프에 기여하는 오케스트레이션 도구 */
    orchestrationTool?: ContributedOrchestrationTool;
    /** 에이전트 작업 스텝에 기여하는 도구 — 노출 여부(플래그)는 add-on 이 판단해 빈 배열로 끈다 */
    agentTaskTools?(): ContributedAgentTaskTool[];
    /**
     * 구 클라이언트 호환 — `contextRefs` 도입 전 WS chat 메시지가 이 통합의 참조를 실어 보내던 최상위 필드 이름.
     * 서버는 그 필드의 값을 `contextRefs[<id>]` 로 옮겨 받는다(iOS·캐시된 구 웹). 새 통합은 쓰지 않는다.
     */
    legacyWsContextField?: string;
}

let integrations: ChatTurnIntegration[] | null = null;

export function getChatTurnIntegrations(): readonly ChatTurnIntegration[] {
    integrations ??= loadEnabledChatIntegrations();
    return integrations;
}

/** 테스트 전용 — 통합 구성을 바꿔 끼운다. */
export function __setChatTurnIntegrationsForTest(list: ChatTurnIntegration[] | null): void {
    integrations = list;
}

/** 통합별 의도 플래그 — 의도 훅이 있는 통합만. */
export function detectIntegrationIntents(message: string): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const i of getChatTurnIntegrations()) {
        if (i.detectIntent) out[i.id] = i.detectIntent(message);
    }
    return out;
}

/** 통합별 결정적 첨부 블록 상태 (턴 상태에 둔다). */
export type IntegrationBlocks = Record<string, string[]>;

/** 도구 결과에서 모든 통합의 블록을 떼어 상태에 모으고(중복 제외) 모델용 텍스트를 돌려준다. */
export function extractIntegrationBlocks(toolResult: string, state: IntegrationBlocks): string {
    let modelFacing = toolResult;
    for (const i of getChatTurnIntegrations()) {
        if (!i.extractBlocks) continue;
        const extracted = i.extractBlocks(modelFacing);
        const bucket = (state[i.id] ??= []);
        for (const b of extracted.blocks) if (!bucket.includes(b)) bucket.push(b);
        modelFacing = extracted.modelFacing;
    }
    return modelFacing;
}

const CONTEXT_REF_ID_MAX = 64;

function sanitizeContextRef(raw: unknown): { id: string; title: string } | undefined {
    const r = raw as { id?: unknown; title?: unknown } | null | undefined;
    return r && typeof r.id === 'string' && r.id.trim() && typeof r.title === 'string'
        ? { id: r.id.trim().slice(0, CONTEXT_REF_ID_MAX), title: r.title }
        : undefined;
}

/**
 * WS chat 메시지에서 통합 컨텍스트 참조를 모은다 — 등록된 통합의 것만 받는다(모르는 add-on id 는 버린다).
 * 새 필드 `contextRefs` 가 우선이고, 없으면 통합이 선언한 구 최상위 필드를 본다.
 */
export function collectContextRefs(msg: Record<string, unknown>): Record<string, { id: string; title: string }> | undefined {
    const incoming = (msg.contextRefs && typeof msg.contextRefs === 'object' ? msg.contextRefs : {}) as Record<string, unknown>;
    const out: Record<string, { id: string; title: string }> = {};
    for (const integration of getChatTurnIntegrations()) {
        const ref = sanitizeContextRef(incoming[integration.id])
            ?? (integration.legacyWsContextField ? sanitizeContextRef(msg[integration.legacyWsContextField]) : undefined);
        if (ref) out[integration.id] = ref;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 모든 통합의 턴 전 컨텍스트를 모은다 — 통합마다 시간 상한을 두고, 실패·초과한 통합은 건너뛴다(채팅은 계속).
 * 출처 번호는 통합 순서대로 이어 붙도록 각 통합에 오프셋을 넘긴다.
 */
export async function collectTurnContexts(
    input: Omit<TurnContextInput, 'sourceOffset'> & { sourceOffset?: number },
): Promise<{ contextBlock: string; sources: import('../../tools/web-search/types').SearchSourceRef[] }> {
    const sources: import('../../tools/web-search/types').SearchSourceRef[] = [];
    const blocks: string[] = [];
    let offset = input.sourceOffset ?? 0;
    for (const integration of getChatTurnIntegrations()) {
        if (!integration.prepareTurnContext) continue;
        try {
            const r = await withTurnContextTimeout(integration.prepareTurnContext({ ...input, sourceOffset: offset }), integration.id);
            if (r?.contextBlock) blocks.push(r.contextBlock);
            const own = (r?.sources ?? []).filter((s) => s.n > offset);
            sources.push(...own);
            offset = Math.max(offset, ...own.map((s) => s.n));
        } catch (err) {
            turnContextLog.warn(`[TurnContext] '${integration.id}' 컨텍스트 준비 실패 — 이 통합 없이 진행: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { contextBlock: blocks.join('\n\n'), sources };
}

function withTurnContextTimeout<T>(p: Promise<T>, id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`시간 초과(${TURN_CONTEXT_TIMEOUT_MS}ms, ${id})`)), TURN_CONTEXT_TIMEOUT_MS);
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
