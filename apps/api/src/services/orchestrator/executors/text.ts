/**
 * @module services/orchestrator/executors/text
 * @description text.reason / text.code — 배정 모델로 LiteLLM chat/completions 비스트림 1회(공통 호출 경계 http-call).
 * 종합(text.synthesize)은 채팅 모델 스트리밍 경로가 맡으므로 여기 없다.
 */
import { CAPABILITY_LIMITS, ORCHESTRATOR } from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callJson, extractChatText, extractUsage } from '../http-call';
import { refsText, type CapabilityExecutor } from '../types';

export const textExecutor: CapabilityExecutor = async (task, ctx) => {
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget(task.capability, ctx.userId);
    const refs = refsText(task, ctx, ORCHESTRATOR.RESULT_MAX_CHARS);
    const system = ctx.lang === 'ko'
        ? '당신은 오케스트레이터의 하위 작업자입니다. 주어진 지시만 수행하고 결과를 간결한 텍스트로 돌려주세요. 인사·서두 없이 본문만.'
        : 'You are a sub-task worker of an orchestrator. Do only what the instruction says and return a concise plain-text result without preamble.';
    const user = [
        task.instruction ? `## 지시\n${task.instruction}` : '',
        `## 사용자 원문\n${ctx.userMessage}`,
        refs ? `## 앞선 작업 결과\n${refs}` : '',
    ].filter(Boolean).join('\n\n');
    const body: Record<string, unknown> = {
        model: target.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: CAPABILITY_LIMITS.TEXT_MAX_TOKENS,
        stream: false,
    };
    if (target.params.temperature) body.temperature = Number(target.params.temperature);
    const json = await callJson<unknown>(target, { body, timeoutMs: CAPABILITY_LIMITS.TEXT_TIMEOUT_MS, signal: ctx.signal });
    const text = extractChatText(json);
    if (!text) throw new Error('빈 응답');
    return { ok: true, text, media: [], model: target.fullId, usage: extractUsage(json) };
};
