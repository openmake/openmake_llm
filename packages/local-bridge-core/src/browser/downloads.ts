/**
 * 브라우저 다운로드 추적(설계 B-3·B-4·B-7) — 연결(CdpClient) 단위로 한 번 구독한다.
 *
 * Chrome 은 `Browser.setDownloadBehavior({behavior:'allowAndName'})` 로 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로만 받는다.
 * 이벤트는 두 채널로 온다(Chrome 157 실측): 브리지가 붙은 탭(Page.enable)의 다운로드는 `Page.downloadWillBegin`·
 * `Page.downloadProgress` 가 그 탭의 sessionId 로, 붙지 않은 프레임(페이지가 연 새 창)은 `Browser.*` 가 sessionId 없이.
 * 넷을 모두 구독하고 guid 로 하나로 합친다 — 같은 guid 의 시작은 처음 것만, 완료 처리(옮기기)는 guid 당 한 번.
 * 시작 순간의 저장 함수와 귀속 작업을 guid 에 묶는다 — 완료가 호출이 끝난 뒤에 와도 묶인 함수로 옮긴다.
 * CDP 설정은 연결에 묶여 연결이 닫히면 Chrome 기본값으로 돌아간다 — 그래서 Chrome 을 새로 띄울 때 프로필의 기본 다운로드 폴더도
 * 대기 폴더로 맞추고(설정이 풀린 틈에 받은 파일은 누구도 옮기지 않고 다음 기동이 지운다), 설정이 실패하면 호출을 실행하지 않는다(설계 B-8).
 */
import * as fs from 'fs';
import * as path from 'path';
import { BROWSER_DOWNLOAD_WAIT_MS } from '../constants';
import type { CdpClient } from './cdp';
import { DownloadRejectedError } from './download-place';
import { str, type BrowserRunResult, type DownloadReport, type PlaceDownload, type Tab } from './local-browser-defs';

const fsp = fs.promises;
/** 프로필 안 Chrome 설정 파일 — 기본 다운로드 폴더(download.default_directory)가 여기 있다 */
const PREFERENCES_FILE = path.join('Default', 'Preferences');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Download {
    /** 귀속 작업 — 없으면 보고하지 않는다(가드·옮기기는 그대로 한다) */
    task: string | undefined;
    place: PlaceDownload | undefined;
    report: DownloadReport;
    /** 마지막으로 결과에 실은 상태 — 같은 상태를 두 번 싣지 않는다 */
    reported?: DownloadReport['state'];
    /** 완료·취소 처리를 시작했다 — guid 당 한 번 */
    finishing: boolean;
    done: Promise<void>;
    finish: () => void;
}

/** 귀속 — (sessionId, frameId) → 작업 키. 정하지 못하면 undefined. */
export type AttributeDownload = (sessionId: string | undefined, frameId: string) => string | undefined;

/**
 * 다운로드의 귀속 작업(설계 B-7) — ① 이벤트의 sessionId 가 작업 탭의 것 ② frameId 가 작업 탭의 targetId ③ 그 순간 실행 중인 작업이
 * 하나면 그 작업 ④ 없음. 페이지가 연 새 창(붙지 않은 프레임)의 다운로드는 ②③으로 간다.
 */
export function downloadTaskOf(tabs: Array<[string, Tab]>, isRunning: (key: string) => boolean, sessionId: string | undefined, frameId: string): string | undefined {
    const running = tabs.filter(([k]) => isRunning(k));
    return (sessionId !== undefined ? tabs.find(([, t]) => t.sessionId === sessionId)?.[0] : undefined)
        ?? tabs.find(([, t]) => t.targetId === frameId)?.[0]
        ?? (running.length === 1 ? running[0][0] : undefined);
}

export class DownloadTracker {
    /** 지금 시작하는 다운로드를 옮길 저장 함수 — 가장 최근 호출이 설정한 것 */
    place: PlaceDownload | undefined;
    private readonly items = new Map<string, Download>();

    constructor(readonly dir: string, private readonly attribute: AttributeDownload) {}

    /**
     * 호출마다 — 저장 함수가 있으면 대기 폴더(0700)에 guid 이름으로만 받게(allowAndName), 없으면 받지 않게(deny) 설정한다.
     * 저장 이름은 완료 뒤 저장 함수가 정한다. 설정이 거절·시간 초과면 던진다 — 호출부는 액션을 하나도 실행하지 않는다.
     * 저장 함수는 설정에 성공한 뒤에만 바꾼다.
     */
    async configure(cdp: CdpClient, place: PlaceDownload | undefined): Promise<void> {
        if (place) await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
        try {
            await cdp.send('Browser.setDownloadBehavior', place
                ? { behavior: 'allowAndName', downloadPath: this.dir, eventsEnabled: true }
                : { behavior: 'deny' });
        } catch (e) {
            throw new Error(`다운로드 설정에 실패해 실행하지 않았습니다: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.place = place;
    }

    /**
     * Chrome 을 새로 띄우기 직전 — 프로필의 기본 다운로드 폴더를 대기 폴더로, 저장 위치 묻기를 끄게 맞춘다(CDP 설정이 없는 상태).
     * 파일이 있으면 그 두 키만 바꾸고(다른 키 보존), 없거나 깨졌으면 두 키만 든 새 파일. 쓰지 못하면 던진다 — 호출부는 Chrome 을 띄우지 않는다.
     */
    async setLaunchDefaults(profileDir: string): Promise<void> {
        const file = path.join(profileDir, PREFERENCES_FILE);
        try {
            await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 }); // 기본 폴더가 없으면 Chrome 이 다른 폴더로 대신 받을 수 있다
            await fsp.mkdir(path.dirname(file), { recursive: true });
            let prefs: Record<string, unknown> = {};
            try {
                const parsed: unknown = JSON.parse(await fsp.readFile(file, 'utf8'));
                if (isObject(parsed)) prefs = parsed;
            } catch { /* 없음·깨짐 — 두 키만 든 새 파일 */ }
            const download = isObject(prefs.download) ? prefs.download : {};
            await fsp.writeFile(file, JSON.stringify({ ...prefs, download: { ...download, default_directory: this.dir, prompt_for_download: false } }));
        } catch (e) {
            throw new Error(`Chrome 다운로드 기본 폴더를 설정하지 못해 브라우저를 띄우지 않았습니다: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** 대기 폴더를 비운다 — Chrome 을 새로 띄울 때만(이전 실행이 남긴 미완료분). */
    async clear(): Promise<void> {
        await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    }

    /** 연결을 새로 열 때 — 옛 연결의 받는 중 기록은 완료 이벤트가 더는 오지 않는다. failed 로 끝내고 대기 파일을 지운다(그 작업의 다음 결과에 한 번). */
    async abandon(): Promise<void> {
        for (const [guid, d] of this.items) {
            if (d.finishing || d.report.state !== 'inProgress') continue;
            d.finishing = true;
            await fsp.unlink(path.join(this.dir, guid)).catch(() => undefined);
            d.report = { name: d.report.name, state: 'failed', error: '브라우저 연결이 끊겨 받지 못했습니다' };
            d.finish();
            if (d.task === undefined) this.items.delete(guid);
        }
    }

    /** 연결마다 한 번 — 두 채널의 시작·진행 이벤트를 구독한다. */
    listen(cdp: CdpClient): void {
        for (const ch of ['Page', 'Browser']) {
            cdp.on(`${ch}.downloadWillBegin`, (p, sessionId) => this.begin(p, sessionId));
            cdp.on(`${ch}.downloadProgress`, (p) => this.progress(p));
        }
    }

    /** 작업이 끝났다 — 끝난 기록은 버리고, 받는 중인 것은 귀속만 푼다(옮기기는 그대로). */
    forget(task: string): void {
        for (const [guid, d] of this.items) {
            if (d.task !== task) continue;
            if (d.report.state === 'inProgress') d.task = undefined; else this.items.delete(guid);
        }
    }

    /** 결과에 이 작업의 아직 보고하지 않은 다운로드를 싣는다 — 없으면 필드를 싣지 않는다. ok 는 바꾸지 않는다(다운로드 거절은 액션 실패가 아니다). */
    async report(task: string, r: BrowserRunResult): Promise<BrowserRunResult> {
        const downloads = await this.collect(task, BROWSER_DOWNLOAD_WAIT_MS);
        return downloads.length ? { ...r, downloads } : r;
    }

    /**
     * 이 작업의 아직 보고하지 않은 다운로드 — 받는 중인 것이 있으면 waitMs 까지 기다린다. 넘으면 inProgress 로 싣고,
     * 끝난 결과는 다음 호출에 싣는다(이미 inProgress 로 실은 것은 다시 기다리지 않는다). 끝난 상태를 실은 기록은 버린다.
     */
    private async collect(task: string, waitMs: number): Promise<DownloadReport[]> {
        const mine = () => [...this.items].filter(([, d]) => d.task === task);
        const pending = mine().filter(([, d]) => d.report.state === 'inProgress' && d.reported !== 'inProgress').map(([, d]) => d.done);
        if (pending.length) {
            let timer: NodeJS.Timeout | undefined;
            await Promise.race([Promise.all(pending), new Promise((r) => { timer = setTimeout(r, waitMs); })]);
            clearTimeout(timer);
        }
        const out: DownloadReport[] = [];
        for (const [guid, d] of mine()) {
            if (d.reported === d.report.state) continue;
            out.push({ ...d.report });
            d.reported = d.report.state;
            if (d.report.state !== 'inProgress') this.items.delete(guid);
        }
        return out;
    }

    private begin(p: Record<string, unknown>, sessionId: string | undefined): void {
        const guid = str(p.guid);
        if (!guid || this.items.has(guid)) return;
        let finish!: () => void;
        const done = new Promise<void>((r) => { finish = r; });
        this.items.set(guid, {
            task: this.attribute(sessionId, str(p.frameId)), place: this.place,
            report: { name: str(p.suggestedFilename), state: 'inProgress' }, finishing: false, done, finish,
        });
    }

    private progress(p: Record<string, unknown>): void {
        const guid = str(p.guid);
        const d = this.items.get(guid);
        if (!d || d.finishing || (p.state !== 'completed' && p.state !== 'canceled')) return;
        d.finishing = true;
        void this.finishDownload(guid, d, p.state === 'completed');
    }

    private async finishDownload(guid: string, d: Download, completed: boolean): Promise<void> {
        const staged = path.join(this.dir, guid);
        const name = d.report.name;
        if (!completed) {
            await fsp.unlink(staged).catch(() => undefined);
            d.report = { name, state: 'canceled' };
        } else {
            try {
                if (!d.place) throw new Error('다운로드를 저장할 곳이 없습니다');
                d.report = { name, state: 'saved', savedAs: await d.place(name, staged) };
            } catch (e) {
                await fsp.unlink(staged).catch(() => undefined);
                d.report = { name, state: e instanceof DownloadRejectedError ? 'rejected' : 'failed', error: e instanceof Error ? e.message : String(e) };
            }
        }
        d.finish();
        if (d.task === undefined) this.items.delete(guid);
    }
}
