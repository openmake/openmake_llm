/**
 * createRouteGuard — Playwright 의 모든 요청을 SSRF 가드로 검사하되 같은 origin 은 한 번만 검증한다(W3 S6).
 */
import { createRouteGuard } from '../web-scraper-route-guard';

describe('createRouteGuard', () => {
    it('같은 origin 의 두 URL 은 validate 를 한 번만 부르고 둘 다 통과한다', async () => {
        const validate = jest.fn(async () => undefined);
        const guard = createRouteGuard(validate);
        expect(await guard('https://example.com/a.css')).toBe(true);
        expect(await guard('https://example.com/b.js?x=1')).toBe(true);
        expect(validate).toHaveBeenCalledTimes(1);
    });

    it('validate 가 던지는(사설 호스트) 요청은 false', async () => {
        const validate = jest.fn(async (url: string) => {
            if (new URL(url).hostname === '169.254.169.254') throw new Error('SSRF blocked');
        });
        const guard = createRouteGuard(validate);
        expect(await guard('http://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(await guard('http://169.254.169.254/other')).toBe(false);
        expect(validate).toHaveBeenCalledTimes(1);
    });

    it('다른 origin(호스트·포트·스킴) 은 각각 검증한다', async () => {
        const validate = jest.fn(async () => undefined);
        const guard = createRouteGuard(validate);
        await guard('https://example.com/');
        await guard('https://cdn.example.com/');
        await guard('https://example.com:8443/');
        await guard('http://example.com/');
        expect(validate).toHaveBeenCalledTimes(4);
    });
});
