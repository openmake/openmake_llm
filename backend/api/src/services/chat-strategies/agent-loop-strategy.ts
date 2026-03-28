/**
 * ============================================================
 * AgentLoopStrategy - Multi-turn 도구 호출 루프 전략
 * ============================================================
 *
 * LLM이 도구 호출을 요청하면 해당 도구를 실행하고 결과를 다시 LLM에 전달하는
 * 반복 루프를 수행합니다. 도구 호출이 없을 때까지 또는 최대 턴 수에 도달할 때까지 반복합니다.
 *
 * @module services/chat-strategies/agent-loop-strategy
 * @description
 * - DirectStrategy를 내부 빌딩 블록으로 사용하여 각 턴을 실행
 * - 도구 접근 권한 검사 (UserTier 기반 tool-tiers)
 * - 내장 도구 직접 처리: web_search, web_fetch, vision_ocr, analyze_image
 * - 기타 도구는 ToolRouter를 통해 MCP 도구로 실행
 * - maxTurns 제한으로 무한 루프 방지
 */
import type { ToolDefinition } from '../../ollama/types';
import { canUseTool } from '../../mcp/tool-tiers';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { DirectStrategy } from './direct-strategy';
import type { AgentLoopStrategyContext, ChatStrategy, ChatResult } from './types';
import { createLogger } from '../../utils/logger';
import { TRUNCATION, TOOL_RESULT_COMPACTION } from '../../config/runtime-limits';
import { semanticCompact } from '../semantic-compactor';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { VISION_OCR_SYSTEM_PROMPT, VISION_ANALYSIS_SYSTEM_PROMPT } from '../../prompts/vision-system';

const logger = createLogger('AgentLoopStrategy');

/**
 * Multi-turn 도구 호출 루프 전략
 *
 * DirectStrategy로 LLM 호출 → 도구 호출 감지 → 도구 실행 → 결과 전달의
 * 반복 루프를 관리합니다. GV(Generate-Verify) 실패 시 폴백 전략으로도 사용됩니다.
 *
 * @class AgentLoopStrategy
 * @implements {ChatStrategy<AgentLoopStrategyContext, ChatResult>}
 */
export class AgentLoopStrategy implements ChatStrategy<AgentLoopStrategyContext, ChatResult> {
    /**
     * AgentLoopStrategy 인스턴스를 생성합니다.
     *
     * @param directStrategy - 각 턴에서 LLM 호출에 사용할 DirectStrategy 인스턴스
     */
    constructor(private readonly directStrategy: DirectStrategy) {}

    /**
     * Multi-turn 도구 호출 루프를 실행합니다.
     *
     * 실행 흐름:
     * 1. DirectStrategy로 LLM 호출
     * 2. tool_calls가 있으면 → 각 도구 실행 → 결과를 히스토리에 추가 → 1로 돌아감
     * 3. tool_calls가 없으면 → 최종 응답으로 루프 종료
     * 4. maxTurns 도달 시 → 마지막 응답으로 루프 종료
     *
     * @param context - AgentLoop 컨텍스트 (클라이언트, 히스토리, 도구, 최대 턴 수 등)
     * @returns 최종 응답 텍스트와 메트릭을 포함한 결과
     */
    async execute(context: AgentLoopStrategyContext): Promise<ChatResult> {
        let metrics: Record<string, unknown> = {};
        let currentTurn = 0;
        let finalResponse = '';

        while (currentTurn < context.maxTurns) {
            context.checkAborted?.();

            currentTurn++;
            // ExecutionState 참조 업데이트 (폴백 시 소모 턴 추적)
            if (context.executionState) {
                context.executionState.turnsUsed++;
            }
            logger.info(`🔄 Agent Loop Turn ${currentTurn}/${context.maxTurns}`);

            // 모델이 도구 호출을 지원하고, single 전략이 아닌 경우에만 도구 목록 조회
            // Fast 프로파일(single)은 속도 최적화를 위해 도구 호출 비활성화
            let allowedTools: ToolDefinition[] = [];
            const execStrategy = context.executionPlan?.executionStrategy;
            if (context.supportsTools && execStrategy !== 'single') {
                allowedTools = context.getAllowedTools();
            }

            // Thinking 깊이 결정: ExecutionPlan 프로파일 > 사용자 요청 > 비활성화
            const profileThinking = context.executionPlan?.thinkingLevel;
            const effectiveThinking = profileThinking && profileThinking !== 'off'
                ? profileThinking
                : (context.thinkingMode ? (context.thinkingLevel || 'high') : undefined);
            const thinkOption = (effectiveThinking && context.supportsThinking) ? effectiveThinking : undefined;

            const directResult = await this.directStrategy.execute({
                onToken: context.onToken,
                abortSignal: context.abortSignal,
                checkAborted: context.checkAborted,
                client: context.client,
                currentHistory: context.currentHistory,
                chatOptions: context.chatOptions,
                allowedTools,
                thinkOption,
                format: context.format,
            });

            if (directResult.metrics) {
                metrics = { ...directResult.metrics };
            }

            context.currentHistory.push(directResult.assistantMessage);

            if (directResult.toolCalls.length > 0) {
                logger.info(`🛠️ Tool Calls detected: ${directResult.toolCalls.length}`);

                for (const toolCall of directResult.toolCalls) {
                    const toolResult = await this.executeToolCall(context, toolCall);

                    // Ollama 공식 스펙: tool 결과 메시지에 tool_name 필수
                    context.currentHistory.push({
                        role: 'tool',
                        content: toolResult,
                        tool_name: toolCall.function?.name,
                    });
                }

                // 도구 결과 컴팩션: 오래된 도구 결과를 요약하여 컨텍스트 낭비 방지
                // Anthropic 하네스 원칙: "오래된 도구 결과는 요약/정리"
                await this.compactOldToolResults(context.currentHistory);
            } else {
                finalResponse = directResult.response;
                break;
            }
        }

        return {
            response: finalResponse,
            metrics,
        };
    }

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
    private async executeToolCall(context: AgentLoopStrategyContext, toolCall: {
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
                            content: `이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 원본 형식을 최대한 유지하세요.${language !== 'auto' ? ` 언어: ${language}` : ''}`,
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

    /**
     * 오래된 도구 결과를 컴팩션하여 컨텍스트 윈도우 효율을 높입니다.
     *
     * 최근 N개(KEEP_RECENT)의 도구 결과는 원문을 유지하고,
     * 그 이전의 도구 결과는 도구명과 결과 요약(앞 200자)만 남깁니다.
     * 이는 Anthropic의 "도구 결과 정리" 권장 패턴을 따릅니다.
     */
    private async compactOldToolResults(history: Array<{ role: string; content?: string; tool_name?: string }>): Promise<void> {
        // 도구 결과 메시지의 인덱스를 역순으로 수집
        const toolIndices: number[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'tool') {
                toolIndices.push(i);
            }
        }

        // 최근 N개는 유지, 나머지를 컴팩션
        const toCompact = toolIndices.slice(TOOL_RESULT_COMPACTION.KEEP_RECENT);
        if (toCompact.length === 0) return;

        let compactedCount = 0;
        for (const idx of toCompact) {
            const msg = history[idx];
            const content = msg.content || '';
            if (content.length > TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS) {
                const toolName = msg.tool_name || 'unknown';

                if (TOOL_RESULT_COMPACTION.USE_SEMANTIC && content.length >= TOOL_RESULT_COMPACTION.SEMANTIC_THRESHOLD_CHARS) {
                    // Semantic Compaction: 소형 모델로 의미 보존 요약
                    msg.content = await semanticCompact(toolName, content);
                } else {
                    // 단순 절단 (기본)
                    msg.content = `[Compacted] ${toolName}: ${content.substring(0, TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS)}...`;
                }
                compactedCount++;
            }
        }

        if (compactedCount > 0) {
            logger.info(`📦 도구 결과 컴팩션: ${compactedCount}개 결과 압축`);
        }
    }
}
