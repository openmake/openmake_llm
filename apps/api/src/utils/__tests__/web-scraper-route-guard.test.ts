/**
 * createRouteGuard — Playwright 의 모든 요청을 SSRF 가드로 검사한다(W3 S6).
 * 판정을 origin 별로 재사용하지 않고 요청마다 검증한다(2026-11-08 점검 후속 보강).
 */
import { createRouteGuard } from '../web-scraper-route-guard';

describe('createRouteGuard', () => {
    it('같은 origin 이라도 요청마다 validate 를 다시 부른다', async () => {
        const validate = jest.fn(async () => undefined);
        const guard = createRouteGuard(validate);
        expect(await guard('https://example.com/a.css')).toBe(true);
        expect(await guard('https://example.com/b.js?x=1')).toBe(true);
        expect(validate).toHaveBeenCalledTimes(2);
    });

    it('같은 origin 에서 앞 요청이 통과해도 뒤 요청의 검증 실패는 false', async () => {
        let calls = 0;
        const validate = jest.fn(async () => {
            calls += 1;
            if (calls > 1) throw new Error('SSRF blocked');
        });
        const guard = createRouteGuard(validate);
        expect(await guard('https://example.com/a')).toBe(true);
        expect(await guard('https://example.com/b')).toBe(false);
    });

    it('validate 가 던지는(사설 호스트) 요청은 false', async () => {
        const validate = jest.fn(async (url: string) => {
            if (new URL(url).hostname === '169.254.169.254') throw new Error('SSRF blocked');
        });
        const guard = createRouteGuard(validate);
        expect(await guard('http://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(await guard('http://169.254.169.254/other')).toBe(false);
    });

    it('URL 로 읽을 수 없는 요청은 validate 없이 false', async () => {
        const validate = jest.fn(async () => undefined);
        const guard = createRouteGuard(validate);
        expect(await guard('not a url')).toBe(false);
        expect(validate).not.toHaveBeenCalled();
    });
});
