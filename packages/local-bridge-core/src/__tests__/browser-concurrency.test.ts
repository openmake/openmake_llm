/**
 * LocalBrowser 작업별 창·동시 실행 — 가짜 CDP 로 순서를 확인한다(Chrome 불필요).
 * 같은 작업은 순서대로, 다른 작업은 동시 실행 상한까지 함께(다운로드 폴더가 달라도, 자리 대기는 도착 순), 실행 중인 작업의 창은
 * 회수하지 않는다, 만드는 중인 탭도 탭 상한에 센다.
 */
import { LocalBrowser, type BrowserRunOptions } from '../browser/local-browser';
import { BROWSER_MAX_CONCURRENT, BROWSER_MAX_TABS } from '../constants';
import type { CdpClient } from '../browser/cdp';
import { DownloadTracker } from '../browser/downloads';

/** CDP 명령을 기록하고 최소한으로 답한다. */
type CdpOpts = { newWindowFails?: boolean; createGate?: () => Promise<void> | undefined; createFails?: { left: number } };
function fakeCdp(opts: CdpOpts = {}) {
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
                await opts.createGate?.();
                if (opts.createFails && opts.createFails.left > 0) { opts.createFails.left--; throw new Error('만들기 실패'); }
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
const opts = (taskId: string): BrowserRunOptions => ({ taskId, saveFile: async () => undefined });
const held = (gate: string) => ({ actions: [{ type: 'wait', ms: 0, gate }], sitePolicy: { allow: [], deny: [] } });
let profileSeq = 0;

function setup(cdpOpts?: CdpOpts) {
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

    it('다운로드 폴더(저장 함수)가 다른 작업도 함께 돈다 — 다운로드는 시작한 탭의 작업 것으로 옮긴다', async () => {
        const { browser, g } = setup();
        jest.spyOn(DownloadTracker.prototype, 'configure').mockResolvedValue(); // 가짜 프로필 경로에 대기 폴더를 만들지 않는다
        const a = browser.run(held('A'), { ...opts('A'), placeDownload: async () => 'one' });
        const b = browser.run(held('B'), { ...opts('B'), placeDownload: async () => 'two' });
        await tick(); await tick();
        expect(g.started.sort()).toEqual(['A', 'B']);
        g.release('A'); g.release('B');
        await Promise.all([a, b]);
        await browser.dispose();
    });

    it('자리를 기다리는 요청은 도착 순으로 든다', async () => {
        const { browser, g } = setup();
        const names = Array.from({ length: BROWSER_MAX_CONCURRENT }, (_, k) => `T${k}`);
        const runs = names.map((n) => browser.run(held(n), opts(n)));
        await tick(); await tick();
        runs.push(browser.run(held('W1'), opts('W1')));
        await tick();
        runs.push(browser.run(held('W2'), opts('W2')));
        await tick(); await tick();
        g.release('T0');
        runs.push(browser.run(held('W3'), opts('W3'))); // 자리가 나는 그 순간 온 W3 보다 앞서 기다린 W1 이 든다
        await tick(); await tick();
        expect(g.started.slice(BROWSER_MAX_CONCURRENT)).toEqual(['W1']);
        for (const n of [...names, 'W1', 'W2', 'W3']) g.release(n);
        await Promise.all(runs);
        await browser.dispose();
    });

    it('탭 상한 — 만드는 중인 탭도 세어, 새 작업 둘이 함께 와도 열린 창이 상한을 넘지 않는다', async () => {
        let gate: Promise<void> | undefined;
        const { browser, sent } = setup({ createGate: () => gate });
        const plain = { actions: [{ type: 'wait', ms: 0 }] };
        for (let k = 1; k < BROWSER_MAX_TABS; k++) await browser.run(plain, opts(`idle${k}`));
        let open!: () => void;
        gate = new Promise((r) => { open = r; });
        const both = Promise.all([browser.run(plain, opts('A')), browser.run(plain, opts('B'))]);
        await tick(); await tick();
        open();
        expect((await both).map((r) => r.ok)).toEqual([true, true]);
        const count = (m: string) => sent.filter((s) => s.method === m).length;
        expect(count('Target.createTarget') - count('Target.closeTarget')).toBeLessThanOrEqual(BROWSER_MAX_TABS);
        await browser.dispose();
    });

    it('탭 만들기가 실패해도 만드는 중 수가 내려간다 — 다음 작업이 쓸데없이 창을 회수하지 않는다', async () => {
        const createFails = { left: 0 };
        const { browser, sent } = setup({ createFails });
        const plain = { actions: [{ type: 'wait', ms: 0 }] };
        for (let k = 1; k < BROWSER_MAX_TABS; k++) await browser.run(plain, opts(`idle${k}`));
        createFails.left = 2; // 새 창·탭 둘 다 실패
        expect((await browser.run(plain, opts('X'))).ok).toBe(false);
        expect((await browser.run(plain, opts('Y'))).ok).toBe(true);
        expect(sent.filter((s) => s.method === 'Target.closeTarget')).toEqual([]);
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
