import { findBlockedBrowserUrls } from './browser-url-guard';

/** 호스트 이름 → 해석 주소를 고정한 가짜 검증기(실제 DNS 를 타지 않는다). */
const validate = (table: Record<string, 'ok' | 'blocked'>) => async (url: string): Promise<void> => {
    const host = new URL(url).hostname;
    if ((table[host] ?? 'blocked') === 'blocked') throw new Error(`SSRF blocked: resolved to blocked IP range: 10.0.0.5`);
};

describe('findBlockedBrowserUrls — 브라우저가 이동하려는 주소를 실행 전에 검사한다', () => {
    it('사설망·메타데이터로 해석되는 goto 를 찾아낸다', async () => {
        const blocked = await findBlockedBrowserUrls([
            { type: 'goto', url: 'https://example.com/a' },
            { type: 'click', selector: '#go' },
            { type: 'goto', url: 'http://169.254.169.254/latest/meta-data/' },
            { type: 'goto', url: 'http://host.docker.internal:52418/api/health' },
        ], validate({ 'example.com': 'ok' }));
        expect(blocked.map((b) => b.url)).toEqual(['http://169.254.169.254/latest/meta-data/', 'http://host.docker.internal:52418/api/health']);
        expect(blocked[0].index).toBe(2);
    });

    it('막을 것이 없으면 빈 배열이다', async () => {
        expect(await findBlockedBrowserUrls([{ type: 'goto', url: 'https://example.com' }, { type: 'extractText' }], validate({ 'example.com': 'ok' }))).toEqual([]);
    });

    it('about:blank 와 url 없는 액션은 검사하지 않는다', async () => {
        expect(await findBlockedBrowserUrls([{ type: 'goto', url: 'about:blank' }, { type: 'goto' }, null, 'x'], validate({}))).toEqual([]);
    });

    it('http(s) 가 아닌 스킴과 형식이 틀린 주소는 막는다', async () => {
        const blocked = await findBlockedBrowserUrls([{ type: 'goto', url: 'file:///etc/passwd' }, { type: 'goto', url: 'not a url' }], validate({}));
        expect(blocked).toHaveLength(2);
    });
});
