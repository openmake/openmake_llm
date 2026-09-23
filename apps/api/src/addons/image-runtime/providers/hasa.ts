/**
 * image-runtime — provider 별 요청·응답 해석 (P04).
 * hasa Qwen-Image-Edit 는 `/v1/images/edits` multipart 가 아니라 `/v1/images/generations` JSON 에 `reference`(dataURL)를 받는다
 * (LiteLLM 통과). 그 외 provider 는 OpenAI images 규격.
 *
 * @module addons/image-runtime/providers/hasa
 */
import { IMAGE_GEN_ALLOWED_SIZES, IMAGE_GEN_DEFAULT_SIZE } from '../../../config/capabilities';
import type { InvokeOperation } from '../../../runtime-ports/model-invoker';

export interface ImagesResponse { data?: Array<{ b64_json?: string; url?: string }> }

type EditAdapter = 'openai-edits' | 'generations-reference';
const EDIT_ADAPTERS: Record<string, EditAdapter> = { hasa: 'generations-reference' };

export function editAdapterFor(providerId: string): EditAdapter {
    return EDIT_ADAPTERS[providerId] ?? 'openai-edits';
}

export function pickSize(extra: Record<string, unknown>, params: Readonly<Record<string, string>>): string {
    const requested = String(extra.size ?? params.size ?? '');
    return IMAGE_GEN_ALLOWED_SIZES.has(requested) ? requested : IMAGE_GEN_DEFAULT_SIZE;
}

/** 편집 요청 본문 — 어댑터별 연산·payload */
export function buildEditRequest(providerId: string, model: string, prompt: string, size: string, input: { dataUrl: string; bytes: Buffer; mime: string }): { operation: InvokeOperation; payload: Record<string, unknown> | FormData } {
    if (editAdapterFor(providerId) === 'generations-reference') {
        return { operation: 'images.generate_with_reference', payload: { model, prompt, reference: input.dataUrl, n: 1, size } };
    }
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size);
    fd.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'image.png');
    return { operation: 'images.edit', payload: fd };
}
