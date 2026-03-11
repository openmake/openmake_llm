import { randomBytes } from 'crypto';
import { listAvailableModels } from '../domains/chat/pipeline/profile-resolver';

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stream?: boolean;
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    n?: number;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    user?: string;
}

export interface OpenAIChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> };
        finish_reason: 'stop' | 'tool_calls' | 'length' | null;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    system_fingerprint?: string;
}

export interface OpenAIChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: { role?: string; content?: string; tool_calls?: unknown[] };
        finish_reason: string | null;
    }>;
}

export interface OpenAIModelListResponse {
    object: 'list';
    data: Array<{
        id: string;
        object: 'model';
        created: number;
        owned_by: string;
    }>;
}

export class OpenAICompatService {
    static generateCompletionId(): string {
        return `chatcmpl-${randomBytes(12).toString('hex')}`;
    }

    static convertMessages(messages: OpenAIMessage[]): { message: string; history: Array<{ role: string; content: string }> } {
        if (messages.length === 0) {
            return { message: '', history: [] };
        }

        const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === 'user');
        const resolvedLastUserIndex = lastUserIndex >= 0 ? messages.length - 1 - lastUserIndex : -1;

        if (resolvedLastUserIndex >= 0) {
            return {
                message: messages[resolvedLastUserIndex].content ?? '',
                history: messages.slice(0, resolvedLastUserIndex).map((m) => ({
                    role: m.role,
                    content: m.content ?? '',
                })),
            };
        }

        return {
            message: messages[messages.length - 1].content ?? '',
            history: messages.slice(0, -1).map((m) => ({
                role: m.role,
                content: m.content ?? '',
            })),
        };
    }

    static buildResponse(params: {
        id: string;
        model: string;
        content: string;
        finishReason: 'stop' | 'tool_calls';
        promptTokens: number;
        completionTokens: number;
        toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }): OpenAIChatCompletionResponse {
        return {
            id: params.id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: params.content,
                        ...(params.toolCalls && params.toolCalls.length > 0 ? { tool_calls: params.toolCalls } : {}),
                    },
                    finish_reason: params.finishReason,
                },
            ],
            usage: {
                prompt_tokens: params.promptTokens,
                completion_tokens: params.completionTokens,
                total_tokens: params.promptTokens + params.completionTokens,
            },
        };
    }

    static buildStreamChunk(params: {
        id: string;
        model: string;
        delta: { role?: string; content?: string; tool_calls?: unknown[] };
        finishReason: string | null;
    }): OpenAIChatCompletionChunk {
        return {
            id: params.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
                {
                    index: 0,
                    delta: params.delta,
                    finish_reason: params.finishReason,
                },
            ],
        };
    }

    static buildDoneEvent(): string {
        return 'data: [DONE]\n\n';
    }

    static estimateTokens(text: string): number {
        const trimmed = text.trim();
        if (!trimmed) {
            return 0;
        }

        const words = trimmed.split(/\s+/).filter(Boolean).length;
        return Math.ceil(words * 1.3);
    }

    static listModels(): OpenAIModelListResponse {
        const now = Math.floor(Date.now() / 1000);
        const models = listAvailableModels();
        return {
            object: 'list',
            data: models.map((model) => ({
                id: model.id,
                object: 'model',
                created: now,
                owned_by: 'openmake',
            })),
        };
    }
}
