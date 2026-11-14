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
    /** 이 behavior 의 Browser.setDownloadBehavior 는 거절한다 */
    const failBehaviors = new Set<string>();
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
            if (method === 'Browser.setDownloadBehavior' && failBehaviors.has(String(params.behavior))) throw new Error('CDP 설정 거절');
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
    return { cdp: cdp as unknown as CdpClient, sent, emit, failBehaviors };
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
    const runAction = jest.spyOn(LocalBrowser.prototype as never, 'runAction' as never);
    if (mockActions) {
        runAction.mockImplementation((async (_c: unknown, _t: unknown, a: { type?: unknown; hook?: string; gate?: string }, i: number) => {
            if (a.gate) await gate(a.gate);
            if (a.hook) await hooks.get(a.hook)!();
            return { i, type: a.type, ok: true };
        }) as never);
    }
    const browser = LocalBrowser.forProfile(profile);
    return { browser, ...f, hooks, runAction, release: (name: string) => { gate(name); open.get(name)!(); } };
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

// 설계 B-8 — Chrome 이 연결 폴더에 직접 쓰는 상태를 없앤다: ② 설정이 없을 때(기본값)도 대기 폴더 ③ 설정이 실패하면 실행하지 않는다.
describe('LocalBrowser 다운로드 — 기본값·설정 실패(B-8)', () => {
    const prefsPath = () => path.join(profile, 'Default', 'Preferences');
    const prefs = () => JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Record<string, unknown>;
    /** Chrome 을 새로 띄우는 길(떠 있는 Chrome 없음) — launchChrome 이 불렸을 때의 Preferences 를 기록한다 */
    function launchMode() {
        (chrome.readDevToolsEndpoint as jest.Mock).mockReturnValue(null);
        const atLaunch: Array<string | null> = [];
        const proc = Object.assign(new EventEmitter(), { exitCode: 0, kill: () => true });
        (chrome.launchChrome as jest.Mock).mockReset().mockImplementation(async () => {
            atLaunch.push(fs.existsSync(prefsPath()) ? fs.readFileSync(prefsPath(), 'utf8') : null);
            return { wsUrl: 'ws://127.0.0.1:1/devtools/browser/y', proc };
        });
        return atLaunch;
    }
    const DL = { default_directory: '', prompt_for_download: false };

    it('새로 띄우기 전 — Preferences 가 없으면 기본 다운로드 폴더를 대기 폴더로 둔 새 파일(대기 폴더도 만든다)', async () => {
        const atLaunch = launchMode();
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(atLaunch).toHaveLength(1);
        expect(JSON.parse(atLaunch[0]!)).toEqual({ download: { ...DL, default_directory: staging } });
        expect(fs.statSync(staging).isDirectory()).toBe(true);
        await browser.dispose();
    });

    it('있으면 JSON 병합 — 다른 키는 그대로, 두 키만 바꾼다', async () => {
        fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
        fs.writeFileSync(prefsPath(), JSON.stringify({ profile: { name: 'p' }, download: { default_directory: '/elsewhere', prompt_for_download: true, directory_upgrade: true } }));
        launchMode();
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(prefs()).toEqual({ profile: { name: 'p' }, download: { default_directory: staging, prompt_for_download: false, directory_upgrade: true } });
        await browser.dispose();
    });

    it('깨진 JSON 이면 두 키만 든 새 파일', async () => {
        fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
        fs.writeFileSync(prefsPath(), '{"download": [broken');
        launchMode();
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(prefs()).toEqual({ download: { ...DL, default_directory: staging } });
        await browser.dispose();
    });

    // B-9(Fable r2 D1) — 같은 폴더 임시 파일 + rename. 새 파일 갈래는 없음·파싱 실패·객체 아님일 때만, 그 밖의 읽기 실패는 띄우지 않는다.
    const leftovers = () => fs.readdirSync(path.dirname(prefsPath())).filter((n) => n !== 'Preferences');

    it('기존 파일을 자르지 않고 임시 파일 + rename 으로 바꿔 놓는다 — 임시 파일이 남지 않는다', async () => {
        fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
        fs.writeFileSync(prefsPath(), JSON.stringify({ profile: { name: 'p' } }));
        const before = fs.statSync(prefsPath()).ino;
        launchMode();
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(fs.statSync(prefsPath()).ino).not.toBe(before);
        expect(prefs()).toEqual({ profile: { name: 'p' }, download: { ...DL, default_directory: staging } });
        expect(leftovers()).toEqual([]);
        await browser.dispose();
    });

    // r3 E1 — Chrome 이 0600 으로 두는 Preferences 가 rename 뒤 넓어지지 않게(기존·새 파일 모두 0600).
    (process.platform === 'win32' ? it.skip : it)('Preferences 권한은 기동 뒤에도 0600 — 기존 0600 파일·새로 만든 파일 모두', async () => {
        fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
        fs.writeFileSync(prefsPath(), JSON.stringify({ profile: { name: 'p' } }), { mode: 0o600 });
        fs.chmodSync(prefsPath(), 0o600);
        launchMode();
        const first = setup();
        await first.browser.run(act(), opts('A', async () => 'x'));
        expect(fs.statSync(prefsPath()).mode & 0o777).toBe(0o600);
        await first.browser.dispose();

        fs.rmSync(prefsPath());
        launchMode();
        const second = setup();
        await second.browser.run(act(), opts('A', async () => 'x'));
        expect(fs.statSync(prefsPath()).mode & 0o777).toBe(0o600);
        await second.browser.dispose();
    });

    it('JSON 이 객체가 아니면 두 키만 든 새 파일', async () => {
        fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
        fs.writeFileSync(prefsPath(), '[1,2]');
        launchMode();
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(prefs()).toEqual({ download: { ...DL, default_directory: staging } });
        await browser.dispose();
    });

    it.each([
        ['Preferences 자리가 디렉터리(EISDIR)', () => { fs.mkdirSync(path.join(prefsPath(), 'keep'), { recursive: true }); }],
        ['Preferences 를 읽을 수 없음(EACCES, 쓰기만 가능)', () => {
            fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
            fs.writeFileSync(prefsPath(), JSON.stringify({ profile: { name: 'p' } }), { mode: 0o200 });
        }],
    ])('그 밖의 읽기 실패 — %s 면 띄우지 않고 기존 내용 그대로, 임시 파일 없음', async (_label, arrange) => {
        arrange();
        launchMode();
        const { browser, runAction } = setup();
        const r = await browser.run(act(), opts('A', async () => 'x'));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/다운로드 기본 폴더/);
        expect(chrome.launchChrome).not.toHaveBeenCalled();
        expect(runAction).not.toHaveBeenCalled();
        if (fs.statSync(prefsPath()).isDirectory()) {
            expect(fs.readdirSync(prefsPath())).toEqual(['keep']);
        } else {
            fs.chmodSync(prefsPath(), 0o600);
            expect(prefs()).toEqual({ profile: { name: 'p' } });
        }
        expect(leftovers()).toEqual([]);
        await browser.dispose();
    });

    it('쓰지 못하면 Chrome 을 띄우지 않고 오류 — 액션 0개', async () => {
        fs.mkdirSync(profile, { recursive: true });
        fs.writeFileSync(path.join(profile, 'Default'), 'not a dir'); // Default/Preferences 를 만들 수 없다
        launchMode();
        const { browser, runAction } = setup();
        const r = await browser.run(act(), opts('A', async () => 'x'));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/다운로드 기본 폴더/);
        expect(chrome.launchChrome).not.toHaveBeenCalled();
        expect(runAction).not.toHaveBeenCalled();
        await browser.dispose();
    });

    it('떠 있는 Chrome 에 붙을 때는 Preferences 를 쓰지 않는다', async () => {
        const { browser } = setup();
        await browser.run(act(), opts('A', async () => 'x'));
        expect(fs.existsSync(prefsPath())).toBe(false);
        await browser.dispose();
    });

    it.each([['allowAndName', true], ['deny', false]])('%s 설정이 거절되면 오류로 끝내고 액션을 하나도 실행하지 않는다 — 저장 함수도 그대로', async (behavior, withPlace) => {
        const { browser, hooks, emit, failBehaviors, runAction } = setup();
        const first = jest.fn(async () => 'first.txt');
        await browser.run(act(), opts('A', first));
        runAction.mockClear();
        failBehaviors.add(behavior as string);
        const second = jest.fn(async () => 'second.txt');
        hooks.set('dl', () => undefined);
        const r = await browser.run(act({ hook: 'dl' }), opts('A', withPlace ? second : undefined));
        expect(r.ok).toBe(false);
        expect(r.results).toEqual([]);
        expect(r.error).toMatch(/CDP 설정 거절/);
        expect(runAction).not.toHaveBeenCalled();
        // 실패한 설정의 저장 함수는 쓰지 않는다 — 그 뒤 시작한 다운로드는 마지막으로 설정에 성공한 함수로 간다
        stage('g8');
        emit('Page.downloadWillBegin', begin('g8', 'f.txt', 'target-1'), 'session-target-1');
        emit('Page.downloadProgress', { guid: 'g8', state: 'completed' }, 'session-target-1');
        await tick();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        await browser.dispose();
    });
});

describe('LocalBrowser 다운로드 — 생명주기(B-8 Low)', () => {
    const moveTo = (saved: string[]) => jest.fn(async (name: string, staged: string) => { fs.rmSync(staged); saved.push(name); return name; });

    it('이미 inProgress 로 실은 다운로드는 다음 호출에서 다시 기다리지 않는다', async () => {
        const { browser, hooks, emit } = setup();
        hooks.set('dl', () => {
            stage('g9');
            emit('Page.downloadWillBegin', begin('g9', 'big.bin', 'target-1'), 'session-target-1');
        });
        const r1 = await browser.run(act({ hook: 'dl' }), opts('A', async () => 'x'));
        expect(r1.downloads).toEqual([{ name: 'big.bin', state: 'inProgress' }]);
        const t0 = Date.now();
        const r2 = await browser.run(act(), opts('A', async () => 'x'));
        expect(Date.now() - t0).toBeLessThan(100);
        expect(r2.downloads).toBeUndefined();
        await browser.dispose();
    });

    it('연결을 새로 열면 옛 연결의 받는 중 기록은 failed 로 끝내고 대기 파일을 지운다 — 그 작업의 다음 결과에 한 번', async () => {
        const { browser, hooks, emit, cdp } = setup();
        hooks.set('dl', () => {
            stage('g10');
            emit('Page.downloadWillBegin', begin('g10', 'big.bin', 'target-1'), 'session-target-1');
        });
        const r1 = await browser.run(act({ hook: 'dl' }), opts('A', async () => 'x'));
        expect(r1.downloads).toEqual([{ name: 'big.bin', state: 'inProgress' }]);
        (cdp as unknown as { isOpen: boolean }).isOpen = false;
        jest.spyOn(CdpClient, 'connect').mockResolvedValue(fakeCdp().cdp);
        const r2 = await browser.run(act(), opts('A', async () => 'x'));
        expect(r2.downloads).toEqual([{ name: 'big.bin', state: 'failed', error: '브라우저 연결이 끊겨 받지 못했습니다' }]);
        expect(fs.readdirSync(staging)).toEqual([]);
        const r3 = await browser.run(act(), opts('A', async () => 'x'));
        expect(r3.downloads).toBeUndefined();
        await browser.dispose();
    });

    it('closeTask 뒤에 완료돼도 옮기기는 계속하고, 그 작업에 보고하지 않는다', async () => {
        const { browser, hooks, emit } = setup();
        const saved: string[] = [];
        hooks.set('dl', () => {
            stage('g11');
            emit('Page.downloadWillBegin', begin('g11', 'late.txt', 'target-1'), 'session-target-1');
        });
        await browser.run(act({ hook: 'dl' }), opts('A', moveTo(saved)));
        await browser.closeTask('A');
        emit('Page.downloadProgress', { guid: 'g11', state: 'completed' }, 'session-target-1');
        await tick();
        expect(saved).toEqual(['late.txt']);
        expect(fs.readdirSync(staging)).toEqual([]);
        const r = await browser.run(act(), opts('A', async () => 'x'));
        expect(r.downloads).toBeUndefined();
        await browser.dispose();
    });

    it('시작 때 저장 함수가 없던 다운로드는 완료돼도 옮기지 않는다 — failed, 대기 파일 삭제', async () => {
        const { browser, hooks, emit } = setup();
        fs.mkdirSync(staging, { recursive: true });
        hooks.set('dl', () => {
            stage('g12');
            emit('Page.downloadWillBegin', begin('g12', 'f.txt', 'target-1'), 'session-target-1');
            emit('Page.downloadProgress', { guid: 'g12', state: 'completed' }, 'session-target-1');
        });
        const r = await browser.run(act({ hook: 'dl' }), opts('A'));
        expect(r.downloads).toEqual([{ name: 'f.txt', state: 'failed', error: '다운로드를 저장할 곳이 없습니다' }]);
        expect(fs.readdirSync(staging)).toEqual([]);
        await browser.dispose();
    });
});
