/**
 * 실제 응답 모델 실시간 표시(served_model) — 발행 규칙과 재연결 스냅샷.
 *  - provider gate 가 확정한 값은 처음 1회만 나간다(같은 값 중복 콜백은 삼킨다)
 *  - 외부→로컬 폴백으로 값이 바뀌면 새 값이 다시 나간다
 *  - 링버퍼가 밀려도 stream_resume 스냅샷의 servedModel 로 알 수 있다
 */
import { createServedModelEmitter, InFlightStreamRegistry } from '../ws-stream-registry';
import type { ExtendedWebSocket } from '../ws-types';
import { streamFromExternalProvider } from '../../services/chat-service/external-fallback';
import { servedModelLabel } from '../../services/chat-service/provider-gate';
import type { ResolvedProvider } from '../../providers/provider-router';
import { ProviderError } from '../../providers/provider-errors';

function fakeWs(): ExtendedWebSocket & { sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = [];
    return {
        OPEN: 1, readyState: 1,
        send: (raw: string) => { sent.push(JSON.parse(raw)); },
        sent, _authenticatedUserId: 'u1', _authenticatedUserRole: 'user', _abortController: null, _isAlive: true,
    } as unknown as ExtendedWebSocket & { sent: Array<Record<string, unknown>> };
}

function resolved(providerId: string, modelId: string, streamChat: (o: unknown, cb: { onToken?: (t: string) => void }) => Promise<unknown>): ResolvedProvider {
    return {
        providerId, modelId, fullId: `${providerId}:${modelId}`,
        provider: {
            id: providerId, sdkType: providerId === 'local-llm' ? 'local-llm' : 'openai-compatible', displayName: providerId,
            getCapabilities: () => ({ streaming: true, toolCalling: false, vision: true, thinking: false }),
            listModels: async () => [], validateCredentials: async () => ({ ok: true }), streamChat,
        },
    } as unknown as ResolvedProvider;
}

describe('createServedModelEmitter', () => {
    it('처음 확정된 값을 1회 발행하고 같은 값은 다시 보내지 않는다', () => {
        const out: Array<Record<string, unknown>> = [];
        const emit = createServedModelEmitter((p) => out.push(p));
        emit('qwen3.8-27b');
        emit('qwen3.8-27b');
        expect(out).toEqual([{ type: 'served_model', model: 'qwen3.8-27b' }]);
    });

    it('값이 바뀌면(폴백) 새 값을 발행한다, 빈 값은 무시', () => {
        const out: Array<Record<string, unknown>> = [];
        const emit = createServedModelEmitter((p) => out.push(p));
        emit('chatgpt:gpt-5.5');
        emit('');
        emit('qwen3.8-27b');
        expect(out.map((p) => p.model)).toEqual(['chatgpt:gpt-5.5', 'qwen3.8-27b']);
    });

    it('gate 확정 → 외부 429 → 로컬 폴백 경로에서 [외부, 로컬] 순으로 나간다', async () => {
        const out: Array<Record<string, unknown>> = [];
        const emit = createServedModelEmitter((p) => out.push(p));
        const failing = resolved('chatgpt', 'gpt-5.5', async () => { throw new ProviderError('QUOTA_EXCEEDED', '한도 초과'); });
        const local = resolved('local-llm', 'qwen3.8-27b', async (_o, cb) => { cb.onToken?.('답'); return { content: '답', usage: {}, finishReason: 'stop' }; });
        emit(servedModelLabel(failing)); // message-pipeline 의 gate 확정 통지
        const deps = { currentUserContext: null, allowedTools: [], providerRouter: { resolve: jest.fn().mockResolvedValue(local), getExternalKeysRepo: () => undefined } } as never;
        await streamFromExternalProvider(deps, failing, { message: '안녕', userId: 'u1', userRole: 'user', onServedModel: emit } as never, () => {});
        expect(out).toEqual([
            { type: 'served_model', model: 'chatgpt:gpt-5.5' },
            { type: 'served_model', model: 'qwen3.8-27b' },
        ]);
    });
});

describe('stream_resume.servedModel', () => {
    it('링버퍼에서 served_model 이벤트가 밀려나도 스냅샷이 마지막 값을 싣는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1024 * 1024, 1); // 링 1개
        const ws1 = fakeWs();
        const entry = reg.open('u:u1', ws1, new AbortController());
        reg.send(entry, { type: 'served_model', model: 'chatgpt:gpt-5.5' });
        reg.send(entry, { type: 'served_model', model: 'qwen3.8-27b' });
        reg.send(entry, { type: 'mcp_tool_start', toolName: 'web_search' }); // served_model 을 링에서 밀어낸다
        reg.detach(ws1);
        const ws2 = fakeWs();
        reg.attach('u:u1', ws2, { streamId: entry.streamId, afterSeq: 0 });
        expect(ws2.sent[0]).toMatchObject({ type: 'stream_resume', servedModel: 'qwen3.8-27b', gap: true });
        expect(ws2.sent.slice(1).some((e) => e.type === 'served_model')).toBe(false);
    });

    it('served_model 이 없던 스트림은 스냅샷에 필드가 없다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1024);
        const ws1 = fakeWs();
        const entry = reg.open('u:u1', ws1, new AbortController());
        reg.send(entry, { type: 'token', token: 'a' });
        reg.detach(ws1);
        const ws2 = fakeWs();
        reg.attach('u:u1', ws2);
        expect(ws2.sent[0]).not.toHaveProperty('servedModel');
    });
});
