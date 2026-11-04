/**
 * LocalBrowser 작업별 창·동시 실행 — 가짜 CDP 로 순서를 확인한다(Chrome 불필요).
 * 같은 작업은 순서대로, 다른 작업은 동시 실행 상한까지 함께, 다운로드 폴더가 다르면 순서대로, 실행 중인 작업의 창은 회수하지 않는다.
 */
import { LocalBrowser, type BrowserRunOptions } from '../browser/local-browser';
import { BROWSER_MAX_CONCURRENT, BROWSER_MAX_TABS } from '../constants';
import type { CdpClient } from '../browser/cdp';

/** CDP 명령을 기록하고 최소한으로 답한다. */
function fakeCdp(opts: { newWindowFails?: boolean } = {}) {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    let n = 0;
    const cdp = {
        isOpen: true,
        on: () => () => undefined,
        waitFor: async () => null,
        close: () => undefined,
        send: async (method: string, params: Record<string, unknown> = {}) => {
            sent.push({ method, params });
            if (method === 'Target.createTarget') {
                if (opts.newWindowFails && params.newWindow) throw new Error('newWindow 미지원');
                return { targetId: `target-${++n}` };
            }
            if (method === 'Target.attachToTarget') return { sessionId: `session-${params.targetId as string}` };
            if (method === 'Runtime.evaluate') return { result: { value: 'about:blank' } };
            return {};
        },
    };
    return { cdp: cdp as unknown as CdpClient, sent };
}

/** wait 액션의 실행을 테스트가 손으로 풀어 준다 — gate 이름이 있는 액션은 release(gate) 까지 멈춘다. */
function gates() {
    const started: string[] = [];
    const open = new Map<string, () => void>();
    const waiting = new Map<string, Promise<void>>();
    const gate = (name: string) => {
        if (!waiting.has(name)) waiting.set(name, new Promise<void>((r) => open.set(name, r)));
        return waiting.get(name)!;
    };
    return {
        started,
        release: (name: string) => { gate(name); open.get(name)!(); },
        impl: async (_cdp: unknown, _tab: unknown, a: { type?: unknown; gate?: string }, i: number) => {
            if (a.gate) { started.push(a.gate); await gate(a.gate); }
            return { i, type: a.type, ok: true };
        },
    };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const opts = (taskId: string, downloadDir = '/tmp/out'): BrowserRunOptions => ({ taskId, downloadDir, saveFile: async () => undefined });
const held = (gate: string) => ({ actions: [{ type: 'wait', ms: 0, gate }], sitePolicy: { allow: [], deny: [] } });
let profileSeq = 0;

function setup(cdpOpts?: { newWindowFails?: boolean }) {
    const { cdp, sent } = fakeCdp(cdpOpts);
    const g = gates();
    const proto = LocalBrowser.prototype as unknown as Record<string, unknown>;
    const connectSpy = jest.spyOn(proto as never, 'openConnection' as never).mockImplementation((async () => {
        await tick(); // 연결에 시간이 걸린다 — 동시에 들어온 요청이 이 사이에 겹친다
        return cdp;
    }) as never);
    jest.spyOn(proto as never, 'runAction' as never).mockImplementation(g.impl as never);
    const browser = LocalBrowser.forProfile(`/fake-profile-${++profileSeq}`);
    return { browser, sent, g, connectSpy };
}

afterEach(() => jest.restoreAllMocks());

describe('LocalBrowser 동시 실행(가짜 CDP)', () => {
    it('다른 작업은 함께 실행되고, 연결은 한 번만 연다', async () => {
        const { browser, g, connectSpy } = setup();
        const a = browser.run(held('A'), opts('A'));
        const b = browser.run(held('B'), opts('B'));
        await tick(); await tick();
        expect(g.started.sort()).toEqual(['A', 'B']);
        expect(connectSpy).toHaveBeenCalledTimes(1);
        g.release('A'); g.release('B');
        expect((await a).ok).toBe(true);
        expect((await b).ok).toBe(true);
        await browser.dispose();
    });

    it('같은 작업은 앞 요청이 끝난 뒤에 실행한다', async () => {
        const { browser, g } = setup();
        const first = browser.run(held('A1'), opts('A'));
        const second = browser.run(held('A2'), opts('A'));
        await tick(); await tick();
        expect(g.started).toEqual(['A1']);
        g.release('A1');
        await first;
        await tick(); await tick();
        expect(g.started).toEqual(['A1', 'A2']);
        g.release('A2');
        await second;
        await browser.dispose();
    });

    it(`동시 실행은 ${BROWSER_MAX_CONCURRENT}개까지 — 넘으면 자리가 날 때까지 기다린다`, async () => {
        const { browser, g } = setup();
        const names = Array.from({ length: BROWSER_MAX_CONCURRENT + 1 }, (_, k) => `T${k}`);
        const runs = names.map((n) => browser.run(held(n), opts(n)));
        await tick(); await tick();
        expect(g.started).toHaveLength(BROWSER_MAX_CONCURRENT);
        g.release(g.started[0]);
        await tick(); await tick();
        expect(g.started).toHaveLength(BROWSER_MAX_CONCURRENT + 1);
        for (const n of names) g.release(n);
        await Promise.all(runs);
        await browser.dispose();
    });

    it('다운로드 폴더가 다른 작업끼리는 함께 돌리지 않는다(브라우저 전역 설정)', async () => {
        const { browser, g } = setup();
        const a = browser.run(held('A'), opts('A', '/tmp/one'));
        const b = browser.run(held('B'), opts('B', '/tmp/two'));
        await tick(); await tick();
        expect(g.started).toEqual(['A']);
        g.release('A');
        await a;
        await tick(); await tick();
        expect(g.started).toEqual(['A', 'B']);
        g.release('B');
        await b;
        await browser.dispose();
    });

    it('작업마다 뒤쪽 새 창을 열고, 안 되면 탭으로 연다', async () => {
        const one = setup();
        await one.browser.run({ actions: [{ type: 'wait', ms: 0 }] }, opts('A'));
        expect(one.sent.filter((s) => s.method === 'Target.createTarget').map((s) => s.params)).toEqual([{ url: 'about:blank', newWindow: true, background: true }]);
        await one.browser.dispose();
        jest.restoreAllMocks();
        const two = setup({ newWindowFails: true });
        const r = await two.browser.run({ actions: [{ type: 'wait', ms: 0 }] }, opts('A'));
        expect(r.ok).toBe(true);
        expect(two.sent.filter((s) => s.method === 'Target.createTarget').map((s) => s.params)).toEqual([
            { url: 'about:blank', newWindow: true, background: true }, { url: 'about:blank' },
        ]);
        await two.browser.dispose();
    });

    it('창 수 상한에서 회수할 때 실행 중인 작업의 창은 닫지 않는다', async () => {
        const { browser, g, sent } = setup();
        const running = browser.run(held('R'), opts('R')); // 가장 먼저 연 창 — 가장 오래됐지만 실행 중
        await tick(); await tick();
        for (let k = 1; k < BROWSER_MAX_TABS; k++) {
            await browser.run({ actions: [{ type: 'wait', ms: 0 }] }, opts(`idle${k}`));
            await tick();
        }
        await browser.run({ actions: [{ type: 'wait', ms: 0 }] }, opts('new'));
        const closed = sent.filter((s) => s.method === 'Target.closeTarget').map((s) => s.params.targetId);
        expect(closed).toEqual(['target-2']); // R 은 target-1, 그다음으로 오래된 idle1 이 target-2
        g.release('R');
        expect((await running).ok).toBe(true);
        await browser.dispose();
    });

    it('requestStop(taskId) 는 그 작업만 멈추고, 인자 없으면 모두 멈춘다', async () => {
        const { browser, g } = setup();
        const two = (gate: string) => ({ actions: [{ type: 'wait', ms: 0, gate }, { type: 'wait', ms: 0 }], sitePolicy: { allow: [], deny: [] } });
        let a = browser.run(two('A'), opts('A'));
        let b = browser.run(two('B'), opts('B'));
        await tick(); await tick();
        browser.requestStop('A');
        g.release('A'); g.release('B');
        let [ra, rb] = await Promise.all([a, b]);
        expect(ra.ok).toBe(false);
        expect(String(ra.results[1].error)).toContain('중지');
        expect(rb.ok).toBe(true);

        a = browser.run(two('A2'), opts('A'));
        b = browser.run(two('B2'), opts('B'));
        await tick(); await tick();
        browser.requestStop();
        g.release('A2'); g.release('B2');
        [ra, rb] = await Promise.all([a, b]);
        expect(ra.ok).toBe(false);
        expect(rb.ok).toBe(false);
        await browser.dispose();
    });

    it('조건 평가 중 requestStop 이면 남은 조건을 평가하지 않고 중지 오류로 끝난다', async () => {
        const { browser } = setup();
        let conds = 0;
        jest.spyOn(LocalBrowser.prototype as never, 'evaluate' as never).mockImplementation((async (_cdp: unknown, _tab: unknown, expression: string) => {
            if (expression === 'location.href') return 'about:blank';
            if (++conds === 3) browser.requestStop('A');
            return true;
        }) as never);
        const flow = [{ type: 'repeat', times: 20, while: { exists: '#more' }, actions: [{ type: 'if', cond: { exists: '#x' }, then: [] }] }];
        const r = await browser.run({ actions: flow, sitePolicy: { allow: [], deny: [] } }, opts('A'));
        expect(r.ok).toBe(false);
        expect(conds).toBe(3);
        expect(String(r.results.find((x) => x.error)?.error)).toContain('중지');
        await browser.dispose();
    });
});
