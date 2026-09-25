/**
 * @module services/orchestrator/executors/text
 * @description text.reason / text.code — 배정 모델로 LiteLLM chat/completions 비스트림 1회(공통 호출 경계 http-call).
 * 종합(text.synthesize)은 채팅 모델 스트리밍 경로가 맡으므로 여기 없다.
 */
import { CAPABILITY_LIMITS, ORCHESTRATOR } from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callJson, extractChatText, extractUsage } from '../http-call';
import { getTextWorkerSystemPrompt } from '../../../prompts/svc-orchestrator-executors';
import { refsText, type CapabilityExecutor } from '../types';
import { buildExtraBody } from '../../../llm/reasoning-adapter';

export const textExecutor: CapabilityExecutor = async (task, ctx) => {
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget(task.capability, ctx.userId);
    const refs = refsText(task, ctx, ORCHESTRATOR.RESULT_MAX_CHARS);
    const ko = ctx.lang === 'ko';
    const system = getTextWorkerSystemPrompt(ctx.lang);
    // 머리글도 응답 언어로 — 영어 턴에 한국어 머리글이 섞이면 결과가 한국어로 나오고, 그 결과가
    // image.generate refs 로 들어가 이미지 안에 깨진 한글이 그려졌다(2026-09-14).
    const user = [
        task.instruction ? `${ko ? '## 지시' : '## Instruction'}\n${task.instruction}` : '',
        `${ko ? '## 사용자 원문' : '## User message'}\n${ctx.userMessage}`,
        refs ? `${ko ? '## 앞선 작업 결과' : '## Earlier task results'}\n${refs}` : '',
    ].filter(Boolean).join('\n\n');
    const body: Record<string, unknown> = {
        model: target.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: CAPABILITY_LIMITS.TEXT_MAX_TOKENS,
        stream: false,
    };
    if (target.params.temperature) body.temperature = Number(target.params.temperature);
    // 로컬 모델은 추론을 명시적으로 끈다 — 미지정이면 서버 기본(추론 ON)이라 27B 가 13~163초를 쓰고
    // TEXT_TIMEOUT_MS(180초)에 걸렸다(2026-09-23 실사용 검토). 외부 provider 는 이 필드를 거절할 수 있어 제외.
    if (target.providerId === 'local-llm') Object.assign(body, buildExtraBody(false, target.model));
    const json = await callJson<unknown>(target, { body, timeoutMs: CAPABILITY_LIMITS.TEXT_TIMEOUT_MS, signal: ctx.signal });
    const text = extractChatText(json);
    if (!text) throw new Error('빈 응답');
    return { ok: true, text, media: [], model: target.fullId, usage: extractUsage(json) };
};
