import { visitedUrls, guardBrowserResult } from './browser-result-guard';
import { getBrowserRedirectBlockedMessage } from '../../prompts/agent-task-browser-web';
import type { ExecResult } from './executor';

const exec = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 5 });
/** 호스트 이름별로 통과·차단을 고정한 가짜 검증기(실제 DNS 를 타지 않는다). */
const validate = (ok: string[]) => async (url: string): Promise<void> => {
    if (!ok.includes(new URL(url).hostname)) throw new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.5');
};

describe('visitedUrls — 브라우저 결과에서 실제로 도착한 주소를 뽑는다', () => {
    it('finalUrl 과 goto 결과의 url 을 중복 없이 모은다(http·https 만)', () => {
        const out = JSON.stringify({ ok: true, finalUrl: 'http://10.0.0.5/admin', results: [
            { i: 0, type: 'goto', ok: true, url: 'https://example.com/' },
            { i: 1, type: 'goto', ok: true, url: 'http://10.0.0.5/admin' },
            { i: 2, type: 'extractText', ok: true, text: '"url":"http://in-text.example/"' },
        ] });
        expect(visitedUrls(out)).toEqual(['http://10.0.0.5/admin', 'https://example.com/']);
    });

    it('about:blank·chrome-error 같은 내부 주소는 뺀다', () => {
        expect(visitedUrls(JSON.stringify({ ok: false, finalUrl: 'chrome-error://chromewebdata/', results: [{ type: 'goto', ok: true, url: 'about:blank' }] }))).toEqual([]);
    });

    it('출력이 잘려 JSON 이 깨져도 앞부분의 주소는 찾는다(본문 안의 문자열은 주소로 보지 않는다)', () => {
        const cut = '{"ok":true,"finalUrl":"http://169.254.169.254/latest","results":[{"i":0,"type":"goto","ok":true,"url":"https://a.example/x"},{"i":1,"type":"extractText","ok":true,"text":"see \\"url\\":\\"http://in-text.example/\\" and mo';
        expect(visitedUrls(cut)).toEqual(['http://169.254.169.254/latest', 'https://a.example/x']);
    });

    it('결과가 JSON 이 아니면 빈 배열이다', () => {
        expect(visitedUrls('')).toEqual([]);
        expect(visitedUrls('docker: Error response from daemon')).toEqual([]);
    });
});

describe('guardBrowserResult — 리다이렉트로 도착한 주소가 막힌 주소면 본문을 주지 않는다', () => {
    const redirected = JSON.stringify({ ok: true, finalUrl: 'http://internal.corp/secret', results: [
        { i: 0, type: 'goto', ok: true, url: 'http://internal.corp/secret' },
        { i: 1, type: 'extractText', ok: true, text: 'TOP SECRET' },
    ] });

    it('막힌 주소에 도착했으면 결과 본문 대신 차단 안내를 돌려준다', async () => {
        const r = await guardBrowserResult(exec(redirected), { validate: validate(['example.com']) });
        expect(r.stdout).toBe('');
        expect(r.stderr).toBe(getBrowserRedirectBlockedMessage(['http://internal.corp/secret']));
        expect(r.stderr).not.toContain('TOP SECRET');
        expect(r.exitCode).not.toBe(0);
    });

    it('도착한 주소가 모두 공개 주소면 결과를 그대로 돌려준다', async () => {
        const input = exec(redirected);
        expect(await guardBrowserResult(input, { validate: validate(['internal.corp']) })).toEqual(input);
    });

    it('꺼져 있으면 검사하지 않는다', async () => {
        const input = exec(redirected);
        expect(await guardBrowserResult(input, { validate: validate([]), redirectGuard: false })).toEqual(input);
    });
});
