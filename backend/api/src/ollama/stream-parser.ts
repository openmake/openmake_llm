/**
 * ============================================================
 * Stream Parser - Ollama NDJSON 스트림 파싱 모듈
 * ============================================================
 *
 * Ollama Generate/Chat API의 NDJSON 스트리밍 응답을 파싱합니다.
 * 토큰 단위 콜백, Thinking 추론 과정, Tool Calls, 성능 메트릭을 처리합니다.
 *
 * @module ollama/stream-parser
 */
import { AxiosInstance } from 'axios';
import {
    GenerateRequest,
    GenerateResponse,
    ChatRequest,
    ChatResponse,
    ChatMessage,
    ToolCall,
    UsageMetrics
} from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('OllamaStreamParser');

/**
 * UsageMetrics를 응답 데이터에서 추출합니다.
 */
function extractMetrics(data: { total_duration?: number; load_duration?: number; prompt_eval_count?: number; prompt_eval_duration?: number; eval_count?: number; eval_duration?: number }): UsageMetrics {
    return {
        total_duration: data.total_duration,
        load_duration: data.load_duration,
        prompt_eval_count: data.prompt_eval_count,
        prompt_eval_duration: data.prompt_eval_duration,
        eval_count: data.eval_count,
        eval_duration: data.eval_duration
    };
}

/**
 * 스트리밍 방식으로 텍스트를 생성합니다.
 *
 * NDJSON 스트림을 파싱하여 토큰 단위로 콜백을 호출하고,
 * 완료 시 전체 응답과 메트릭을 반환합니다.
 *
 * @param client - Axios HTTP 클라이언트 인스턴스
 * @param request - 텍스트 생성 요청 객체
 * @param onToken - 토큰 수신 콜백
 * @param onContextUpdate - 컨텍스트 업데이트 콜백
 * @returns 전체 응답 텍스트와 성능 메트릭
 */
export async function streamGenerate(
    client: AxiosInstance,
    request: GenerateRequest,
    onToken: (token: string) => void,
    onContextUpdate: (context: number[]) => void
): Promise<{ response: string; metrics?: UsageMetrics }> {
    const response = await client.post('/api/generate', request, {
        responseType: 'stream'
    });

    let fullResponse = '';
    let metrics: UsageMetrics | undefined;

    return new Promise((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const parsed = JSON.parse(line) as GenerateResponse & { error?: string };
                        if (parsed.error) {
                            reject(new Error(`Ollama generate stream error: ${parsed.error}`));
                            return;
                        }
                        const data = parsed;
                        if (data.response) {
                            fullResponse += data.response;
                            onToken(data.response);
                        }
                        if (data.thinking) {
                            onToken(data.thinking);
                        }
                        if (data.done) {
                            if (data.context) {
                                onContextUpdate(data.context);
                            }
                            metrics = extractMetrics(data);
                        }
                    } catch (e) {
                        logger.error('JSON Parse Error:', e);
                    }
                }
            }
        });

        response.data.on('end', () => {
            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer) as GenerateResponse & { error?: string };
                    if (parsed.error) {
                        reject(new Error(`Ollama generate stream error: ${parsed.error}`));
                        return;
                    }
                    const data = parsed;
                    if (data.response) {
                        fullResponse += data.response;
                        onToken(data.response);
                    }
                    if (data.thinking) {
                        onToken(data.thinking);
                    }
                    if (data.done) {
                        metrics = extractMetrics(data);
                    }
                } catch (e) { /* ignore trailing buffer parse errors */ }
            }
            resolve({ response: fullResponse, metrics });
        });
        response.data.on('error', reject);
    });
}

/**
 * 스트리밍 방식으로 채팅 응답을 생성합니다.
 *
 * NDJSON 스트림을 파싱하여 Thinking, Content, Tool Calls를 구분 처리합니다:
 * - thinking 필드가 있으면 추론 과정으로 콜백 호출
 * - content 필드가 있으면 본문 텍스트로 콜백 호출
 * - tool_calls 필드가 있으면 도구 호출 목록 수집
 * - done=true 시 메트릭 수집
 *
 * @param client - Axios HTTP 클라이언트 인스턴스
 * @param request - 채팅 요청 객체
 * @param onToken - 토큰/Thinking 수신 콜백
 * @returns 어시스턴트 응답 메시지 (content, thinking, tool_calls 포함)
 */
export async function streamChat(
    client: AxiosInstance,
    request: ChatRequest,
    onToken: (token: string, thinking?: string) => void
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    const response = await client.post('/api/chat', request, {
        responseType: 'stream'
    });

    let fullContent = '';
    let fullThinking = '';
    let toolCalls: ToolCall[] = [];
    let metrics: UsageMetrics | undefined;

    return new Promise((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    if (line.trim() === 'ABORTED') continue;
                    try {
                        const parsed = JSON.parse(line) as ChatResponse & { error?: string };
                        if (parsed.error) {
                            reject(new Error(`Ollama chat stream error: ${parsed.error}`));
                            return;
                        }
                        const data = parsed;

                        if (data.message?.thinking) {
                            fullThinking += data.message.thinking;
                            onToken('', data.message.thinking);
                        }

                        if (data.message?.content) {
                            fullContent += data.message.content;
                            onToken(data.message.content);
                        }

                        if (data.message?.tool_calls) {
                            toolCalls = [...toolCalls, ...data.message.tool_calls];
                        }

                        if (data.done) {
                            metrics = extractMetrics(data);
                        }
                    } catch (e) {
                        logger.error('Chat JSON Parse Error:', e);
                    }
                }
            }
        });

        response.data.on('end', () => {
            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer) as ChatResponse & { error?: string };
                    if (parsed.error) {
                        reject(new Error(`Ollama chat stream error: ${parsed.error}`));
                        return;
                    }
                    const data = parsed;
                    if (data.message?.thinking) fullThinking += data.message.thinking;
                    if (data.message?.content) {
                        fullContent += data.message.content;
                        onToken(data.message.content);
                    }
                    if (data.message?.tool_calls) toolCalls = [...toolCalls, ...data.message.tool_calls];
                    if (data.done) {
                        metrics = extractMetrics(data);
                    }
                } catch (e) { /* ignore */ }
            }

            const result: ChatMessage & { metrics?: UsageMetrics } = {
                role: 'assistant',
                content: fullContent,
                metrics
            };

            if (fullThinking) {
                result.thinking = fullThinking;
            }

            if (toolCalls.length > 0) {
                result.tool_calls = toolCalls;
            }

            resolve(result);
        });
        response.data.on('error', reject);
    });
}
