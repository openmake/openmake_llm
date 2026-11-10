/**
 * image-runtime — provider 별 요청·응답 해석 (P04).
 * hasa Qwen-Image-Edit 는 `/v1/images/edits` multipart 가 아니라 `/v1/images/generations` JSON 에 `reference`(dataURL)를 받는다
 * (LiteLLM 통과). 그 외 provider 는 OpenAI images 규격.
 *
 * @module addons/image-runtime/providers/hasa
 */
/** 이미지 생성 허용 size (OpenAI images 규격) — 종전 config/capabilities 에서 옮겼다(P10) */
export const IMAGE_GEN_ALLOWED_SIZES: ReadonlySet<string> = new Set(['1024x1024', '768x1024', '1024x768', '512x512']);
export const IMAGE_GEN_DEFAULT_SIZE = '1024x1024';
import type { InvokeOperation, OperationSpec } from '../../../runtime-ports/model-invoker';

export interface ImagesResponse { data?: Array<{ b64_json?: string; url?: string }> }

/**
 * provider 직결 이미지 — 게이트웨이(LiteLLM)를 거치지 않는다. LiteLLM 이미지 경로는 SDK 재시도를 2 로 고정해(헤더·본문·모델 등록·
 * 환경 변수로 못 끔) provider 가 5xx·429 를 주면 upstream 에 3회 보낸다(2026-11-11 실측: hasa 180초 timeout × 3 이 다음 요청과 겹쳐
 * 동시 요청 한도 경고). 직결은 http-call 이 재시도하지 않아 한 번 호출 = provider 한 번이다(hasa 영상과 같은 방식, SSRF 고정 fetch).
 * 경로는 키 행 주소(`…/v1`) 기준이라 `/v1` 을 붙이지 않는다.
 */
const DIRECT_IMAGE_PROVIDERS: ReadonlySet<string> = new Set(['hasa']);
export const IMAGE_DIRECT_ENDPOINT = '/images/generations';
const IMAGE_DIRECT_OP = 'images.direct.generate';
export const IMAGE_OPERATIONS: Readonly<Record<string, OperationSpec>> = {
    [IMAGE_DIRECT_OP]: { method: 'POST', path: IMAGE_DIRECT_ENDPOINT, body: 'json', response: 'json' },
};

export function isDirectImageProvider(providerId: string): boolean {
    return DIRECT_IMAGE_PROVIDERS.has(providerId);
}

/** 생성 연산 — 직결 provider 는 직결 연산, 그 밖은 게이트웨이 연산 */
export function generateOperationFor(providerId: string): InvokeOperation {
    return isDirectImageProvider(providerId) ? IMAGE_DIRECT_OP : 'images.generate';
}

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
        const operation = isDirectImageProvider(providerId) ? IMAGE_DIRECT_OP : 'images.generate_with_reference';
        return { operation, payload: { model, prompt, reference: input.dataUrl, n: 1, size } };
    }
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size);
    fd.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'image.png');
    return { operation: 'images.edit', payload: fd };
}
