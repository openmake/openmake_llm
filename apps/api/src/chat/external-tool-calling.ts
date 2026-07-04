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
    onToken: (token: string) => void;
    abortSignal?: AbortSignal;
}): Promise<{
    response: string;
    tool_calls?: OpenAIToolCall[];
    finish_reason: 'stop' | 'tool_calls';
}> {
    const { message, history, images, tools, tool_choice, client, onToken, abortSignal: _abortSignal } = params;

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

    if (history && history.length > 0) {
        for (const h of history) {
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

    // 현재 사용자 메시지 추가
    messages.push({
        role: 'user',
        content: message,
        ...(images && images.length > 0 && { images }),
    });

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
