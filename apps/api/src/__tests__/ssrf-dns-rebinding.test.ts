import { safeFetch } from '../security/ssrf-guard';

describe('safeFetch — DNS Rebinding defense (undici Agent 기반)', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    test('resolver를 요청당 한 번만 호출하여 DNS rebinding 방어', async () => {
        let callCount = 0;
        const rebindResolver = async (): Promise<{ address: string }> => {
            callCount++;
            return { address: callCount === 1 ? '93.184.216.34' : '127.0.0.1' };
        };

        const fetchCore = async (): Promise<Response> => new Response('ok', { status: 200 });
        globalThis.fetch = Object.assign(fetchCore, { preconnect: () => undefined }) as typeof fetch;

        const response = await safeFetch('https://attacker.example/', undefined, rebindResolver);
        expect(response.status).toBe(200);
        expect(callCount).toBe(1);
    });

    test('fetch는 원 hostname을 유지한 URL로 호출된다 (SNI 보존)', async () => {
        const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
        const fetchCore = async (input: unknown, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : (input as URL).toString();
            calls.push({ url, init });
            return new Response('ok', { status: 200 });
        };
        globalThis.fetch = Object.assign(fetchCore, { preconnect: () => undefined }) as typeof fetch;

        const publicResolver = async (): Promise<{ address: string }> => ({ address: '93.184.216.34' });
        await safeFetch('https://example.com/path', undefined, publicResolver);

        expect(calls).toHaveLength(1);
        // hostname이 유지되어 TLS SNI가 정상 동작
        expect(calls[0].url).toBe('https://example.com/path');
    });

    test('dispatcher 옵션이 fetch init에 주입된다', async () => {
        const calls: Array<{ init: RequestInit | undefined }> = [];
        const fetchCore = async (_input: unknown, init?: RequestInit): Promise<Response> => {
            calls.push({ init });
            return new Response('ok', { status: 200 });
        };
        globalThis.fetch = Object.assign(fetchCore, { preconnect: () => undefined }) as typeof fetch;

        const publicResolver = async (): Promise<{ address: string }> => ({ address: '93.184.216.34' });
        await safeFetch('https://example.com/', undefined, publicResolver);

        expect(calls).toHaveLength(1);
        // undici Agent가 dispatcher로 주입되어 connect 시점의 IP를 핀
        expect((calls[0].init as Record<string, unknown>).dispatcher).toBeDefined();
    });

    test('redirect chain에서 매 홉마다 DNS 검증 수행', async () => {
        let resolverCalls = 0;
        const publicResolver = async (): Promise<{ address: string }> => {
            resolverCalls++;
            return { address: '93.184.216.34' };
        };

        const responses: Response[] = [
            new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }),
            new Response('done', { status: 200 }),
        ];
        const fetchCore = async (): Promise<Response> => responses.shift()!;
        globalThis.fetch = Object.assign(fetchCore, { preconnect: () => undefined }) as typeof fetch;

        const response = await safeFetch('https://example.com/', undefined, publicResolver);
        expect(response.status).toBe(200);
        // 원본 + 1 redirect = 2 DNS 조회
        expect(resolverCalls).toBe(2);
    });
});
