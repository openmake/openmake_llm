/**
 * ============================================================
 * 외부 Tool Calling (OpenAI 호환) 단일 턴 처리
 * ============================================================
 * request-handler.ts 에서 분리 (파일 크기 가드 — 로직 책임 분리).
 * `/api/v1/chat/completions` 의 tools 요청 경로에서 호출되며, ChatRequestHandler
 * 상태에 의존하지 않는 순수 함수다 (leaf deps 만 import → 순환 없음).
 *
 * @module chat/external-tool-calling
 */

import { randomBytes } from 'crypto';
import type { LLMClient, ChatMessage, ToolDefinition } from '../llm';
import type { IProvider } from '../providers/i-provider';
import { getPromptConfig } from './prompt';
import { determineLanguagePolicy } from './language-policy';
import { getConfig } from '../config/env';
import { LANGUAGE_THRESHOLDS } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import type { OpenAIToolCall } from './request-handler-types';

const log = createLogger('ExternalToolCalling');

/**
 * 외부 Tool Calling 단일 턴 — 언어 감지 → 메시지 구성 → LLM 호출 → tool_calls 정규화.
 */
export async function processExternalToolCalling(params: {
    message: string;
    history?: Array<{ role: string; content: string; images?: string[]; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>; tool_call_id?: string }>;
    images?: string[];
    tools: ToolDefinition[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    client: LLMClient;
    /**
     * 외부 provider dispatch (Phase 2, 2026-07-26) — 요청 모델이 외부 fullId
     * ('chatgpt:*', 'openrouter:*' 등)로 해석된 경우 로컬 client 대신 이 어댑터로 호출.
     */
    externalProvider?: { provider: IProvider; modelId: string };
    onToken: (token: string) => void;
    abortSignal?: AbortSignal;
}): Promise<{
    response: string;
    tool_calls?: OpenAIToolCall[];
    finish_reason: 'stop' | 'tool_calls';
}> {
    const { message, history, images, tools, tool_choice, client, externalProvider, onToken, abortSignal: _abortSignal } = params;

    // 언어 정책 결정 (메시지 기반 감지 — 외부 Tool Calling 경로는 userLanguagePreference 없음)
    const config = getConfig();
    let detectedLanguage: string = 'en'; // default fallback

    // 메시지 기반 언어 감지 항상 수행 (외부 API 요청은 사용자 설정 없으므로 메시지에서 감지)
    try {
        const languagePolicy = determineLanguagePolicy(message, {
            defaultLanguage: config.defaultResponseLanguage,
            enableDynamicResponse: true,
            minConfidenceThreshold: config.languageDetectionMinConfidence,
            shortTextThreshold: LANGUAGE_THRESHOLDS.SHORT_TEXT_LENGTH_EXTENDED,
            fallbackLanguage: config.languageFallbackLanguage,
            supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr']
        });
        detectedLanguage = languagePolicy.resolvedLanguage;
    } catch (error) {
        log.warn('언어 감지 실패, 기본 언어 사용:', error);
    }

    // tool_choice가 "none"이면 도구 없이 호출
    const effectiveTools = tool_choice === 'none' ? undefined : tools;

    // 시스템 프롬프트 구성
    const promptConfig = getPromptConfig(message, detectedLanguage);

    // 대화 히스토리 구성 (외부 입력 → 내부 ChatMessage 형식 변환)
    const messages: ChatMessage[] = [
        { role: 'system', content: promptConfig.systemPrompt },
    ];

    // history 에 섞인 system 메시지는 배열에 두지 않고 맨 앞 system 에 병합한다.
    // 자체 system 이 index 0 을 차지하므로 history 의 system 을 그대로 두면 두 번째 system 이
    // 중간 위치에 들어가 vLLM/qwen 템플릿이 "System message must be at the beginning"
    // (400 BadRequest) 으로 거부한다. 드롭이 아니라 병합인 이유 — OpenAI 호환 API 에서
    // system 은 클라이언트의 지시 계약이라 조용히 버리면 외부 에이전트가 지시 없이 동작한다.
    // (tools 없는 일반 채팅 경로의 대응: services/chat-service/external-provider.ts)
    const clientSystemParts: string[] = [];

    if (history && history.length > 0) {
        for (const h of history) {
            if (h.role === 'system') {
                if (h.content) clientSystemParts.push(h.content);
                continue;
            }

            const msg: ChatMessage = {
                role: h.role as ChatMessage['role'],
                content: h.content || '',
                ...(h.images && { images: h.images }),
            };

            // assistant의 tool_calls를 내부 ChatMessage 형식으로 변환
            if (h.role === 'assistant' && h.tool_calls && h.tool_calls.length > 0) {
                msg.tool_calls = h.tool_calls.map(tc => ({
                    type: 'function' as const,
                    function: {
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments) as Record<string, unknown>
                            : tc.function.arguments as Record<string, unknown>,
                    },
                }));
            }

            messages.push(msg);
        }
    }

    if (clientSystemParts.length > 0) {
        messages[0].content = [promptConfig.systemPrompt, ...clientSystemParts].join('\n\n');
    }

    // 현재 사용자 메시지 추가
    messages.push({
        role: 'user',
        content: message,
        ...(images && images.length > 0 && { images }),
    });

    // 외부 provider 경로 — provider.streamChat 로 단일 턴 호출 후 동일 형태로 반환
    if (externalProvider) {
        let externalContent = '';
        const streamResult = await externalProvider.provider.streamChat(
            {
                messages,
                modelId: externalProvider.modelId,
                ...(effectiveTools ? { tools: effectiveTools } : {}),
                ...(tool_choice !== undefined && tool_choice !== 'none'
                    ? { tool_choice }
                    : {}),
                ...(_abortSignal ? { abortSignal: _abortSignal } : {}),
            },
            {
                onToken: (token: string) => {
                    externalContent += token;
                    onToken(token);
                },
            },
        );
        if (streamResult.toolCalls && streamResult.toolCalls.length > 0) {
            return {
                response: streamResult.content || '',
                tool_calls: streamResult.toolCalls.map((tc) => ({
                    id: tc.id || `call_${randomBytes(12).toString('hex')}`,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: typeof tc.args === 'string'
                            ? tc.args
                            : JSON.stringify(tc.args ?? {}),
                    },
                })),
                finish_reason: 'tool_calls',
            };
        }
        return {
            response: streamResult.content || externalContent,
            finish_reason: 'stop',
        };
    }

    // LLM 호출 (단일 턴)
    let fullContent = '';
    const llmResponse = await client.chat(
        messages,
        promptConfig.options,
        (token: string) => {
            // tool_calls JSON 토큰은 스트리밍에서 필터링
            if (!token.includes('tool_calls')) {
                fullContent += token;
                onToken(token);
            }
        },
        {
            ...(effectiveTools && { tools: effectiveTools }),
            ...(tool_choice !== undefined && { tool_choice }),
        }
    );

    // LLM 응답의 tool_calls 를 OpenAI 호환 형식으로 정규화 (id 합성)
    const llmToolCalls = llmResponse.tool_calls;
    if (llmToolCalls && llmToolCalls.length > 0) {
        const openaiToolCalls: OpenAIToolCall[] = llmToolCalls.map(tc => ({
            id: `call_${randomBytes(12).toString('hex')}`,
            type: 'function' as const,
            function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments),
            },
        }));

        return {
            response: llmResponse.content || '',
            tool_calls: openaiToolCalls,
            finish_reason: 'tool_calls',
        };
    }

    // 도구 호출 없음 — 일반 텍스트 응답
    return {
        response: llmResponse.content || fullContent,
        finish_reason: 'stop',
    };
}
