/**
 * 일반 채팅 경로(도구 없는 요청) — 클라이언트 system 메시지 병합 회귀 테스트.
 *
 * OpenAI 호환 API 의 `convertMessages` 는 클라이언트가 보낸 role='system' 을 그대로
 * history 에 싣는다. 이전엔 external-provider 가 이를 드롭해, tools 없는 요청에서만
 * 클라이언트 지시가 조용히 사라졌다(도구 경로는 병합). 병합 동작을 고정한다.
 */
import { streamFromExternalProvider } from '../external-fallback';
import type { ResolvedProvider } from '../../../providers/provider-router';
import type { ChatMessage } from '../../../llm';

type StreamImpl = (
    opts: unknown,
    cb: { onToken?: (t: string) => void; onUsage?: (u: unknown) => void },
) => Promise<unknown>;

function makeResolved(streamChat: StreamImpl): ResolvedProvider {
    return {
        providerId: 'local-llm',
        modelId: 'qwen3.6-35b-a3b',
        fullId: 'local-llm:qwen3.6-35b-a3b',
        provider: {
            id: 'local-llm',
            sdkType: 'local-llm',
            displayName: 'local-llm',
            getCapabilities: () => ({ streaming: true, toolCalling: false, vision: true, thinking: false }),
            listModels: async () => [],
            validateCredentials: async () => ({ ok: true }),
            streamChat,
        },
    } as unknown as ResolvedProvider;
}

const deps = {
    currentUserContext: null,
    allowedTools: [],
    providerRouter: { resolve: jest.fn(), getExternalKeysRepo: () => undefined },
} as never;

/** streamChat 에 실제로 넘어간 messages 를 잡아둔다. */
function captureRun(history: Array<{ role: string; content: string }>) {
    const capture: { messages?: ChatMessage[] } = {};
    const resolved = makeResolved(async (opts, cb) => {
        capture.messages = (opts as { messages: ChatMessage[] }).messages;
        cb.onToken?.('응답');
        return { content: '응답', usage: {}, finishReason: 'stop' };
    });
    const req = { message: '안녕', userId: 'u1', userRole: 'user' as const, history };
    return streamFromExternalProvider(deps, resolved, req as never, () => {}).then(() => capture.messages!);
}

describe('runExternalStream — 클라이언트 system 메시지 위치', () => {
    it('history 의 system 을 맨 앞 system 에 병합하고 배열에는 남기지 않는다', async () => {
        const messages = await captureRun([
            { role: 'system', content: 'CLIENT_SYSTEM_INSTRUCTION' },
            { role: 'user', content: '이전 질문' },
            { role: 'assistant', content: '이전 답변' },
        ]);

        expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('CLIENT_SYSTEM_INSTRUCTION');
        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('history 에 system 이 없으면 배열 구성이 그대로다', async () => {
        const messages = await captureRun([{ role: 'user', content: '이전 질문' }]);
        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    });
});
