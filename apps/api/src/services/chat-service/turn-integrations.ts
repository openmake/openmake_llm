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

/** 요청에서 통합이 볼 수 있는 부분 — 필요한 필드만 좁혀 둔다. */
export interface TurnIntegrationRequest {
    message?: string;
    userLocation?: { lat: number; lng: number } | null;
    /** 클라이언트가 고정한 외부 컨텍스트 참조 (컴포저의 노트북 선택 등) */
    notebook?: { id: string; title: string } | null;
}

export interface ChatTurnIntegration {
    /** add-on id */
    id: string;
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
