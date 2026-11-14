/**
 * LocalBrowser 다운로드 추적(설계 B-1·B-3·B-4·B-7) — 가짜 CDP 로 확인한다(Chrome 불필요).
 * Chrome 은 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로만 받고, 완료되면 시작 때 묶은 저장 함수가 옮긴다.
 * 이벤트는 `Page.*`(브리지가 붙은 탭 — sessionId)와 `Browser.*`(붙지 않은 새 창 — sessionId 없음) 두 채널로 오며 guid 로 합친다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { LocalBrowser, type BrowserRunOptions } from '../browser/local-browser';
import { CdpClient } from '../browser/cdp';
import { DownloadRejectedError } from '../browser/download-place';
import * as chrome from '../browser/chrome';

jest.mock('../constants', () => ({ ...jest.requireActual('../constants'), BROWSER_DOWNLOAD_WAIT_MS: 150 }));
jest.mock('../browser/chrome', () => ({ ...jest.requireActual('../browser/chrome'), readDevToolsEndpoint: jest.fn(), launchChrome: jest.fn() }));

type Handler = (params: Record<string, unknown>, sessionId?: string) => void;

/** CDP 명령을 기록하고 최소한으로 답한다. 이벤트는 emit 으로 테스트가 보낸다. */
function fakeCdp(navigate: Record<string, unknown> = { loaderId: 'l1' }) {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    const handlers = new Map<string, Set<Handler>>();
    let n = 0;
    const cdp = {
        isOpen: true,
        on: (event: string, h: Handler) => {
            if (!handlers.has(event)) handlers.set(event, new Set());
            handlers.get(event)!.add(h);
            return () => { handlers.get(event)!.delete(h); };
        },
        waitFor: async () => ({}),
        close: () => undefined,
        send: async (method: string, params: Record<string, unknown> = {}) => {
            sent.push({ method, params });
            if (method === 'Target.createTarget') return { targetId: `target-${++n}` };
            if (method === 'Target.attachToTarget') return { sessionId: `session-${params.targetId as string}` };
            if (method === 'Target.getTargets') return { targetInfos: [] };
            if (method === 'Runtime.evaluate') return { result: { value: params.expression === 'location.href' ? 'about:blank' : 'complete' } };
            if (method === 'Page.navigate') return navigate;
            return {};
        },
    };
    const emit = (event: string, params: Record<string, unknown>, sessionId?: string) => {
        for (const h of [...(handlers.get(event) ?? [])]) h(params, sessionId);
    };
    return { cdp: cdp as unknown as CdpClient, sent, emit };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
let tmp = '';
let profile = '';
let staging = '';

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-dltrack-')));
    profile = path.join(tmp, 'profile');
    staging = `${profile}-downloads`;
    (chrome.readDevToolsEndpoint as jest.Mock).mockReturnValue('ws://127.0.0.1:1/devtools/browser/x');
});
afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

/** 액션 실행 — `hook` 이 있는 wait 액션은 실행 중에 그 함수를 부른다(다운로드 이벤트를 보내는 자리). gate 는 테스트가 풀 때까지 멈춘다. */
function setup(navigate?: Record<string, unknown>, mockActions = true) {
    const f = fakeCdp(navigate);
    jest.spyOn(CdpClient, 'connect').mockResolvedValue(f.cdp);
    const hooks = new Map<string, () => void | Promise<void>>();
    const gates = new Map<string, Promise<void>>();
    const open = new Map<string, () => void>();
    const gate = (name: string) => {
        if (!gates.has(name)) gates.set(name, new Promise<void>((r) => open.set(name, r)));
        return gates.get(name)!;
    };
    if (mockActions) {
        jest.spyOn(LocalBrowser.prototype as never, 'runAction' as never).mockImplementation((async (_c: unknown, _t: unknown, a: { type?: unknown; hook?: string; gate?: string }, i: number) => {
            if (a.gate) await gate(a.gate);
            if (a.hook) await hooks.get(a.hook)!();
            return { i, type: a.type, ok: true };
        }) as never);
    }
    const browser = LocalBrowser.forProfile(profile);
    return { browser, ...f, hooks, release: (name: string) => { gate(name); open.get(name)!(); } };
}

const act = (extra: Record<string, unknown> = {}) => ({ actions: [{ type: 'wait', ms: 0, ...extra }], sitePolicy: { allow: [], deny: [] } });
const opts = (taskId: string, placeDownload?: BrowserRunOptions['placeDownload']): BrowserRunOptions => ({
    taskId, downloadDir: '/tmp/out', saveFile: async () => undefined, ...(placeDownload ? { placeDownload } : {}),
});
/** 대기 폴더에 Chrome 이 받은 것처럼 `<guid>` 파일을 둔다. */
const stage = (guid: string) => fs.writeFileSync(path.join(staging, guid), 'data');
const begin = (guid: string, name: string, frameId: string) => ({ guid, suggestedFilename: name, frameId, url: 'http://x/' });

describe('LocalBrowser 다운로드(가짜 CDP)', () => {
    it('저장 함수가 있으면 allowAndName·대기 폴더(0700)·eventsEnabled 로, 없으면 deny 로 설정한다', async () => {
        const { browser, sent } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        await browser.run(act(), opts('A'));
        expect(sent.filter((s) => s.method === 'Browser.setDownloadBehavior').map((s) => s.params)).toEqual([
            { behavior: 'allowAndName', downloadPath: staging, eventsEnabled: true },
            { behavior: 'deny' },
        ]);
        expect(fs.statSync(staging).mode & 0o777).toBe(0o700);
        await browser.dispose();
    });

    it('Page.* 채널(탭 sessionId)로 온 다운로드 — 저장 함수를 한 번 부르고 결과에 saved 로 싣는다(url 없음)', async () => {
        const { browser, hooks, emit } = setup();
        const place = jest.fn(async (name: string) => `saved-${name}`);
        hooks.set('dl', () => {
            stage('g1');
            emit('Page.downloadWillBegin', begin('g1', 'report.txt', 'target-1'), 'session-target-1');
            emit('Page.downloadProgress', { guid: 'g1', state: 'inProgress' }, 'session-target-1');
            emit('Page.downloadProgress', { guid: 'g1', state: 'completed' }, 'session-target-1');
        });
        const r = await browser.run(act({ hook: 'dl' }), opts('A', place));
        expect(place.mock.calls).toEqual([['report.txt', path.join(staging, 'g1')]]);
        expect(r.ok).toBe(true);
        expect(r.downloads).toEqual([{ name: 'report.txt', state: 'saved', savedAs: 'saved-report.txt' }]);
        await browser.dispose();
    });

    it('Browser.* 채널(sessionId 없음)로 온 다운로드도 같다 — frameId 가 작업 탭이면 그 작업', async () => {
        const { browser, hooks, emit } = setup();
        const place = jest.fn(async () => 'report.txt');
        hooks.set('dl', () => {
            stage('g2');
            emit('Browser.downloadWillBegin', begin('g2', 'report.txt', 'target-1'));
            emit('Browser.downloadProgress', { guid: 'g2', state: 'completed' });
        });
        const r = await browser.run(act({ hook: 'dl' }), opts('A', place));
        expect(place).toHaveBeenCalledTimes(1);
        expect(r.downloads).toEqual([{ name: 'report.txt', state: 'saved', savedAs: 'report.txt' }]);
        await browser.dispose();
    });

    it('같은 guid 가 두 채널로 겹쳐 와도 한 번만 옮기고 한 번만 싣는다', async () => {
        const { browser, hooks, emit } = setup();
        const place = jest.fn(async () => 'report.txt');
        hooks.set('dl', async () => {
            stage('g3');
            emit('Page.downloadWillBegin', begin('g3', 'report.txt', 'target-1'), 'session-target-1');
            emit('Browser.downloadWillBegin', begin('g3', 'other.txt', 'target-1'));
            emit('Page.downloadProgress', { guid: 'g3', state: 'completed' }, 'session-target-1');
            emit('Browser.downloadProgress', { guid: 'g3', state: 'completed' });
            await tick();
            emit('Browser.downloadProgress', { guid: 'g3', state: 'completed' });
        });
        const r = await browser.run(act({ hook: 'dl' }), opts('A', place));
        expect(place.mock.calls).toEqual([['report.txt', path.join(staging, 'g3')]]);
        expect(r.downloads).toEqual([{ name: 'report.txt', state: 'saved', savedAs: 'report.txt' }]);
        await browser.dispose();
    });

    it('귀속은 sessionId 가 먼저 — 두 작업이 함께 돌 때 이벤트를 보낸 탭의 작업에만 싣는다', async () => {
        const { browser, hooks, emit, release } = setup();
        const place = jest.fn(async () => 'f.txt');
        const a = browser.run(act({ gate: 'A' }), opts('A', place));
        await tick(); await tick();
        hooks.set('dl', () => {
            stage('g4');
            // frameId 는 어느 탭과도 다르다(붙은 탭 안의 하위 프레임 등) — sessionId 로 B 의 탭(target-2)이 정해진다
            emit('Page.downloadWillBegin', begin('g4', 'f.txt', 'frame-x'), 'session-target-2');
            emit('Page.downloadProgress', { guid: 'g4', state: 'completed' }, 'session-target-2');
        });
        const b = browser.run(act({ hook: 'dl' }), opts('B', place));
        const rb = await b;
        release('A');
        const ra = await a;
        expect(rb.downloads).toEqual([{ name: 'f.txt', state: 'saved', savedAs: 'f.txt' }]);
        expect(ra.downloads).toBeUndefined();
        await browser.dispose();
    });

    it('호출이 끝난 뒤 완료돼도 시작 때의 저장 함수로 옮기고, 끝난 결과는 그 작업의 다음 호출에 싣는다', async () => {
        const { browser, hooks, emit } = setup();
        const first = jest.fn(async () => 'first.txt');
        const second = jest.fn(async () => 'second.txt');
        hooks.set('dl', () => {
            stage('g5');
            emit('Page.downloadWillBegin', begin('g5', 'big.bin', 'target-1'), 'session-target-1');
        });
        const r1 = await browser.run(act({ hook: 'dl' }), opts('A', first));
        expect(r1.downloads).toEqual([{ name: 'big.bin', state: 'inProgress' }]);
        emit('Page.downloadProgress', { guid: 'g5', state: 'completed' }, 'session-target-1');
        const r2 = await browser.run(act(), opts('A', second));
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        expect(r2.downloads).toEqual([{ name: 'big.bin', state: 'saved', savedAs: 'first.txt' }]);
        const r3 = await browser.run(act(), opts('A', second));
        expect(r3.downloads).toBeUndefined();
        await browser.dispose();
    });

    it('canceled 는 대기 파일을 지우고, 가드 거절은 rejected·가드 문구로 싣는다(ok 는 그대로)', async () => {
        const { browser, hooks, emit } = setup();
        const place = jest.fn(async (name: string, staged: string) => {
            fs.rmSync(staged);
            throw new DownloadRejectedError(`git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ${name}`);
        });
        hooks.set('dl', async () => {
            stage('g6'); stage('g7');
            emit('Page.downloadWillBegin', begin('g6', 'x.zip', 'target-1'), 'session-target-1');
            emit('Page.downloadProgress', { guid: 'g6', state: 'canceled' }, 'session-target-1');
            emit('Page.downloadWillBegin', begin('g7', 'HEAD', 'target-1'), 'session-target-1');
            emit('Page.downloadProgress', { guid: 'g7', state: 'completed' }, 'session-target-1');
        });
        const r = await browser.run(act({ hook: 'dl' }), opts('A', place));
        expect(r.ok).toBe(true);
        expect(r.downloads).toEqual([
            { name: 'x.zip', state: 'canceled' },
            { name: 'HEAD', state: 'rejected', error: 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: HEAD' },
        ]);
        expect(place).toHaveBeenCalledTimes(1);
        expect(fs.readdirSync(staging)).toEqual([]);
        await browser.dispose();
    });

    it('다운로드 없는 호출은 downloads 필드가 없고 기다리지 않는다', async () => {
        const { browser } = setup();
        const t0 = Date.now();
        const r = await browser.run(act(), opts('A', async () => 'x'));
        expect(Date.now() - t0).toBeLessThan(150);
        expect('downloads' in r).toBe(false);
        await browser.dispose();
    });

    it('goto 가 다운로드로 끝나면(isDownload) 던지지 않고 ok·download:true·지금 탭 주소', async () => {
        const { browser } = setup({ errorText: 'net::ERR_ABORTED', isDownload: true }, false);
        const r = await browser.run({ actions: [{ type: 'goto', url: 'http://127.0.0.1:9/dl' }] }, opts('A', async () => 'x'));
        expect(r.results).toEqual([{ i: 0, type: 'goto', ok: true, download: true, url: 'about:blank' }]);
        expect(r.ok).toBe(true);
        await browser.dispose();
    });

    it('isDownload 없는 ERR_ABORTED 는 종전대로 이동 실패', async () => {
        const { browser } = setup({ errorText: 'net::ERR_ABORTED' }, false);
        const r = await browser.run({ actions: [{ type: 'goto', url: 'http://127.0.0.1:9/dl' }] }, opts('A', async () => 'x'));
        expect(r.results).toEqual([{ i: 0, type: 'goto', ok: false, error: '이동하지 못했습니다: net::ERR_ABORTED' }]);
        await browser.dispose();
    });

    it('대기 폴더는 Chrome 을 새로 띄울 때만 비운다 — 떠 있는 Chrome 에 붙을 때는 남긴다', async () => {
        fs.mkdirSync(staging, { recursive: true });
        stage('left');
        const attached = setup();
        await attached.browser.run(act(), opts('A', async () => 'x'));
        expect(fs.readdirSync(staging)).toEqual(['left']);
        await attached.browser.dispose();

        (chrome.readDevToolsEndpoint as jest.Mock).mockReturnValue(null);
        const proc = Object.assign(new EventEmitter(), { exitCode: 0, kill: () => true });
        (chrome.launchChrome as jest.Mock).mockResolvedValue({ wsUrl: 'ws://127.0.0.1:1/devtools/browser/y', proc });
        const launched = setup();
        await launched.browser.run(act(), opts('A', async () => 'x'));
        expect(fs.readdirSync(staging)).toEqual([]);
        await launched.browser.dispose();
    });
});
