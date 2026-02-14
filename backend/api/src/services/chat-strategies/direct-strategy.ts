import type { ChatMessage } from '../../ollama/types';
import type { ChatStrategy, DirectStrategyContext, DirectStrategyResult } from './types';

export class DirectStrategy implements ChatStrategy<DirectStrategyContext, DirectStrategyResult> {
    async execute(context: DirectStrategyContext): Promise<DirectStrategyResult> {
        const response = await context.client.chat(
            context.currentHistory,
            context.chatOptions,
            (token) => {
                if (!token.includes('tool_calls')) {
                    context.onToken(token);
                }
            },
            {
                tools: context.allowedTools.length > 0 ? context.allowedTools : undefined,
                think: context.thinkOption,
            }
        );

        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.tool_calls,
        };

        return {
            response: response.content || '',
            assistantMessage,
            toolCalls: response.tool_calls || [],
            metrics: response.metrics ? { ...response.metrics } : undefined,
        };
    }
}
