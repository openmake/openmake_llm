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
import { IMAGE_GEN_ALLOWED_SIZES, IMAGE_GEN_DEFAULT_SIZE, MODALITY_LIMITS } from '../config/modality';
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
            '프롬프트는 영어로 구체적으로 작성할수록 품질이 좋습니다 (주제, 스타일, 조명, 구도).',
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

export const imageTools: MCPToolDefinition[] = [generateImageTool];
