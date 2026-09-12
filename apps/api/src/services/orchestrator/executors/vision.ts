/**
 * @module services/orchestrator/executors/vision
 * @description vision.describe / vision.ocr — 배정 VLM 에 이미지를 image_url 블록으로 싣고 관찰 기록 텍스트를 받는다.
 * 역할(채팅) 모델을 바꿔치기하지 않는다 — 기록은 종합 단계의 근거로만 쓰인다.
 * (video.analyze·audio.analyze·music.analyze 는 검증된 provider 어댑터가 없어 `unsupported` — executors/index 참고)
 */
import { CAPABILITY_LIMITS } from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callJson, extractChatText, extractUsage } from '../http-call';
import { getVisionBridgeSystemPrompt } from '../../../prompts/vision-bridge';
import { loadAttachment } from '../media-io';
import { resolveTaskAttachments, type CapabilityExecutor } from '../types';

const OCR_KO = '당신은 OCR 기록자입니다. 이미지 속 글자·표·코드를 보이는 그대로, 순서대로, 빠짐없이 전사하세요. 해석·요약 금지. 표는 마크다운 표로.';
const OCR_EN = 'You are an OCR transcriber. Transcribe all text, tables, and code exactly as shown, in order, without interpretation. Render tables as markdown.';

export const visionExecutor: CapabilityExecutor = async (task, ctx) => {
    const atts = resolveTaskAttachments(task, ctx, new Set(['image'])).slice(0, CAPABILITY_LIMITS.VISION_MAX_IMAGES);
    if (atts.length === 0) throw new Error(`${task.capability}: 사용할 이미지 첨부가 없습니다 (attachments/refs 확인)`);
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget(task.capability, ctx.userId);

    const content: Array<Record<string, unknown>> = [
        { type: 'text', text: task.instruction || (ctx.lang === 'ko' ? '첨부 이미지를 서술하세요.' : 'Describe the attached image.') },
    ];
    for (const a of atts) {
        const loaded = await loadAttachment(a, { timeoutMs: CAPABILITY_LIMITS.VISION_TIMEOUT_MS, signal: ctx.signal, maxBytes: CAPABILITY_LIMITS.IMAGE_EDIT_MAX_INPUT_BYTES, allowTypes: ['image/'] });
        content.push({ type: 'image_url', image_url: { url: loaded.dataUrl, ...(target.params.detail ? { detail: target.params.detail } : {}) } });
    }
    const system = task.capability === 'vision.ocr' ? (ctx.lang === 'ko' ? OCR_KO : OCR_EN) : getVisionBridgeSystemPrompt(ctx.lang);
    const json = await callJson<unknown>(target, {
        body: { model: target.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], max_tokens: CAPABILITY_LIMITS.VISION_MAX_TOKENS, stream: false },
        timeoutMs: CAPABILITY_LIMITS.VISION_TIMEOUT_MS, signal: ctx.signal,
    });
    const text = extractChatText(json);
    if (!text) throw new Error('빈 응답');
    return { ok: true, text, media: [], model: target.fullId, usage: extractUsage(json) };
};
