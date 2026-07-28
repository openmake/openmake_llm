import { parseBrowserMetric } from './browser-metrics';

describe('parseBrowserMetric', () => {
    it('셀렉터 성공 + a11y 폴백 성공을 집계', () => {
        const stdout = JSON.stringify({
            ok: true,
            results: [
                { i: 0, type: 'goto', ok: true },
                { i: 1, type: 'click', ok: false, error: 'no selector' }, // CSS 실패
                { i: 2, type: 'snapshot', ok: true },                     // a11y 발동
                { i: 3, type: 'smartClick', ok: true },                   // a11y 구원
            ],
        });
        expect(parseBrowserMetric(stdout)).toEqual({
            totalActions: 4,
            selectorActions: 1,
            selectorFail: 1,
            a11yAttempt: 2,
            a11yFail: 0,
            overallOk: true,
        });
    });

    it('canvas 신호: 셀렉터·a11y 모두 실패', () => {
        const stdout = JSON.stringify({
            ok: false,
            results: [
                { i: 0, type: 'fill', ok: false },
                { i: 1, type: 'smartFill', ok: false },
            ],
        });
        const m = parseBrowserMetric(stdout)!;
        expect(m.selectorFail).toBe(1);
        expect(m.a11yFail).toBe(1);
        expect(m.overallOk).toBe(false);
    });

    it('파싱 불가 / results 없음이면 null(잡음 미기록)', () => {
        expect(parseBrowserMetric('not json')).toBeNull();
        expect(parseBrowserMetric(JSON.stringify({ ok: false, error: 'boom' }))).toBeNull();
    });
});
