/**
 * extract_webpage — fetch 실패의 진짜 원인(undici error.cause)을 결과 텍스트에 남긴다.
 *
 * 배경: catch 가 `오류: ${e}` 로만 적어 `TypeError: fetch failed` 만 보이고 ENOTFOUND·ECONNREFUSED 같은 원인이 사라졌다.
 */
const mockSafeFetch = jest.fn();

jest.mock('../../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../../security/ssrf-guard'),
    safeFetch: mockSafeFetch,
}));

import { webSearchTools } from '../tools';
import { describeFetchError } from '../providers';
import { classifyToolError } from '../../../tool-contract/tool-error-classifier';

const extract = webSearchTools.find((t) => t.tool.name === 'extract_webpage')!;
const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? '';

const fetchFailed = () => Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }),
});

describe('extract_webpage fetch 실패 원인', () => {
    afterEach(() => mockSafeFetch.mockReset());

    it('cause 의 코드를 결과 텍스트에 남기고 isError 로 돌려준다', async () => {
        mockSafeFetch.mockRejectedValueOnce(fetchFailed());
        const r = await extract.handler({ url: 'https://x/' });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('fetch failed');
        expect(textOf(r)).toContain('ENOTFOUND');
    });

    it('결과 텍스트는 provider(재시도 가능)로 분류된다', async () => {
        mockSafeFetch.mockRejectedValueOnce(fetchFailed());
        const r = await extract.handler({ url: 'https://x/' });
        const c = classifyToolError(textOf(r));
        expect(c.category).toBe('provider');
        expect(c.retryable).toBe(true);
    });

    it('SSRF 차단 메시지는 그대로 통과한다', async () => {
        mockSafeFetch.mockRejectedValueOnce(new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.1'));
        const r = await extract.handler({ url: 'http://10.0.0.1/' });
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('SSRF blocked: resolved to blocked IP range: 10.0.0.1');
    });
});

describe('describeFetchError', () => {
    it('cause 가 있으면 code·message 를 덧붙인다', () => {
        const text = describeFetchError(Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:80'), { code: 'ECONNREFUSED' }),
        }));
        expect(text).toMatch(/^fetch failed \(.*ECONNREFUSED.*\)$/);
        expect(text).toContain('127.0.0.1:80');
    });

    it('cause 에 message 가 없고 code 만 있어도 code 를 남긴다', () => {
        const text = describeFetchError(Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error(''), { code: 'ECONNREFUSED' }),
        }));
        expect(text).toBe('fetch failed (ECONNREFUSED)');
    });

    it('중첩 cause 는 1단계만 본다', () => {
        const inner = Object.assign(new Error('deep'), { code: 'EDEEP' });
        const text = describeFetchError(Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('outer cause'), { cause: inner }),
        }));
        expect(text).toBe('fetch failed (outer cause)');
    });

    it('cause 가 없으면 종전처럼 message 만 돌려준다', () => {
        expect(describeFetchError(new Error('network error'))).toBe('network error');
        expect(describeFetchError('raw')).toBe('raw');
    });

    it('timeout·abort 분기는 종전과 같다', () => {
        const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
        const abort = Object.assign(new Error('a'), { name: 'AbortError' });
        expect(describeFetchError(timeout)).toMatch(/^timeout\(\d+ms 초과\)$/);
        expect(describeFetchError(abort)).toBe('요청 중단(abort)');
    });
});
