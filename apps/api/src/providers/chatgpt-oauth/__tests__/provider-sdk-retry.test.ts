/**
 * 구독 OAuth 채팅도 한 번 호출 = upstream 한 번 — 앱 SDK 기본 재시도(2회)가 거절된 요청(429·5xx)을 다시 보내지 않는다.
 * 역할 경로에서는 throttleExternalClient 의 429 백오프가 위에 있어 SDK 재시도가 그 아래에서 곱해졌다.
 * 생성자의 transportFactory 주입으로 가짜 fetch 를 넣어 호출 횟수를 센다.
 */
import { ChatGPTOAuthProvider } from '../provider';
import { ProviderError } from '../../provider-errors';

function provider(status: number, calls: string[]): ChatGPTOAuthProvider {
    return new ChatGPTOAuthProvider({
        session: { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        transportFactory: () => ({
            baseURL: 'https://oauth.example.test/v1',
            fetch: async (input) => {
                calls.push(String(input instanceof Request ? input.url : input));
                return new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status, headers: { 'content-type': 'application/json' } });
            },
        }),
    });
}

describe('ChatGPTOAuthProvider — 앱 SDK 재시도 없음', () => {
    it.each([429, 503])('%i → 호출 1회로 오류가 드러난다', async (status: number) => {
        const calls: string[] = [];
        const err = await provider(status, calls)
            .streamChat({ messages: [{ role: 'user', content: 'hi' }], modelId: 'm' }, {})
            .then(() => null, (e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        if (status === 429) expect((err as ProviderError).code).toBe('QUOTA_EXCEEDED');
        expect(calls).toHaveLength(1);
    }, 30_000);
});
