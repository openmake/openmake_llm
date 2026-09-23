/**
 * Restricted Model Invoker 포트 — Add-on 이 provider 를 부르는 **유일한** 문 (Base·Add-on 통합 P04, 2026-09-23).
 *
 * Base 가 실제 URL·인증 헤더·허용 메서드·응답 크기 상한·SSRF 검사를 결정하고(계획서 9.1), Add-on 에는 승인 handle 에 묶인
 * `invoke(operation, payload)` 만 준다. raw API key·임의 `Authorization`·임의 fetch 는 이 포트 밖으로 나가지 않는다(T08).
 * `operation` 은 아래 표에 사전 등록된 연산만 허용한다 — 모르는 연산은 거절(임의 URL 호출 불가).
 * provider 가 돌려준 외부 URL 재다운로드는 SSRF 고정 fetch 이고, 자격증명은 **origin 이 정확히 같을 때만** 동봉한다(T09).
 * 계측·세마포어·크기 상한·취소 전파는 기존 `http-call.ts` 를 그대로 재사용한다(검증된 보호 로직).
 *
 * @module runtime-ports/model-invoker
 */
import { ORCHESTRATOR } from '../config/capabilities';
import { HTTP_CALL_LIMITS, callBinary, callJson, downloadProviderUrl } from '../services/orchestrator/http-call';
import type { CapabilityTarget } from '../services/orchestrator/capability-resolver';
import type { ApprovedInvocationHandle } from '../capability-contract/admission';

/** 사전 등록 연산 — 경로·본문 형식·응답 형식을 Base 가 정한다 */
const OPERATIONS = {
    'images.generate': { path: '/v1/images/generations', body: 'json', response: 'json' },
    'images.generate_with_reference': { path: '/v1/images/generations', body: 'json', response: 'json' },
    'images.edit': { path: '/v1/images/edits', body: 'form', response: 'json' },
    'audio.speech': { path: '/v1/audio/speech', body: 'json', response: 'binary' },
    'audio.transcriptions': { path: '/v1/audio/transcriptions', body: 'form', response: 'json' },
    'chat.completions': { path: '/v1/chat/completions', body: 'json', response: 'json' },
    /** 게이트웨이 pass-through — ACE-Step 이 `message.audio` 를 배열로 줘 LiteLLM model_list 로는 역직렬화가 500 난다(2026-09-23) */
    'music.chat_completions': { path: '/music/v1/chat/completions', body: 'json', response: 'json' },
} as const;
export type InvokeOperation = keyof typeof OPERATIONS;

/** Add-on 이 보는 실행 대상 — 헤더·키 없음(관측·분기용) */
export interface InvocationTargetInfo {
    providerId: string;
    model: string;
    fullId: string;
    source: CapabilityTarget['source'];
    costOwner: CapabilityTarget['costOwner'];
    transport: CapabilityTarget['transport'];
    params: Readonly<Record<string, string>>;
}

export interface RestrictedModelInvoker {
    describe(): InvocationTargetInfo;
    /** JSON 응답 연산 */
    invokeJson<T>(req: { operation: InvokeOperation; payload: Record<string, unknown> | FormData; timeoutMs: number; signal?: AbortSignal }): Promise<T>;
    /** 바이너리 응답 연산(TTS 등) */
    invokeBinary(req: { operation: InvokeOperation; payload: Record<string, unknown> | FormData; timeoutMs: number; signal?: AbortSignal }): Promise<{ bytes: Buffer; contentType: string }>;
    /** provider 가 응답에 넣어 준 URL 을 받아 온다 — SSRF 고정, 자격증명은 같은 origin 에만 */
    download(url: string, opts: { allowTypes: readonly string[]; timeoutMs: number; signal?: AbortSignal; maxBytes?: number }): Promise<{ bytes: Buffer; contentType: string }>;
}

function sameOrigin(a: string, b: string): boolean {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function checkOperation(operation: string, expectResponse: 'json' | 'binary'): { path: string; body: 'json' | 'form' } {
    const op = (OPERATIONS as Record<string, { path: string; body: 'json' | 'form'; response: 'json' | 'binary' }>)[operation];
    if (!op) throw new Error(`허용되지 않는 연산: ${operation}`);
    if (op.response !== expectResponse) throw new Error(`연산 '${operation}' 은 ${op.response} 응답이라 이 메서드로 부를 수 없습니다`);
    return op;
}

function checkPayload(op: { body: 'json' | 'form' }, payload: unknown): void {
    const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
    if (op.body === 'form' && !isForm) throw new Error('이 연산은 multipart(FormData) 본문이어야 합니다');
    if (op.body === 'json' && isForm) throw new Error('이 연산은 JSON 본문이어야 합니다');
}

/**
 * handle 과 preflight 가 해석한 target 을 닫아 넣는다 — target(헤더 포함)은 클로저 안에만 있고 반환 객체에 노출되지 않는다.
 * 타임아웃은 Base 상한(TASK_TIMEOUT_MS) 안에서만 유효하다.
 */
export function createRestrictedInvoker(handle: ApprovedInvocationHandle, target: CapabilityTarget): RestrictedModelInvoker {
    if (target.capability !== handle.capability) throw new Error(`승인 handle(${handle.capability})과 실행 대상(${target.capability})이 다릅니다`);
    const cap = (ms: number) => Math.min(Math.max(1, ms), ORCHESTRATOR.TASK_TIMEOUT_MS);
    return {
        describe: () => ({ providerId: target.providerId, model: target.model, fullId: target.fullId, source: target.source, costOwner: target.costOwner, transport: target.transport, params: { ...target.params } }),
        invokeJson: async (req) => {
            const op = checkOperation(req.operation, 'json'); checkPayload(op, req.payload);
            return callJson(target, { url: `${target.baseUrl}${op.path}`, body: req.payload as Record<string, unknown> | FormData, timeoutMs: cap(req.timeoutMs), signal: req.signal });
        },
        invokeBinary: async (req) => {
            const op = checkOperation(req.operation, 'binary'); checkPayload(op, req.payload);
            return callBinary(target, { url: `${target.baseUrl}${op.path}`, body: req.payload as Record<string, unknown> | FormData, timeoutMs: cap(req.timeoutMs), signal: req.signal });
        },
        download: async (url, opts) => downloadProviderUrl(url, {
            timeoutMs: cap(opts.timeoutMs), signal: opts.signal, allowTypes: opts.allowTypes, maxBytes: opts.maxBytes ?? HTTP_CALL_LIMITS.BINARY_MAX_BYTES,
            headers: sameOrigin(url, target.baseUrl) ? target.headers : undefined,
        }),
    };
}
