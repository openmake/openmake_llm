/**
 * real 도구 선택 평가용 관찰기 (F26.2) — ChatService 에 evalToolObserver(dryRun) 를 걸고 첫 턴 tool_calls 를 받으면 즉시 중단한다.
 * 도구는 실행되지 않고(dry-run), 첫 관찰 직후 abort 해 LLM 비용은 첫 턴 1회분이다. 모델이 도구 없이 답하면 빈 배열.
 *
 * @module evaluation/real-tool-call-observer
 */
import { LLMClient } from '../llm';
import { ChatService } from '../services/ChatService';
import { ProviderRouter } from '../providers/provider-router';
import { LocalLLMProvider } from '../providers/local-llm-provider';
import type { ChatMessageRequest } from '../services/chat-service-types';
import type { ObservedToolCall, ToolCallObserverRunner } from './tool-selection-evaluator';

export function createRealToolCallObserver(opts: { timeoutMs: number }): ToolCallObserverRunner {
    return async (c) => {
        const client = new LLMClient({});
        const chatService = new ChatService(client, new ProviderRouter({ localProvider: new LocalLLMProvider(client) }));
        const controller = new AbortController();
        let observed: ObservedToolCall[] | null = null;
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
        const req: ChatMessageRequest = {
            message: c.query,
            history: [],
            userId: 'eval-real-runner',
            userRole: c.role ?? 'user',
            enabledTools: {},
            abortSignal: controller.signal,
            ...(c.language ? { userLanguagePreference: c.language } : {}),
            evalToolObserver: {
                dryRun: true,
                onToolCalls: (calls, turn) => {
                    if (turn !== 0 || observed) return;
                    observed = calls;
                    controller.abort();
                },
            },
        };
        try {
            await chatService.processMessage(req, () => { /* 본문은 판정하지 않는다 */ });
        } catch (e) {
            if (!observed && !(controller.signal.aborted && e instanceof Error && e.message === 'ABORTED')) throw e;
            if (!observed) throw new Error(`시간 초과(${opts.timeoutMs}ms)`);
        } finally {
            clearTimeout(timer);
        }
        return observed ?? [];
    };
}
