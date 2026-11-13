import { isKeenableEnabled, searchKeenable } from '../providers';
import { getConfig } from '../../../config/env';

jest.mock('../../../config/env', () => ({
    getConfig: jest.fn(() => ({ logLevel: 'error', keenableSearch: '', keenableApiKey: '' })),
}));

const mockGetConfig = getConfig as unknown as jest.Mock;
const mockFetch = jest.fn();

function config(overrides: Record<string, string> = {}) {
    return { logLevel: 'error', keenableSearch: '', keenableApiKey: '', ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockGetConfig.mockReturnValue(config());
});

describe('isKeenableEnabled', () => {
    it('is off by default', () => {
        expect(isKeenableEnabled()).toBe(false);
    });

    it.each(['true', '1', 'yes', 'on', 'TRUE'])('treats %s as enabled', (value) => {
        mockGetConfig.mockReturnValue(config({ keenableSearch: value }));
        expect(isKeenableEnabled()).toBe(true);
    });

    it('enables when an API key is set', () => {
        mockGetConfig.mockReturnValue(config({ keenableApiKey: 'keen_test' }));
        expect(isKeenableEnabled()).toBe(true);
    });
});

describe('searchKeenable', () => {
    it('does not call the API when disabled', async () => {
        expect(await searchKeenable('q', 5)).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses the public endpoint and X-Keenable-Title when enabled without a key', async () => {
        mockGetConfig.mockReturnValue(config({ keenableSearch: 'true' }));
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { title: 'Docs', url: 'https://docs.keenable.ai/', snippet: 'Search API', published_at: '2026-11-10T00:00:00Z' },
                    { title: 'missing url' },
                ],
            }),
        });

        const results = await searchKeenable('keenable search', 5);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.keenable.ai/v1/search/public');
        expect(init.method).toBe('POST');
        expect(init.headers['X-Keenable-Title']).toBe('OpenMake');
        expect(init.headers['X-API-Key']).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({ query: 'keenable search', max_results: 5 });
        expect(results).toEqual([
            { title: 'Docs', url: 'https://docs.keenable.ai/', snippet: 'Search API', source: 'keenable.ai', date: '2026-11-10T00:00:00Z' },
        ]);
    });

    it('uses the keyed endpoint when KEENABLE_API_KEY is set', async () => {
        mockGetConfig.mockReturnValue(config({ keenableApiKey: 'keen_test' }));
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ results: [{ title: 'A', url: 'https://example.com', snippet: 's' }] }),
        });

        await searchKeenable('q', 3);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.keenable.ai/v1/search');
        expect(init.headers['X-API-Key']).toBe('keen_test');
        expect(init.headers['X-Keenable-Title']).toBe('OpenMake');
    });

    it('returns [] on HTTP errors', async () => {
        mockGetConfig.mockReturnValue(config({ keenableSearch: '1' }));
        mockFetch.mockResolvedValue({ ok: false, status: 502 });
        expect(await searchKeenable('q', 5)).toEqual([]);
    });
});
