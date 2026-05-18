/**
 * ============================================================
 * Image MIME Inference - Base64 magic number → MIME type
 * ============================================================
 *
 * data: URI 가 없는 raw base64 이미지 입력에 대해 정확한 Content-Type 을 부여합니다.
 * OpenAI Vision spec / vLLM multimodal payload 가 JPEG/WEBP/GIF 도 정확한 MIME 으로
 * 받아야 처리 가능. 이전엔 `data:image/png;base64,...` hardcode 였으나, 운영자가
 * JPEG/WebP 첨부 시 silent corruption 위험이 있어 magic number 기반 추론으로 통일.
 *
 * @module utils/image-mime
 *
 * @see providers/openai-compat-provider.ts — 외부 OpenAI 호환 provider 로 보낼 때 사용
 * @see llm/stream-parser.ts — 내부 LLM (vLLM/LiteLLM) 로 보낼 때 사용
 */

/**
 * base64 이미지의 magic number 로 MIME 타입 추론.
 *
 * Magic number 매핑:
 * - PNG  : 파일 시그니처 89 50 4E 47 → base64 'iVBORw0K...'
 * - JPEG : 파일 시그니처 FF D8 FF    → base64 '/9j/...'
 * - GIF  : 파일 시그니처 47 49 46 38 → base64 'R0lGOD...'
 * - WEBP : 파일 시그니처 RIFF....WEBP → base64 'UklGR...'
 *
 * 알려지지 않은 형식은 PNG 폴백 — 대부분 vision API 가 PNG 처리, 안전한 기본값.
 *
 * @param b64 - base64 인코딩 (data: URI prefix 제외) 이미지 문자열
 * @returns MIME 타입 (예: 'image/jpeg')
 */
export function inferImageMime(b64: string): string {
    if (b64.startsWith('iVBORw0K')) return 'image/png';
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    if (b64.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
}

/**
 * 입력에 대해 OpenAI Vision payload 형식의 URL 을 반환.
 *
 * vLLM Multimodal spec (features/multimodal_inputs/) 가 허용하는 URL 형태:
 *   1. `data:<mime>;base64,...` — 인라인 base64 (그대로 통과)
 *   2. `https://...` / `http://...` — 외부 URL (vLLM 이 fetch — `--allowed-media-domains` 제약)
 *   3. `file:///path` — 로컬 파일 (vLLM `--allowed-local-media-path` 활성 시)
 *   4. raw base64 — magic number 로 MIME 추론 후 `data:` URI 로 wrapping
 *
 * 이전 (2026-05-19 patch 1차) 은 (2)(3) 도 base64 로 잘못 wrapping 해
 * `data:image/png;base64,https://...` 같은 corrupt URL 생성 → 수정.
 *
 * @param img - base64, data: URI, http(s):// URL, 또는 file:// URL
 * @returns OpenAI Vision spec 의 image_url 에 들어갈 URL 문자열
 */
export function buildImageDataUrl(img: string): string {
    // 이미 완전한 URI 형태면 그대로 통과 — wrapping 금지.
    if (img.startsWith('data:')) return img;
    if (img.startsWith('http://') || img.startsWith('https://')) return img;
    if (img.startsWith('file://')) return img;
    // raw base64 — magic number 로 MIME 추론.
    return `data:${inferImageMime(img)};base64,${img}`;
}
