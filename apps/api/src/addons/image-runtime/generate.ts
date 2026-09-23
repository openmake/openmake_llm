/**
 * image-runtime — image.generate · image.edit handler (Base·Add-on 통합 P04, 2026-09-23).
 * 종전 `services/orchestrator/executors/image.ts` 의 의미(프롬프트·refs·size·b64/url 응답·저장)를 그대로 옮겼다.
 * 차이는 호출 경계뿐이다 — provider 호출은 `ctx.model`(제한 포트), 저장은 `ctx.artifacts`(scoped 포트). 헤더·키를 보지 않는다.
 *
 * @module addons/image-runtime/generate
 */
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import type { CapabilityContext, CapabilityHandler } from '../../capability-contract/types';
import { loadAttachment } from '../../services/orchestrator/media-io';
import { refsRawText, resolveTaskAttachments, type TaskMedia } from '../../services/orchestrator/types';
import type { PlanTask } from '../../services/orchestrator/plan-schema';
import { buildEditRequest, pickSize, type ImagesResponse } from './providers/hasa';
import { IMAGE_REFS_MAX_CHARS } from './constants';

async function imageBytes(json: ImagesResponse, ctx: CapabilityContext): Promise<Buffer> {
    const first = json.data?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
    if (first?.url) {
        // provider 가 URL 만 주는 경우 — 포트가 SSRF 고정 fetch + image/* 검증 + 같은 origin 에만 자격증명(T09)
        const { bytes } = await ctx.model.download(first.url, { timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal, allowTypes: ['image/'] });
        return bytes;
    }
    throw new Error('응답에 이미지 데이터가 없습니다');
}

async function saveImage(ctx: CapabilityContext, bytes: Buffer, alt: string, prefix: string): Promise<TaskMedia> {
    const ref = await ctx.artifacts.save({ kind: 'image', prefix, ext: 'png', bytes, mime: 'image/png' });
    return { kind: 'image', urlPath: ref.urlPath, markdown: `![${alt.slice(0, 80).replace(/[[\]]/g, '')}](${ref.urlPath})` };
}

export const imageGenerateHandler: CapabilityHandler = {
    async execute(task: PlanTask, ctx: CapabilityContext) {
        const refs = refsRawText(task, ctx, IMAGE_REFS_MAX_CHARS);
        const prompt = [task.text || task.instruction, refs ? `Context: ${refs}` : ''].filter(Boolean).join('\n').trim();
        if (!prompt) throw new Error('image.generate: instruction(프롬프트)이 비어 있습니다');
        const target = ctx.model.describe();
        const size = pickSize(task.extra, target.params);
        // response_format 미전송 — LiteLLM 이 커스텀 image 모델에서 거부(UnsupportedParamsError), vLLM-Omni 는 b64_json 기본
        const json = await ctx.model.invokeJson<ImagesResponse>({ operation: 'images.generate', payload: { model: target.model, prompt, n: 1, size }, timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal });
        const media = await saveImage(ctx, await imageBytes(json, ctx), prompt, 'img');
        return { ok: true, text: ctx.lang === 'ko' ? `이미지 생성 완료 (${size}): ${media.urlPath}` : `Image generated (${size}): ${media.urlPath}`, media: [media], model: target.fullId, usage: { units: { kind: 'images', count: 1 } } };
    },
};

export const imageEditHandler: CapabilityHandler = {
    async execute(task: PlanTask, ctx: CapabilityContext) {
        const prompt = task.instruction.trim();
        if (!prompt) throw new Error('image.edit: instruction(수정 지시)이 비어 있습니다');
        const [source] = resolveTaskAttachments(task, ctx, new Set(['image']));
        if (!source) throw new Error('image.edit: 원본 이미지(attachments 또는 refs)가 없습니다');
        const target = ctx.model.describe();
        const input = await loadAttachment(source, { timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal, maxBytes: CAPABILITY_LIMITS.IMAGE_EDIT_MAX_INPUT_BYTES, allowTypes: ['image/'], userId: ctx.userId });
        const size = pickSize(task.extra, target.params);
        const req = buildEditRequest(target.providerId, target.model, prompt, size, input);
        const json = await ctx.model.invokeJson<ImagesResponse>({ operation: req.operation, payload: req.payload, timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal });
        const media = await saveImage(ctx, await imageBytes(json, ctx), prompt, 'img-edit');
        return { ok: true, text: ctx.lang === 'ko' ? `이미지 편집 완료: ${media.urlPath}` : `Image edited: ${media.urlPath}`, media: [media], model: target.fullId, usage: { units: { kind: 'images', count: 1 } } };
    },
};
