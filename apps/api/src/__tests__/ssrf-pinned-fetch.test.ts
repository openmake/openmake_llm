import { createPinnedFetch } from '../security/ssrf-guard';

/**
 * createPinnedFetch — OpenAI SDK / MCP transport 에 주입되는 SSRF-safe fetch.
 * 등록 후 DNS 를 사설/메타데이터 IP 로 rebinding 해도 런타임 호출이 차단되는지 검증.
 */
describe('createPinnedFetch — 런타임 DNS Rebinding 방어', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    function stubFetch(): Array<{ url: string; init: RequestInit | undefined }> {
        const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
        const fetchCore = async (input: unknown, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : (input as URL).toString();
            calls.push({ url, init });
            return new Response('ok', { status: 200 });
        };
        globalThis.fetch = Object.assign(fetchCore, { preconnect: () => undefined }) as typeof fetch;
        return calls;
    }

    test('resolved IP 가 사설/차단 대역이면 요청을 거부 (rebinding 차단)', async () => {
        stubFetch();
        const rebindResolver = async (): Promise<{ address: string }> => ({ address: '127.0.0.1' });
        const pinned = createPinnedFetch(rebindResolver);

        await expect(pinned('https://attacker.example/v1/models')).rejects.toThrow(/SSRF blocked/);
    });

    test('메타데이터 IP(169.254.169.254) 로의 rebinding 도 거부', async () => {
        stubFetch();
        const resolver = async (): Promise<{ address: string }> => ({ address: '169.254.169.254' });
        const pinned = createPinnedFetch(resolver);

        await expect(pinned('https://attacker.example/latest/meta-data')).rejects.toThrow(/SSRF blocked/);
    });

    test('공인 IP 로 해석되면 통과하고 hostname 을 보존 (SNI 유지) + IP 핀', async () => {
        const calls = stubFetch();
        let resolverCalls = 0;
        const resolver = async (): Promise<{ address: string }> => {
            resolverCalls++;
            return { address: '93.184.216.34' };
        };
        const pinned = createPinnedFetch(resolver);

        const res = await pinned('https://example.com/v1/chat/completions', { method: 'POST' });
        expect(res.status).toBe(200);
        expect(resolverCalls).toBe(1);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://example.com/v1/chat/completions');
        expect((calls[0].init as Record<string, unknown>).dispatcher).toBeDefined();
        expect((calls[0].init as RequestInit).method).toBe('POST');
    });

    test('URL 객체 입력도 처리한다', async () => {
        const calls = stubFetch();
        const resolver = async (): Promise<{ address: string }> => ({ address: '93.184.216.34' });
        const pinned = createPinnedFetch(resolver);

        await pinned(new URL('https://example.com/v1/models'));
        expect(calls[0].url).toBe('https://example.com/v1/models');
    });
});
