/**
 * ============================================================
 * Agent Loop — 단일 도구 호출 실행
 * ============================================================
 * agent-loop-strategy.ts 에서 분리 (파일 크기 가드 — 도구 실행 책임 분리).
 * this 상태 비의존(순수) — context 파라미터 + leaf deps 만 사용 → 순환 없음.
 * 내장 도구(web_search/web_fetch/vision_ocr/analyze_image) 직접 처리 + 그 외 ToolRouter 위임.
 *
 * @module services/chat-strategies/agent-loop-execute-tool
 */
import { canUseTool } from '../../mcp/tool-tiers';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { VISION_OCR_SYSTEM_PROMPT, VISION_ANALYSIS_SYSTEM_PROMPT, buildVisionOcrUserMessage } from '../../prompts/vision-system';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { TRUNCATION } from '../../config/runtime-limits';
import type { AgentLoopStrategyContext } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentLoopExecuteTool');

/**
 * 단일 도구 호출을 실행합니다.
 *
 * 실행 순서:
 * 1. 도구 호출 유효성 검사
 * 2. 사용자 티어 기반 접근 권한 검사
 * 3. 내장 도구 직접 처리 (web_search, web_fetch, vision_ocr, analyze_image)
 * 4. 기타 도구는 ToolRouter를 통해 MCP 도구로 실행
 *
 * @param context - AgentLoop 컨텍스트 (사용자 컨텍스트, 클라이언트 등)
 * @param toolCall - LLM이 요청한 도구 호출 정보
 * @param toolCall.type - 도구 호출 유형
 * @param toolCall.function.name - 호출할 도구 이름
 * @param toolCall.function.arguments - 도구 인자
 * @returns 도구 실행 결과 문자열 (에러 시 Error: 접두사)
 */
export async function executeToolCall(context: AgentLoopStrategyContext, toolCall: {
    type?: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}): Promise<string> {
    if (!toolCall.function || !toolCall.function.name) return 'Error: Invalid tool call';

    const toolName = toolCall.function.name;
    const toolArgs = toolCall.function.arguments;

    // 사용자 티어 기반 도구 접근 권한 검사
    if (context.currentUserContext) {
        const userTier = context.currentUserContext.tier;
        if (!canUseTool(userTier, toolName)) {
            const tierLabel = {
                free: '무료',
                pro: '프로',
                enterprise: '엔터프라이즈',
            }[userTier];

            logger.warn(`⚠️ 도구 접근 거부: ${toolName} (tier: ${userTier})`);
            return `🔒 권한 없음: ${tierLabel} 등급에서는 "${toolName}" 도구를 사용할 수 없습니다. 업그레이드가 필요합니다.`;
        }
    }

    logger.info(`🔨 Executing Tool: ${toolName} (tier: ${context.currentUserContext?.tier || 'unknown'})`, toolArgs);

    // 내장 도구 직접 처리: web_search
    if (toolName === 'web_search') {
        try {
            const query = typeof toolArgs.query === 'string' ? toolArgs.query : '';
            const maxResults = typeof toolArgs.max_results === 'number' ? toolArgs.max_results : 5;
            const response = await context.client.webSearch(query, maxResults);

            if (response.results && response.results.length > 0) {
                const formatted = response.results.map((r, i) =>
                    `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.substring(0, TRUNCATION.WEB_SNIPPET_MAX) || ''}...`
                ).join('\n\n');
                return `🔍 웹 검색 결과 (${response.results.length}개):\n\n${formatted}`;
            }
            return '검색 결과가 없습니다.';
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error('web_search 실행 실패:', errorMessage);
            return `Error: ${errorMessage}`;
        }
    }

    // 내장 도구 직접 처리: web_fetch
    if (toolName === 'web_fetch') {
        try {
            const url = toolArgs.url as string;
            const response = await context.client.webFetch(url);

            if (response.content) {
                return `📥 웹페이지: ${response.title}\n\n${response.content.substring(0, TRUNCATION.WEB_CONTENT_MAX)}`;
            }
            return '페이지 콘텐츠를 가져올 수 없습니다.';
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error('web_fetch 실행 실패:', errorMessage);
            return `Error: ${errorMessage}`;
        }
    }

    // 내장 도구 직접 처리: vision_ocr (이미지 텍스트 추출)
    if (toolName === 'vision_ocr') {
        try {
            const imagePath = toolArgs.image_path as string;
            const imageBase64 = toolArgs.image_base64 as string;
            const language = (toolArgs.language as string) || 'auto';

            let imageData: string;
            if (imageBase64) {
                imageData = imageBase64;
            } else if (imagePath) {
                const { UserSandbox } = await import('../../mcp/user-sandbox');
                const userId = context.currentUserContext?.userId || 'guest';
                const safePath = UserSandbox.resolvePath(userId, imagePath);
                if (!safePath) {
                    return 'Error: 접근 권한이 없는 경로입니다. 사용자 작업 디렉토리 내 파일만 접근할 수 있습니다.';
                }
                const { readFile } = await import('fs/promises');
                const fileBuffer = await readFile(safePath);
                imageData = fileBuffer.toString('base64');
            } else {
                return 'Error: image_path 또는 image_base64가 필요합니다.';
            }

            logger.info('🔍 Vision OCR 실행 중...');

            const ocrResponse = await context.client.chat(
                [
                    { role: 'system', content: VISION_OCR_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: buildVisionOcrUserMessage(language),
                        images: [imageData],
                    },
                ],
                { temperature: LLM_TEMPERATURES.AGENT_TOOL_CALL }
            );

            const extractedText = ocrResponse.content || '';
            logger.info(`✅ OCR 완료: ${extractedText.length}자 추출`);

            return `📝 OCR 결과:\n\n${extractedText}`;
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error('vision_ocr 실행 실패:', errorMessage);
            return `Error: ${errorMessage}`;
        }
    }

    // 내장 도구 직접 처리: analyze_image (이미지 분석)
    if (toolName === 'analyze_image') {
        try {
            const imagePath = toolArgs.image_path as string;
            const imageBase64 = toolArgs.image_base64 as string;
            const question = (toolArgs.question as string) || '이 이미지에 무엇이 있나요? 상세히 설명해주세요.';

            let imageData: string;
            if (imageBase64) {
                imageData = imageBase64;
            } else if (imagePath) {
                const { UserSandbox } = await import('../../mcp/user-sandbox');
                const userId = context.currentUserContext?.userId || 'guest';
                const safePath = UserSandbox.resolvePath(userId, imagePath);
                if (!safePath) {
                    return 'Error: 접근 권한이 없는 경로입니다. 사용자 작업 디렉토리 내 파일만 접근할 수 있습니다.';
                }
                const { readFile } = await import('fs/promises');
                const fileBuffer = await readFile(safePath);
                imageData = fileBuffer.toString('base64');
            } else {
                return 'Error: image_path 또는 image_base64가 필요합니다.';
            }

            logger.info('🖼️ 이미지 분석 실행 중...');

            const analysisResponse = await context.client.chat(
                [
                    { role: 'system', content: VISION_ANALYSIS_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: question,
                        images: [imageData],
                    },
                ],
                { temperature: LLM_TEMPERATURES.AGENT_RESPONSE }
            );

            const analysis = analysisResponse.content || '';
            logger.info('✅ 이미지 분석 완료');

            return `🖼️ 이미지 분석 결과:\n\n${analysis}`;
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error('analyze_image 실행 실패:', errorMessage);
            return `Error: ${errorMessage}`;
        }
    }

    // 기타 도구: ToolRouter를 통해 MCP 도구로 실행
    try {
        const toolRouter = getUnifiedMCPClient().getToolRouter();
        const result = await toolRouter.executeTool(toolName, toolArgs, context.currentUserContext ?? undefined);

        // resource content 감지 → frontend 인라인 카드 콜백 (ChatContext.onMcpToolResult)
        if (context.onMcpToolResult && Array.isArray(result.content)) {
            const resources = result.content
                .filter((c): c is { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } } =>
                    c.type === 'resource' && !!c.resource && typeof c.resource.uri === 'string')
                .map(c => ({ uri: c.resource.uri, mimeType: c.resource.mimeType, text: c.resource.text }));
            if (resources.length > 0) {
                try { context.onMcpToolResult({ toolName, resources }); }
                catch (e) { logger.warn(`onMcpToolResult 콜백 실패: ${e instanceof Error ? e.message : String(e)}`); }
            }
        }

        if (result.isError) {
            return `Error executing tool: ${result.content.map((c: { text?: string }) => c.text).join('\n')}`;
        }
        return result.content.map((c: { text?: string }) => c.text).join('\n');
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.error(`Tool execution failed: ${errorMessage}`);
        return `Error: ${errorMessage}`;
    }
}
