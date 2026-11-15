/**
 * 외부 provider 직결 채팅(게이트웨이를 거치지 않는 경로 — 기본 배포의 API 키 provider 채팅)도 한 번 호출 = upstream 한 번이다.
 * 앱 SDK 기본 재시도(2회)가 있으면 provider 가 거절한 요청(429·5xx)을 다시 보내 거절 뒤 반복 호출이 된다 — 게이트웨이 경유와 같은 규칙.
 * 오류는 곧바로 드러나 채팅 폴백 판정을 탄다. 직결 클라이언트는 SSRF pinned fetch 를 쓰므로 그 자리를 가짜 fetch 로 바꿔 호출 횟수를 센다.
 */
let status = 200;
const calls: string[] = [];
jest.mock('../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../security/ssrf-guard'),
    createPinnedFetch: () => async (input: string | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ error: { message: `status ${status}` } }), { status, headers: { 'content-type': 'application/json' } });
    },
}));

import { OpenAICompatProvider } from '../openai-compat-provider';
import { ProviderError } from '../provider-errors';

const messages = [{ role: 'user' as const, content: '안녕' }];
const direct = () => new OpenAICompatProvider({ providerId: 'compat-test', apiKey: 'user-key', baseUrl: 'https://api.direct.example.test/v1' });

beforeEach(() => { calls.length = 0; });

describe('직결 채팅 — 앱 SDK 재시도 없음', () => {
    it('429 → QUOTA_EXCEEDED 가 호출 1회로 드러난다', async () => {
        status = 429;
        const err = await direct().streamChat({ messages, modelId: 'm' }, {}).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe('QUOTA_EXCEEDED');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe('https://api.direct.example.test/v1/chat/completions');
    }, 30_000);

    it('5xx 도 호출 1회', async () => {
        status = 503;
        const err = await direct().streamChat({ messages, modelId: 'm' }, {}).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(calls).toHaveLength(1);
    }, 30_000);
});
