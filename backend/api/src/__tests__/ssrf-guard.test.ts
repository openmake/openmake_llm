import { isBlockedIP, safeFetch, validateOutboundUrl } from '../security/ssrf-guard';

describe('isBlockedIP', () => {
    test('blocks 10.0.0.1 (RFC 1918 Class A)', () => {
        expect(isBlockedIP('10.0.0.1')).toBe(true);
    });

    test('blocks 10.255.255.255 (RFC 1918 Class A upper bound)', () => {
        expect(isBlockedIP('10.255.255.255')).toBe(true);
    });

    test('blocks 172.16.0.1 (RFC 1918 Class B)', () => {
        expect(isBlockedIP('172.16.0.1')).toBe(true);
    });

    test('blocks 172.31.255.255 (RFC 1918 Class B upper bound)', () => {
        expect(isBlockedIP('172.31.255.255')).toBe(true);
    });

    test('blocks 192.168.1.1 (RFC 1918 Class C)', () => {
        expect(isBlockedIP('192.168.1.1')).toBe(true);
    });

    test('blocks 127.0.0.1 (loopback)', () => {
        expect(isBlockedIP('127.0.0.1')).toBe(true);
    });

    test('blocks 127.255.255.255 (loopback upper)', () => {
        expect(isBlockedIP('127.255.255.255')).toBe(true);
    });

    test('blocks 169.254.169.254 (AWS metadata)', () => {
        expect(isBlockedIP('169.254.169.254')).toBe(true);
    });

    test('blocks 0.0.0.0', () => {
        expect(isBlockedIP('0.0.0.0')).toBe(true);
    });

    test('blocks ::1 (IPv6 loopback)', () => {
        expect(isBlockedIP('::1')).toBe(true);
    });

    test('blocks fc00::1 (IPv6 ULA)', () => {
        expect(isBlockedIP('fc00::1')).toBe(true);
    });

    test('blocks fe80::1 (IPv6 link-local)', () => {
        expect(isBlockedIP('fe80::1')).toBe(true);
    });

    test('blocks ::ffff:127.0.0.1 (IPv4-mapped IPv6 loopback)', () => {
        expect(isBlockedIP('::ffff:127.0.0.1')).toBe(true);
    });

    test('blocks ::ffff:10.0.0.1 (IPv4-mapped IPv6 private)', () => {
        expect(isBlockedIP('::ffff:10.0.0.1')).toBe(true);
    });

    test('allows 8.8.8.8 (Google DNS)', () => {
        expect(isBlockedIP('8.8.8.8')).toBe(false);
    });

    test('allows 1.1.1.1 (Cloudflare DNS)', () => {
        expect(isBlockedIP('1.1.1.1')).toBe(false);
    });

    test('allows 172.32.0.1 (outside 172.16/12 range)', () => {
        expect(isBlockedIP('172.32.0.1')).toBe(false);
    });

    test('allows 11.0.0.1 (outside 10/8 range)', () => {
        expect(isBlockedIP('11.0.0.1')).toBe(false);
    });

    test('allows ::ffff:8.8.8.8 (IPv4-mapped public)', () => {
        expect(isBlockedIP('::ffff:8.8.8.8')).toBe(false);
    });
});

describe('validateOutboundUrl', () => {
    const publicResolver = async (_hostname: string): Promise<{ address: string }> => ({ address: '93.184.216.34' });
    const loopbackResolver = async (_hostname: string): Promise<{ address: string }> => ({ address: '127.0.0.1' });

    test('rejects ftp:// scheme', async () => {
        await expect(validateOutboundUrl('ftp://example.com', publicResolver)).rejects.toThrow(
            'SSRF blocked: scheme not allowed: ftp:'
        );
    });

    test('rejects file:// scheme', async () => {
        await expect(validateOutboundUrl('file:///etc/passwd', publicResolver)).rejects.toThrow(
            'SSRF blocked: scheme not allowed: file:'
        );
    });

    test('rejects empty string (invalid URL)', async () => {
        await expect(validateOutboundUrl('', publicResolver)).rejects.toThrow();
    });

    test('rejects javascript: scheme', async () => {
        await expect(validateOutboundUrl('javascript:alert(1)', publicResolver)).rejects.toThrow(
            'SSRF blocked: scheme not allowed: javascript:'
        );
    });

    test('allows https://example.com with public resolver', async () => {
        const url = await validateOutboundUrl('https://example.com', publicResolver);
        expect(url.hostname).toBe('example.com');
        expect(url.protocol).toBe('https:');
    });

    test('rejects URL resolving to 127.0.0.1', async () => {
        await expect(validateOutboundUrl('https://example.com', loopbackResolver)).rejects.toThrow(
            'SSRF blocked: resolved to blocked IP range: 127.0.0.1'
        );
    });
});

describe('safeFetch', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function mockFetchSequence(responses: Response[]): {
        fetchFn: typeof fetch;
        calls: Array<{ url: string; init: RequestInit | undefined }>;
    } {
        const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

        const fetchCore = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
            calls.push({ url, init });

            const next = responses.shift();
            if (!next) {
                throw new Error('No mock response configured');
            }

            return next;
        };

        const fetchFn: typeof fetch = Object.assign(fetchCore, {
            preconnect: (_input: string | URL): void => {
                return;
            }
        });

        return { fetchFn, calls };
    }

    test('rejects non-http scheme before fetch', async () => {
        const { fetchFn } = mockFetchSequence([new Response('ok', { status: 200 })]);
        globalThis.fetch = fetchFn;

        await expect(safeFetch('ftp://8.8.8.8/resource')).rejects.toThrow(
            'SSRF blocked: scheme not allowed: ftp:'
        );
    });

    test('returns non-redirect response', async () => {
        const { fetchFn, calls } = mockFetchSequence([new Response('ok', { status: 200 })]);
        globalThis.fetch = fetchFn;

        const response = await safeFetch('https://93.184.216.34/start');

        expect(response.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://93.184.216.34/start');
        expect(calls[0]?.init?.redirect).toBe('manual');
    });

    test('follows a redirect chain and returns final response', async () => {
        const { fetchFn, calls } = mockFetchSequence([
            new Response(null, {
                status: 302,
                headers: { location: 'https://8.8.8.8/final' }
            }),
            new Response('done', { status: 200 })
        ]);
        globalThis.fetch = fetchFn;

        const response = await safeFetch('https://93.184.216.34/start', { method: 'GET' });

        expect(response.status).toBe(200);
        expect(calls).toHaveLength(2);
        expect(calls[0]?.url).toBe('https://93.184.216.34/start');
        expect(calls[1]?.url).toBe('https://8.8.8.8/final');
    });

    test('resolves relative redirects against current URL', async () => {
        const { fetchFn, calls } = mockFetchSequence([
            new Response(null, {
                status: 301,
                headers: { location: '/next' }
            }),
            new Response('ok', { status: 200 })
        ]);
        globalThis.fetch = fetchFn;

        await safeFetch('https://93.184.216.34/base/path');

        expect(calls).toHaveLength(2);
        expect(calls[1]?.url).toBe('https://93.184.216.34/next');
    });

    test('blocks redirect to loopback destination', async () => {
        const { fetchFn } = mockFetchSequence([
            new Response(null, {
                status: 302,
                headers: { location: 'http://127.0.0.1/admin' }
            })
        ]);
        globalThis.fetch = fetchFn;

        await expect(safeFetch('https://93.184.216.34/start')).rejects.toThrow(
            'SSRF blocked: resolved to blocked IP range: 127.0.0.1'
        );
    });

    test('throws when redirects exceed max limit', async () => {
        const responses = [
            new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/r1' } }),
            new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/r2' } }),
            new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/r3' } }),
            new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/r4' } }),
            new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/r5' } })
        ];

        const { fetchFn } = mockFetchSequence(responses);
        globalThis.fetch = fetchFn;

        await expect(safeFetch('https://93.184.216.34/start')).rejects.toThrow('SSRF blocked: too many redirects');
    });
});
