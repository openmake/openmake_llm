/**
 * 채팅 모드 확장점 — 일반 채팅 경로 대신 턴 전체를 가져가는 특수 모드(add-on)의 계약 (2026-09-19).
 *
 * Base 파이프라인은 특정 모드(토론·딥리서치 등)를 모른다. 요청에 켜진 모드가 있으면 그 모드에 턴을 넘기고,
 * 입력 전처리(PDF vision·URL 사전 분석·첨부 재주입)를 그 모드가 선언한 정책대로 조정할 뿐이다.
 * 모드는 addon-host 가 켜진 add-on 에서 모은다(`addon-host/chat-modes.ts`). 모드가 0개면 분기 자체가 없다.
 *
 * @module services/chat-service/chat-modes
 */
import type { LLMClient } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import { loadEnabledChatModes } from '../../addon-host/chat-modes';

/** 모드가 입력 전처리에 요구하는 것 — 일반 채팅은 전부 true·거절 없음 */
export interface ChatModeInputPolicy {
    /** PDF 앞쪽 페이지 vision 렌더 주입 */
    pdfVision: boolean;
    /** 메시지 내 URL 결정적 사전 분석 */
    urlPreanalysis: boolean;
    /** 이전 턴의 첨부·링크 컨텍스트 재주입 */
    reuseAttachContext: boolean;
    /** 설정돼 있으면 파일 첨부가 있는 요청을 이 문구로 거절한다(무음 폐기 대신 명시 거부) */
    rejectFileAttachmentsMessage?: string;
}

export interface ChatModeRunParams {
    req: ChatMessageRequest;
    /** 이 모드에 쓸 모델 클라이언트 — 모드별 해석(role·컴포저 선택)을 거친 것, 없으면 로컬 기본 */
    client: LLMClient;
    onToken: (token: string, thinking?: string) => void;
    /** 진행 상황 — 모양은 모드가 정한다(클라이언트의 그 모드 UI 와의 계약) */
    onProgress?: (progress: unknown) => void;
    abortSignal?: AbortSignal;
}

export interface ChatModeExtension {
    /** add-on id — 요청의 `modes[<id>]` 로 켠다 */
    id: string;
    /** 로그용 이름 */
    label: string;
    /** 구 클라이언트가 보내는 요청 불리언 필드 이름 — WS·REST 에서 이 필드가 true 면 모드를 켠 것으로 받는다 */
    legacyRequestFlag?: string;
    /** REST 채팅(`POST /api/chat`)에서도 켤 수 있는가 — false 면 WS 전용(장시간 모드는 전용 REST API 를 둔다) */
    availableOverRest: boolean;
    /** 진행 이벤트의 WS `type` — 클라이언트의 그 모드 UI 가 구독하는 이름 */
    progressEventType: string;
    /** 이 모드의 모델을 컴포저 선택보다 먼저 찾을 역할(role) 이름 — 외부로 해석될 때만 채택 */
    modelRole?: string;
    inputPolicy: ChatModeInputPolicy;
    /** 관련 내장 도구의 설명 끝에 덧붙일 안내 — 도구 이름 → 문장 (이 모드가 더 적합한 경우를 모델에 알린다) */
    relatedToolHints?: Readonly<Record<string, string>>;
    /** 턴을 실행하고 최종 응답 본문을 돌려준다 */
    run(params: ChatModeRunParams): Promise<string>;
}

let modes: ChatModeExtension[] | null = null;

export function getChatModes(): readonly ChatModeExtension[] {
    modes ??= loadEnabledChatModes();
    return modes;
}

/** 테스트 전용 — 모드 구성을 바꿔 끼운다. */
export function __setChatModesForTest(list: ChatModeExtension[] | null): void {
    modes = list;
}

/**
 * 요청 본문(WS chat 메시지·REST body)에서 켜진 모드를 모은다 — 등록된 모드의 것만 받는다.
 * 새 필드 `modes[<id>]` 가 우선이고, 없으면 모드가 선언한 구 불리언 필드를 본다.
 */
export function collectActiveModes(body: Record<string, unknown>, transport: 'ws' | 'rest' = 'ws'): Record<string, boolean> | undefined {
    const incoming = (body.modes && typeof body.modes === 'object' ? body.modes : {}) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const mode of getChatModes()) {
        if (transport === 'rest' && !mode.availableOverRest) continue;
        const explicit = incoming[mode.id];
        const on = typeof explicit === 'boolean'
            ? explicit
            : (mode.legacyRequestFlag ? body[mode.legacyRequestFlag] === true : false);
        if (on) out[mode.id] = true;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** 이 요청의 활성 모드 — 여러 개가 켜져 있으면 등록 순서상 첫 번째 */
export function resolveActiveMode(activeModes: Record<string, boolean> | undefined): ChatModeExtension | undefined {
    if (!activeModes) return undefined;
    return getChatModes().find((m) => activeModes[m.id] === true);
}

/** 일반 채팅의 입력 정책 */
export const DEFAULT_INPUT_POLICY: ChatModeInputPolicy = { pdfVision: true, urlPreanalysis: true, reuseAttachContext: true };

/** REST 채팅 스키마가 받을 모드 필드 이름 — 구 불리언 필드(REST 가용 모드만). 일반 필드 `modes` 는 스키마가 따로 받는다. */
export function restLegacyModeFlags(): string[] {
    return getChatModes().filter((m) => m.availableOverRest && m.legacyRequestFlag).map((m) => m.legacyRequestFlag as string);
}

/** 내장 도구 설명에 붙일 모드 안내 — 켜진 모드가 기여한 문장을 등록 순서로 잇는다(모드가 없으면 빈 문자열). */
export function toolDescriptionHint(toolName: string): string {
    return getChatModes().map((m) => m.relatedToolHints?.[toolName] ?? '').join('');
}
