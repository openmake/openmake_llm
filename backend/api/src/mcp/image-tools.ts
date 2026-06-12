/**
 * ============================================================
 * Image Tools — 이미지 생성 내장 도구 (FLUX.2-klein via LiteLLM)
 * ============================================================
 *
 * LiteLLM proxy 의 OpenAI 호환 `/v1/images/generations` 를 호출한다
 * (vLLM-Omni 가 FLUX.2-klein 을 서빙, LiteLLM model_list 의 flux2-klein 항목).
 * 생성된 PNG 는 frontend 정적 경로(generated/)에 저장하고 마크다운 이미지
 * 링크를 반환 — 채팅 본문에 인라인 렌더된다 (CSP img-src 'self' 허용).
 *
 * 활성 조건: env IMAGE_GEN_MODEL 설정 시에만 동작 (미설정 시 안내 메시지).
 *
 * @module mcp/image-tools
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { MCPToolDefinition, MCPToolResult } from './types';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('ImageTools');

/** 이미지 생성 LLM 호출 타임아웃 — 디퓨전 1장 수십 초 가능 */
const IMAGE_GEN_TIMEOUT_MS = parseInt(process.env.IMAGE_GEN_TIMEOUT_MS || '', 10) || 180_000;

/** 허용 size 화이트리스트 (OpenAI images API 형식) */
const ALLOWED_SIZES = new Set(['1024x1024', '768x1024', '1024x768', '512x512']);

/** 생성 이미지 저장 디렉토리 — frontend 단일 원본 서빙 경로 (dist 기준 ../../../frontend/...) */
function resolveGeneratedDir(): string {
    return path.resolve(__dirname, '../../../../frontend/web/public/generated');
}

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
    handler: async (args): Promise<MCPToolResult> => {
        const model = process.env.IMAGE_GEN_MODEL;
        if (!model) {
            return textResult('이미지 생성 모델이 설정되어 있지 않습니다 (IMAGE_GEN_MODEL 미설정). 관리자에게 문의하세요.', true);
        }
        const prompt = String(args.prompt || '').trim();
        if (!prompt) return textResult('prompt 가 필요합니다.', true);
        const size = ALLOWED_SIZES.has(String(args.size)) ? String(args.size) : '1024x1024';

        const config = getConfig();
        try {
            const res = await fetch(`${config.llmBaseUrl}/v1/images/generations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.llmApiKey}`,
                },
                // response_format 미전송 — LiteLLM 이 커스텀 openai image 모델에서 이 파라미터를
                // 거부하며(UnsupportedParamsError), vLLM-Omni 기본 응답이 이미 b64_json 이다.
                body: JSON.stringify({ model, prompt, n: 1, size }),
                signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`이미지 생성 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`이미지 생성 실패 (HTTP ${res.status}). 잠시 후 다시 시도해주세요.`, true);
            }
            const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
            const b64 = json.data?.[0]?.b64_json;
            if (!b64) return textResult('이미지 생성 응답에 데이터가 없습니다.', true);

            const dir = resolveGeneratedDir();
            fs.mkdirSync(dir, { recursive: true });
            const filename = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
            fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));

            const alt = prompt.slice(0, 80).replace(/[[\]]/g, '');
            logger.info(`이미지 생성 완료: ${filename} (${size}, prompt ${prompt.length}자)`);
            return textResult(
                `이미지가 생성되었습니다. 아래 마크다운을 답변에 그대로 포함하세요:\n\n![${alt}](/generated/${filename})`
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
