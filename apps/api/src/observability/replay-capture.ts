/**
 * 결정적 재현 번들 (F24.7) — 마지막 LLM 요청 본문 스냅샷.
 *
 * 세션 전체를 파이프라인에 다시 태우면 메모리·스킬·도구 노출이 시점마다 달라 "재실행" 이 된다. 대신 모델에 실제로
 * 보낸 본문(모델·messages·tools·tool_choice·thinking)을 보관해 같은 입력으로 다시 보낸다 — 입력은 결정적, 출력은
 * 샘플링 탓에 준결정적이다.
 *
 * - 인증 헤더는 애초에 본문에 없고, 메시지 문자열은 `redactSecrets`, 이미지는 크기만 남기고 뺀다(개인정보·용량).
 * - 상한을 넘으면 도구 결과(긴 것부터) → 오래된 대화(system·마지막 user 는 유지) 순으로 자른다.
 * - 채팅 경로(`captureReplay`)는 이미지만 빼고 참조를 보관한다 — 마스킹·직렬화·절단은 오류·신고 시(`takeReplayBundle`)에만 한다(핫패스 비용 0에 가깝게).
 * - 저장은 메모리 LRU(세션별 마지막 N턴) → 오류·신고 시 꺼내 디버그 큐 행에 싣는다.
 *
 * @module observability/replay-capture
 */
import { redactSecrets } from '../utils/redact';
import { REPLAY_CAPTURE } from '../config/runtime-limits';

interface ReplayMessage {
    role: string;
    content: string;
    tool_calls?: unknown;
    tool_call_id?: string;
    tool_name?: string;
    /** 이미지는 빼고 개수·바이트만 */
    images_omitted?: { count: number; bytes: number };
}

export interface ReplayBundle {
    version: 1;
    requestId: string;
    capturedAt: string;
    provider: { providerId: string; modelId: string; fullId: string };
    thinking?: unknown;
    tool_choice?: unknown;
    tools?: unknown[];
    messages: ReplayMessage[];
    truncated: boolean;
}

export interface ReplayInput {
    requestId: string;
    provider: { providerId: string; modelId: string; fullId: string };
    messages: ReadonlyArray<{ role: string; content: string; images?: string[]; images_omitted?: { count: number; bytes: number }; tool_calls?: unknown; tool_call_id?: string; tool_name?: string }>;
    tools?: unknown[];
    tool_choice?: unknown;
    thinking?: unknown;
}

const byteLen = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** PURE: 요청 본문 → 번들(마스킹·이미지 제거·상한 절단). */
export function buildReplayBundle(input: ReplayInput, maxBytes: number = REPLAY_CAPTURE.MAX_BYTES, now: Date = new Date()): ReplayBundle {
    const messages: ReplayMessage[] = input.messages.map((m) => ({
        role: m.role,
        content: redactSecrets(m.content ?? ''),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_name ? { tool_name: m.tool_name } : {}),
        ...(m.images?.length ? { images_omitted: { count: m.images.length, bytes: m.images.reduce((n, i) => n + i.length, 0) } } : m.images_omitted ? { images_omitted: m.images_omitted } : {}),
    }));
    const bundle: ReplayBundle = {
        // provider 는 식별자 3개만 — 호출부가 ResolvedProvider 를 통째로 넘겨도 인스턴스(키·클라이언트)가 직렬화되지 않게
        version: 1, requestId: input.requestId, capturedAt: now.toISOString(),
        provider: { providerId: input.provider.providerId, modelId: input.provider.modelId, fullId: input.provider.fullId },
        ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
        ...(input.tool_choice !== undefined ? { tool_choice: input.tool_choice } : {}),
        ...(input.tools?.length ? { tools: input.tools } : {}),
        messages, truncated: false,
    };
    if (byteLen(bundle) <= maxBytes) return bundle;
    bundle.truncated = true;
    // 1) 도구 결과 — 긴 것부터 본문을 표식으로
    const toolIdx = messages.map((m, i) => ({ m, i })).filter((x) => x.m.role === 'tool').sort((a, b) => b.m.content.length - a.m.content.length);
    for (const { m } of toolIdx) {
        if (byteLen(bundle) <= maxBytes) return bundle;
        m.content = `[truncated tool result: ${m.content.length} chars]`;
    }
    // 2) 오래된 대화 — system·마지막 user 는 남긴다
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    for (let i = 0; i < messages.length && byteLen(bundle) > maxBytes; i++) {
        if (messages[i].role === 'system' || i === lastUser || messages[i].content.startsWith('[truncated')) continue;
        messages[i].content = `[truncated ${messages[i].role} message: ${messages[i].content.length} chars]`;
    }
    // 3) 그래도 넘으면 도구 스키마를 뺀다(이름만)
    if (byteLen(bundle) > maxBytes && bundle.tools) {
        bundle.tools = bundle.tools.map((t) => ({ name: (t as { function?: { name?: string } }).function?.name ?? 'unknown' }));
    }
    return bundle;
}

interface Slot { at: number; inputs: Array<{ input: ReplayInput; capturedAt: Date }> }
const store = new Map<string, Slot>();

function prune(now: number): void {
    for (const [k, v] of store) if (now - v.at > REPLAY_CAPTURE.TTL_MS) store.delete(k);
    while (store.size > REPLAY_CAPTURE.MAX_SESSIONS) store.delete(store.keys().next().value as string);
}

/** LLM 호출 직전 — 세션별 마지막 N턴 보관. 세션이 없는 요청은 보관하지 않는다(신고·디버그 큐가 세션 단위). */
export function captureReplay(sessionId: string | undefined, input: ReplayInput, now: number = Date.now()): void {
    if (!REPLAY_CAPTURE.ENABLED || !sessionId) return;
    // 이미지(base64)는 30분 보관하기엔 크다 — 개수·길이만 남긴 얕은 복사. 메시지 배열은 이후 도구 루프가 push 하므로 복사해 둔다
    const light: ReplayInput = {
        ...input,
        provider: { providerId: input.provider.providerId, modelId: input.provider.modelId, fullId: input.provider.fullId },
        messages: input.messages.map((m) => (m.images?.length ? { ...m, images: undefined, images_omitted: { count: m.images.length, bytes: m.images.reduce((n, i) => n + i.length, 0) } } : { ...m })),
    };
    const slot = store.get(sessionId);
    store.delete(sessionId); // 삽입 순서 갱신(LRU)
    store.set(sessionId, { at: now, inputs: [...(slot?.inputs ?? []), { input: light, capturedAt: new Date(now) }].slice(-REPLAY_CAPTURE.TURNS_PER_SESSION) });
    prune(now);
}

/**
 * 오류·신고 시 — 그 세션의 가장 최근 번들. userMessage 를 주면 번들의 마지막 user 메시지가 그 문장을 담을 때만 돌려준다
 * (같은 세션의 다음 턴 번들을 엉뚱한 신고에 붙이지 않게).
 */
export function takeReplayBundle(sessionId: string, userMessage?: string, now: number = Date.now()): ReplayBundle | undefined {
    const slot = store.get(sessionId);
    if (!slot || now - slot.at > REPLAY_CAPTURE.TTL_MS) return undefined;
    const last = slot.inputs[slot.inputs.length - 1];
    if (!last) return undefined;
    const latest = buildReplayBundle(last.input, REPLAY_CAPTURE.MAX_BYTES, last.capturedAt);
    if (userMessage === undefined) return latest;
    const lastUser = [...latest.messages].reverse().find((m) => m.role === 'user');
    const probe = redactSecrets(userMessage).slice(0, 200);
    return lastUser && lastUser.content.includes(probe) ? latest : undefined;
}

/** 테스트용 */
export function clearReplayStore(): void { store.clear(); }
