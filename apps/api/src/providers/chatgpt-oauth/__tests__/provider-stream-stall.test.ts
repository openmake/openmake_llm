/**
 * 구독 OAuth 채팅도 외부 스트림 무응답 시한을 탄다 — openai-compat-provider 와 같은 SDK 스트림 구조라 같은 구멍이 있었다
 * (설계 .superpowers/sdd/2026-11-18-gemini-chat-stall §4.1). 헤더가 오지 않는 가짜 upstream 으로 확인한다.
 */
process.env.EXTERNAL_LLM_FIRST_CHUNK_TIMEOUT_MS = '300';
process.env.EXTERNAL_LLM_STREAM_IDLE_TIMEOUT_MS = '300';

import { ChatGPTOAuthProvider } from '../provider';
import { ProviderError } from '../../provider-errors';

let upstreamAborted = false;
function provider(): ChatGPTOAuthProvider {
    return new ChatGPTOAuthProvider({
        session: { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        transportFactory: () => ({
            baseURL: 'https://oauth.example.test/v1',
            fetch: (_input, init) => new Promise<Response>((_, reject) => {
                (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
                    upstreamAborted = true;
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            }),
        }),
    });
}

describe('ChatGPTOAuthProvider — 무응답 시한', () => {
    it('헤더가 오지 않으면 첫 청크 시한에 UPSTREAM_TIMEOUT 으로 끝나고 upstream 요청을 끊는다', async () => {
        const err = await provider()
            .streamChat({ messages: [{ role: 'user', content: 'hi' }], modelId: 'm' }, {})
            .then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe('UPSTREAM_TIMEOUT');
        expect(upstreamAborted).toBe(true);
    }, 5000);
});
