/**
 * ============================================================
 * Image Tools — 이미지 생성 내장 도구 (모달리티 배정 → LiteLLM)
 * ============================================================
 *
 * 모델은 모달리티 배정(`image_gen`, services/modality-resolver — 사용자 오버라이드 →
 * 전역 DB → 코드 기본값 flux2-klein)으로 정하고, 호출은 LiteLLM 게이트웨이의 OpenAI 호환
 * `/v1/images/generations` 하나로만 간다(로컬 alias·외부 `<provider>/<model>` 공통).
 * 구 `IMAGE_GEN_MODEL` env 고정 호출은 2026-09-12 폐기 — 부팅 시더로만 1회 읽는다.
 *
 * 생성된 PNG 는 frontend 정적 경로(generated/)에 저장하고 마크다운 이미지
 * 링크를 반환 — 채팅 본문에 인라인 렌더된다 (CSP img-src 'self' 허용).
 *
 * @module mcp/image-tools
 */
import { MCPToolDefinition, MCPToolResult } from './types';
import { saveGeneratedFile } from './generated-media';
import { IMAGE_GEN_ALLOWED_SIZES, IMAGE_GEN_DEFAULT_SIZE, IMAGE_EDIT_MAX_INPUT_BYTES, MODALITY_LIMITS, imageEditAdapterFor } from '../config/modality';
import { resolveGeneratedPath } from './generated-media';
import { safeFetch } from '../security/ssrf-guard';
import { inferImageMime } from '../utils/image-mime';
import * as fs from 'node:fs';
import { resolveModalityTarget, ModalityUnavailableError } from '../services/modality-resolver';
import { withProviderSlot } from '../llm/external-throttle';
import { createLogger } from '../utils/logger';

const logger = createLogger('ImageTools');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

export const generateImageTool: MCPToolDefinition = {
    tool: {
        name: 'generate_image',
        description:
            '텍스트 프롬프트로 이미지를 생성합니다 (FLUX.2 디퓨전 모델). ' +
            '사용자가 그림/사진/일러스트/포스터 등 픽셀 이미지를 "그려줘/만들어줘"라고 하면 이 도구를 사용하세요. ' +
            '결과로 받은 마크다운 이미지 링크를 답변에 그대로 포함하면 채팅에 이미지가 표시됩니다. ' +
            '프롬프트는 영어로 구체적으로 작성할수록 품질이 좋습니다 (주제, 스타일, 조명, 구도). ' +
            '기존 이미지를 수정·변형해 달라는 요청은 edit_image 도구(있으면)를, 없으면 이 도구를 다시 호출해 새 이미지를 만드세요 — ' +
            '도구 호출 없이 /generated/ 경로나 파일명을 지어내 답하면 안 됩니다(존재하지 않는 링크는 제거됩니다).',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: '이미지 생성 프롬프트 (영어 권장, 구체적으로)' },
                size: { type: 'string', description: '이미지 크기 — 1024x1024(기본) | 768x1024 | 1024x768 | 512x512' },
            },
            required: ['prompt'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const prompt = String(args.prompt || '').trim();
        if (!prompt) return textResult('prompt 가 필요합니다.', true);

        const userId = context?.userId !== undefined ? String(context.userId) : undefined;
        let target;
        try {
            target = await resolveModalityTarget('image_gen', userId);
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`이미지 생성 불가: ${e.message}`, true);
            throw e;
        }
        // 인자 size > 배정 params.size > 기본. 화이트리스트 밖은 기본으로.
        const requested = String(args.size ?? target.params.size ?? '');
        const size = IMAGE_GEN_ALLOWED_SIZES.has(requested) ? requested : IMAGE_GEN_DEFAULT_SIZE;

        try {
            const res = await withProviderSlot(target.providerId, () => fetch(`${target.baseUrl}${target.endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...target.headers },
                // response_format 미전송 — LiteLLM 이 커스텀 openai image 모델에서 이 파라미터를
                // 거부하며(UnsupportedParamsError), vLLM-Omni 기본 응답이 이미 b64_json 이다.
                body: JSON.stringify({ model: target.model, prompt, n: 1, size }),
                signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS),
            }));
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`이미지 생성 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`이미지 생성 실패 (HTTP ${res.status}). 잠시 후 다시 시도해주세요.`, true);
            }
            const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
            let b64 = json.data?.[0]?.b64_json;
            // 외부 provider 는 url 만 주는 경우가 있다 — 게이트웨이 응답의 url 을 받아 저장 (같은 타임아웃)
            if (!b64 && json.data?.[0]?.url) {
                const img = await fetch(json.data[0].url, { signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS) });
                if (img.ok) b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
            }
            if (!b64) return textResult('이미지 생성 응답에 데이터가 없습니다.', true);

            const { filename, urlPath } = saveGeneratedFile('img', 'png', Buffer.from(b64, 'base64'));

            const alt = prompt.slice(0, 80).replace(/[[\]]/g, '');
            logger.info(`이미지 생성 완료: ${filename} (${target.fullId}/${target.source}, ${size}, prompt ${prompt.length}자)`);
            return textResult(
                `이미지가 생성되었습니다. 아래 마크다운을 답변에 그대로 포함하세요:\n\n![${alt}](${urlPath})`
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`이미지 생성 오류: ${msg}`);
            const friendly = msg.includes('timeout') || msg.includes('Timeout')
                ? '이미지 생성 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
                : `이미지 생성 중 오류: ${msg}`;
            return textResult(friendly, true);
        }
    },
};

/** 편집 입력 이미지 로드 — /generated 경로(실파일), https(SSRF 고정), base64 */
async function loadEditInput(args: Record<string, unknown>): Promise<{ dataUrl: string; bytes: Buffer; mime: string } | string> {
    const base64 = typeof args.image_base64 === 'string' ? args.image_base64.trim() : '';
    const url = typeof args.image_url === 'string' ? args.image_url.trim() : '';
    const fromBuf = (buf: Buffer, mime: string) => ({ dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf, mime });
    if (base64) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(base64);
        const raw = m ? m[2] : base64;
        const buf = Buffer.from(raw, 'base64');
        return fromBuf(buf, m ? m[1] : inferImageMime(raw));
    }
    if (url.startsWith('/generated/')) {
        const abs = resolveGeneratedPath(url);
        if (!abs) return `찾을 수 없는 파일: ${url}`;
        const buf = fs.readFileSync(abs);
        return fromBuf(buf, inferImageMime(buf.toString('base64', 0, 64)));
    }
    if (/^https?:\/\//i.test(url)) {
        const res = await safeFetch(url, { signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS) });
        if (!res.ok) return `이미지 다운로드 실패 (HTTP ${res.status})`;
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim();
        return fromBuf(buf, ct.startsWith('image/') ? ct : inferImageMime(buf.toString('base64', 0, 64)));
    }
    return 'image_url(/generated/<file> 또는 https://…) 또는 image_base64 가 필요합니다.';
}

export const editImageTool: MCPToolDefinition = {
    tool: {
        name: 'edit_image',
        description:
            '기존 이미지를 지시문대로 수정·변형합니다(이미지 편집 모델). 사용자가 "이 이미지에서 ~를 바꿔/지워/추가해줘" 처럼 ' +
            '기존 이미지를 고쳐 달라고 하면 사용하세요. image_url 에는 이전에 생성된 /generated/<file> 경로나 https 주소를 넣습니다. ' +
            '결과 마크다운 이미지 링크를 답변에 그대로 포함하세요. 파일명을 지어내 답하면 안 됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                image_url: { type: 'string', description: '편집할 원본 — /generated/<file> 또는 https://…' },
                image_base64: { type: 'string', description: '원본 base64/dataURL (image_url 대신)' },
                prompt: { type: 'string', description: '수정 지시 (영어 권장, 무엇을 어떻게 바꿀지 구체적으로)' },
                size: { type: 'string', description: '출력 크기 — 1024x1024(기본) | 768x1024 | 1024x768 | 512x512' },
            },
            required: ['prompt'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const prompt = String(args.prompt || '').trim();
        if (!prompt) return textResult('prompt 가 필요합니다.', true);
        const userId = context?.userId !== undefined ? String(context.userId) : undefined;
        let target;
        try {
            target = await resolveModalityTarget('image_edit', userId);
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`이미지 편집 불가: ${e.message}`, true);
            throw e;
        }
        const requested = String(args.size ?? target.params.size ?? '');
        const size = IMAGE_GEN_ALLOWED_SIZES.has(requested) ? requested : IMAGE_GEN_DEFAULT_SIZE;
        try {
            const input = await loadEditInput(args);
            if (typeof input === 'string') return textResult(input, true);
            if (input.bytes.length > IMAGE_EDIT_MAX_INPUT_BYTES) return textResult(`원본 이미지가 너무 큽니다 (${input.bytes.length}B > ${IMAGE_EDIT_MAX_INPUT_BYTES}B).`, true);

            const adapter = imageEditAdapterFor(target.providerId);
            let res: Response;
            if (adapter.kind === 'generations-reference') {
                // hasa: /v1/images/generations JSON + reference(dataURL) — LiteLLM 이 통과시킨다
                res = await withProviderSlot(target.providerId, () => fetch(`${target.baseUrl}/v1/images/generations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...target.headers },
                    body: JSON.stringify({ model: target.model, prompt, reference: input.dataUrl, n: 1, size }),
                    signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS),
                }));
            } else {
                // OpenAI 규격: /v1/images/edits multipart
                const fd = new FormData();
                fd.append('model', target.model);
                fd.append('prompt', prompt);
                fd.append('size', size);
                fd.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'image.png');
                res = await withProviderSlot(target.providerId, () => fetch(`${target.baseUrl}${target.endpoint}`, {
                    method: 'POST',
                    headers: { ...target.headers },
                    body: fd,
                    signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS),
                }));
            }
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`이미지 편집 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`이미지 편집 실패 (HTTP ${res.status}). ${body.slice(0, 160)}`, true);
            }
            const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
            let b64 = json.data?.[0]?.b64_json;
            if (!b64 && json.data?.[0]?.url) {
                const img = await fetch(json.data[0].url, { signal: AbortSignal.timeout(MODALITY_LIMITS.IMAGE_GEN_TIMEOUT_MS) });
                if (img.ok) b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
            }
            if (!b64) return textResult('이미지 편집 응답에 데이터가 없습니다.', true);
            const { filename, urlPath } = saveGeneratedFile('img-edit', 'png', Buffer.from(b64, 'base64'));
            const alt = prompt.slice(0, 80).replace(/[[\]]/g, '');
            logger.info(`이미지 편집 완료: ${filename} (${target.fullId}/${target.source}, ${adapter.kind}, ${size})`);
            return textResult(`이미지가 편집되었습니다. 아래 마크다운을 답변에 그대로 포함하세요:\n\n![${alt}](${urlPath})`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`이미지 편집 오류: ${msg}`);
            return textResult(/timeout/i.test(msg) ? '이미지 편집 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' : `이미지 편집 중 오류: ${msg}`, true);
        }
    },
};

export const imageTools: MCPToolDefinition[] = [generateImageTool, editImageTool];
