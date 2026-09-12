/**
 * @module services/orchestrator/executors/image
 * @description image.generate(LiteLLM /v1/images/generations) · image.edit(OpenAI /v1/images/edits multipart 또는
 * hasa `generations`+`reference` JSON — 어댑터). 공통 호출 경계(http-call) 사용, 결과 PNG 는 /generated 저장.
 */
import { CAPABILITY_LIMITS, IMAGE_GEN_ALLOWED_SIZES, IMAGE_GEN_DEFAULT_SIZE, imageEditAdapterFor } from '../../../config/capabilities';
import { resolveCapabilityTarget, type CapabilityTarget } from '../capability-resolver';
import { callJson, downloadProviderUrl } from '../http-call';
import { loadAttachment, saveImage } from '../media-io';
import { refsRawText, resolveTaskAttachments, type CapabilityExecutor } from '../types';

interface ImagesResponse { data?: Array<{ b64_json?: string; url?: string }> }

/** origin(스킴·호스트·포트) 정확 일치 — startsWith 는 `api.example` 과 `api.example.attacker` 를 같다고 본다 */
function sameOrigin(a: string, b: string): boolean {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

async function imageBytes(json: ImagesResponse, target: CapabilityTarget, signal?: AbortSignal): Promise<Buffer> {
    const first = json.data?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
    if (first?.url) {
        // provider 가 URL 만 주는 경우 — SSRF 고정 fetch + image/* 검증 (게이트웨이 URL 이면 헤더 동봉)
        const { bytes } = await downloadProviderUrl(first.url, {
            timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal, allowTypes: ['image/'],
            headers: sameOrigin(first.url, target.baseUrl) ? target.headers : undefined,
        });
        return bytes;
    }
    throw new Error('응답에 이미지 데이터가 없습니다');
}

function pickSize(extra: Record<string, unknown>, params: Record<string, string>): string {
    const requested = String(extra.size ?? params.size ?? '');
    return IMAGE_GEN_ALLOWED_SIZES.has(requested) ? requested : IMAGE_GEN_DEFAULT_SIZE;
}

export const imageGenerateExecutor: CapabilityExecutor = async (task, ctx) => {
    const refs = refsRawText(task, ctx, 600);
    const prompt = [task.text || task.instruction, refs ? `Context: ${refs}` : ''].filter(Boolean).join('\n').trim();
    if (!prompt) throw new Error('image.generate: instruction(프롬프트)이 비어 있습니다');
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget('image.generate', ctx.userId);
    const size = pickSize(task.extra, target.params);
    // response_format 미전송 — LiteLLM 이 커스텀 image 모델에서 거부(UnsupportedParamsError), vLLM-Omni 는 b64_json 기본
    const json = await callJson<ImagesResponse>(target, { body: { model: target.model, prompt, n: 1, size }, timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal });
    const media = saveImage(await imageBytes(json, target, ctx.signal), prompt);
    return { ok: true, text: ctx.lang === 'ko' ? `이미지 생성 완료 (${size}): ${media.urlPath}` : `Image generated (${size}): ${media.urlPath}`, media: [media], model: target.fullId, usage: { units: { kind: 'images', count: 1 } } };
};

export const imageEditExecutor: CapabilityExecutor = async (task, ctx) => {
    const prompt = task.instruction.trim();
    if (!prompt) throw new Error('image.edit: instruction(수정 지시)이 비어 있습니다');
    const [source] = resolveTaskAttachments(task, ctx, new Set(['image']));
    if (!source) throw new Error('image.edit: 원본 이미지(attachments 또는 refs)가 없습니다');
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget('image.edit', ctx.userId);
    const input = await loadAttachment(source, { timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal, maxBytes: CAPABILITY_LIMITS.IMAGE_EDIT_MAX_INPUT_BYTES, allowTypes: ['image/'] });
    const size = pickSize(task.extra, target.params);
    const adapter = imageEditAdapterFor(target.providerId);
    let json: ImagesResponse;
    if (adapter.kind === 'generations-reference') {
        json = await callJson<ImagesResponse>(target, {
            url: `${target.baseUrl}/v1/images/generations`,
            body: { model: target.model, prompt, reference: input.dataUrl, n: 1, size },
            timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal,
        });
    } else {
        const fd = new FormData();
        fd.append('model', target.model); fd.append('prompt', prompt); fd.append('size', size);
        fd.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'image.png');
        json = await callJson<ImagesResponse>(target, { body: fd, timeoutMs: CAPABILITY_LIMITS.IMAGE_GEN_TIMEOUT_MS, signal: ctx.signal });
    }
    const media = saveImage(await imageBytes(json, target, ctx.signal), prompt, 'img-edit');
    return { ok: true, text: ctx.lang === 'ko' ? `이미지 편집 완료: ${media.urlPath}` : `Image edited: ${media.urlPath}`, media: [media], model: target.fullId, usage: { units: { kind: 'images', count: 1 } } };
};
