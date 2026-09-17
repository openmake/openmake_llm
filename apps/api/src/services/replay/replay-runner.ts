/**
 * 재현 번들 리플레이 (F24.7) — 보관된 LLM 요청 본문을 같은 모델(또는 지정 모델)로 다시 보내 저장된 응답과 비교한다.
 *
 * - 로컬 모델 번들은 그대로 LLMClient(게이트웨이)로 재전송한다. 외부 provider 번들은 사용자 BYOK 없이 같은 경로로
 *   보낼 수 없어 `model` 을 명시해야 한다(로컬·게이트웨이 모델로 바꿔 입력 재현성만 본다).
 * - seed 는 LLMClient 옵션에 없어 지원하지 않는다 — 입력은 결정적, 출력은 준결정적(기본 temperature 0).
 *
 * @module services/replay/replay-runner
 */
import { LLMClient } from '../../llm';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import type { ReplayBundle } from '../../observability/replay-capture';

/** PURE: 글자 bigram Dice 유사도(0~1) — 한글·영문 공통, 공백 무시. */
export function textSimilarity(a: string, b: string): number {
    const grams = (s: string): Map<string, number> => {
        const t = s.replace(/\s+/g, '');
        const m = new Map<string, number>();
        for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
        return m;
    };
    const ga = grams(a);
    const gb = grams(b);
    const total = [...ga.values()].reduce((n, v) => n + v, 0) + [...gb.values()].reduce((n, v) => n + v, 0);
    if (total === 0) return a.trim() === b.trim() ? 1 : 0;
    let overlap = 0;
    for (const [k, v] of ga) overlap += Math.min(v, gb.get(k) ?? 0);
    return (2 * overlap) / total;
}

/** PURE: 리플레이 대상 모델 — 로컬 번들은 원 모델, 외부 번들은 명시 모델 필수. */
export function resolveReplayModel(bundle: ReplayBundle, override?: string): string {
    if (override) return override;
    if (bundle.provider.providerId === 'local-llm') return bundle.provider.modelId;
    throw new Error(`외부 provider(${bundle.provider.providerId}) 번들은 model 을 지정해야 합니다(사용자 키 없이 같은 provider 로 재전송 불가)`);
}

/** PURE: 번들 → LLMClient 입력(이미지 생략 표시는 본문 끝에 남긴다, 도구 스키마가 이름만 남은 절단 번들은 도구 없이). */
export function bundleToChatInput(bundle: ReplayBundle): { messages: ChatMessage[]; tools?: ToolDefinition[] } {
    const messages = bundle.messages.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.images_omitted ? `${m.content}\n[replay: 이미지 ${m.images_omitted.count}장 생략]` : m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls as ChatMessage['tool_calls'] } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_name ? { tool_name: m.tool_name } : {}),
    })) as ChatMessage[];
    const fullTools = (bundle.tools ?? []).every((t) => !!(t as { function?: unknown }).function);
    return { messages, ...(bundle.tools?.length && fullTools ? { tools: bundle.tools as ToolDefinition[] } : {}) };
}

export interface ReplayResult { model: string; content: string; durationMs: number; similarity: number | null; toolCalls: string[] }

export async function runReplay(bundle: ReplayBundle, opts: { model?: string; temperature?: number; expected?: string }): Promise<ReplayResult> {
    const model = resolveReplayModel(bundle, opts.model);
    const { messages, tools } = bundleToChatInput(bundle);
    const client = new LLMClient({ model, maxRetries: 0 });
    const started = Date.now();
    const res = await client.chat(messages, { temperature: opts.temperature ?? 0 }, undefined, {
        ...(tools ? { tools } : {}),
        ...(bundle.thinking !== undefined ? { think: bundle.thinking as never } : {}),
    });
    return {
        model,
        content: res.content ?? '',
        durationMs: Date.now() - started,
        similarity: opts.expected !== undefined ? textSimilarity(res.content ?? '', opts.expected) : null,
        toolCalls: (res.tool_calls ?? []).map((c) => c.function.name),
    };
}
