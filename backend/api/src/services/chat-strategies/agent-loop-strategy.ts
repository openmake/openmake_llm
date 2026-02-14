import type { ToolDefinition } from '../../ollama/types';
import { canUseTool } from '../../mcp/tool-tiers';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { DirectStrategy } from './direct-strategy';
import type { AgentLoopStrategyContext, ChatStrategy, ChatResult } from './types';

export class AgentLoopStrategy implements ChatStrategy<AgentLoopStrategyContext, ChatResult> {
    constructor(private readonly directStrategy: DirectStrategy) {}

    async execute(context: AgentLoopStrategyContext): Promise<ChatResult> {
        let metrics: Record<string, unknown> = {};
        let currentTurn = 0;
        let finalResponse = '';

        while (currentTurn < context.maxTurns) {
            context.checkAborted?.();

            currentTurn++;
            console.log(`[ChatService] 🔄 Agent Loop Turn ${currentTurn}/${context.maxTurns}`);

            let allowedTools: ToolDefinition[] = [];
            if (context.supportsTools) {
                allowedTools = context.getAllowedTools();
            }

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
            });

            if (directResult.metrics) {
                metrics = { ...directResult.metrics };
            }

            context.currentHistory.push(directResult.assistantMessage);

            if (directResult.toolCalls.length > 0) {
                console.log(`[ChatService] 🛠️ Tool Calls detected: ${directResult.toolCalls.length}`);

                for (const toolCall of directResult.toolCalls) {
                    const toolResult = await this.executeToolCall(context, toolCall);

                    context.currentHistory.push({
                        role: 'tool',
                        content: toolResult,
                    });
                }
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

        if (context.currentUserContext) {
            const userTier = context.currentUserContext.tier;
            if (!canUseTool(userTier, toolName)) {
                const tierLabel = {
                    free: '무료',
                    pro: '프로',
                    enterprise: '엔터프라이즈',
                }[userTier];

                console.warn(`[ChatService] ⚠️ 도구 접근 거부: ${toolName} (tier: ${userTier})`);
                return `🔒 권한 없음: ${tierLabel} 등급에서는 "${toolName}" 도구를 사용할 수 없습니다. 업그레이드가 필요합니다.`;
            }
        }

        console.log(`[ChatService] 🔨 Executing Tool: ${toolName} (tier: ${context.currentUserContext?.tier || 'unknown'})`, toolArgs);

        if (toolName === 'web_search') {
            try {
                const query = toolArgs.query as string;
                const maxResults = (toolArgs.max_results as number) || 5;
                const response = await context.client.webSearch(query, maxResults);

                if (response.results && response.results.length > 0) {
                    const formatted = response.results.map((r, i) =>
                        `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.substring(0, 200) || ''}...`
                    ).join('\n\n');
                    return `🔍 웹 검색 결과 (${response.results.length}개):\n\n${formatted}`;
                }
                return '검색 결과가 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] web_search 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        if (toolName === 'web_fetch') {
            try {
                const url = toolArgs.url as string;
                const response = await context.client.webFetch(url);

                if (response.content) {
                    return `📥 웹페이지: ${response.title}\n\n${response.content.substring(0, 3000)}`;
                }
                return '페이지 콘텐츠를 가져올 수 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] web_fetch 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

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

                console.log('[ChatService] 🔍 Vision OCR 실행 중...');

                const ocrResponse = await context.client.chat(
                    [
                        { role: 'system', content: 'You are an OCR expert. Extract ALL text from the image exactly as it appears. Preserve formatting, line breaks, and structure. If the text is in Korean, Japanese, or Chinese, output it in the original language.' },
                        {
                            role: 'user',
                            content: `이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 원본 형식을 최대한 유지하세요.${language !== 'auto' ? ` 언어: ${language}` : ''}`,
                            images: [imageData],
                        },
                    ],
                    { temperature: 0.1 }
                );

                const extractedText = ocrResponse.content || '';
                console.log(`[ChatService] ✅ OCR 완료: ${extractedText.length}자 추출`);

                return `📝 OCR 결과:\n\n${extractedText}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] vision_ocr 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

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

                console.log('[ChatService] 🖼️ 이미지 분석 실행 중...');

                const analysisResponse = await context.client.chat(
                    [
                        { role: 'system', content: 'You are an expert image analyst. Describe images in detail, including objects, text, colors, composition, and any relevant context.' },
                        {
                            role: 'user',
                            content: question,
                            images: [imageData],
                        },
                    ],
                    { temperature: 0.3 }
                );

                const analysis = analysisResponse.content || '';
                console.log('[ChatService] ✅ 이미지 분석 완료');

                return `🖼️ 이미지 분석 결과:\n\n${analysis}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] analyze_image 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        try {
            const toolRouter = getUnifiedMCPClient().getToolRouter();
            const result = await toolRouter.executeTool(toolName, toolArgs, context.currentUserContext ?? undefined);
            if (result.isError) {
                return `Error executing tool: ${result.content.map((c: { text?: string }) => c.text).join('\n')}`;
            }
            return result.content.map((c: { text?: string }) => c.text).join('\n');
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[ChatService] Tool execution failed: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
