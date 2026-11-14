/**
 * 브라우저 다운로드 저장(설계 B-2) — 대기 폴더의 `<guid>` 파일을 `write` 와 같은 가드로 판정해 연결 폴더로 옮긴다.
 * Chrome 없이 실제 fs 로 확인한다. 가드는 core.ts 의 `write` 와 같은 호출(safeFromAsync + assertGitPathAllowed)이다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DownloadRejectedError, placeDownload } from '../browser/download-place';
import { BROWSER_DOWNLOAD_NAME_TRIES } from '../constants';
import { LocalBrowser, type BrowserRunOptions } from '../browser/local-browser';
import { BridgeCore } from '../core';
import type { GitGuard } from '../git-trust';
import type { BridgeMsg, BridgeResult } from '../types';

jest.mock('../browser/chrome', () => ({ ...jest.requireActual('../browser/chrome'), findChrome: () => '/fake/chrome' }));

const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';
const REF = 'ref: refs/heads/main\n';

let tmp = '';
let root = '';
let staging = '';
let outside = '';
let seq = 0;

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-dlplace-')));
    root = path.join(tmp, 'root');
    staging = path.join(tmp, 'staging');
    outside = path.join(tmp, 'outside');
    for (const d of [root, staging, outside]) fs.mkdirSync(d);
});
afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

const guard = (): GitGuard => ({ root, dirs: [] });
/** 대기 폴더에 받은 파일 하나 — Chrome 이 `<guid>` 이름으로 둔 것과 같다. */
function staged(content: string): string {
    const p = path.join(staging, `guid-${++seq}`);
    fs.writeFileSync(p, content);
    return p;
}
const place = (name: string, from: string) => placeDownload(root, guard(), name, from);
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (p: string) => { try { fs.lstatSync(p); return true; } catch { return false; } };

describe('placeDownload — 다운로드를 write 와 같은 가드로 저장', () => {
    it('보통 이름은 그 이름으로 저장하고 대기 파일은 없어진다', async () => {
        const s = staged('hello');
        expect(await place('report.txt', s)).toBe('report.txt');
        expect(read('report.txt')).toBe('hello');
        expect(exists(s)).toBe(false);
    });

    it('이름이 겹치면 덮어쓰지 않고 " (1)" 꼴로 저장한다', async () => {
        fs.writeFileSync(path.join(root, 'report.txt'), 'old');
        fs.writeFileSync(path.join(root, 'report (1).txt'), 'old1');
        expect(await place('report.txt', staged('new'))).toBe('report (2).txt');
        expect(read('report.txt')).toBe('old');
        expect(read('report (1).txt')).toBe('old1');
        expect(read('report (2).txt')).toBe('new');
    });

    it('없는 HEAD 는 만들지 않는다(규칙 3) — 거절, 다른 이름을 찾지 않고 대기 파일 삭제', async () => {
        const s = staged(REF);
        await expect(place('HEAD', s)).rejects.toThrow(new DownloadRejectedError(`${DENIED}HEAD`));
        expect(fs.readdirSync(root)).toEqual([]);
        expect(exists(s)).toBe(false);
    });

    it('HEAD 가 이미 있으면 덮어쓰지 않고 "HEAD (1)" 로 저장한다', async () => {
        fs.writeFileSync(path.join(root, 'HEAD'), REF);
        expect(await place('HEAD', staged('x'))).toBe('HEAD (1)');
        expect(read('HEAD')).toBe(REF);
        expect(read('HEAD (1)')).toBe('x');
    });

    it('HEAD 가 있는 폴더의 config 는 거절(규칙 2), HEAD 없는 폴더의 config 는 저장', async () => {
        expect(await place('config', staged('a'))).toBe('config');
        fs.rmSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'HEAD'), REF);
        const s = staged('[core]\n');
        await expect(place('config', s)).rejects.toThrow(`${DENIED}config`);
        expect(exists(path.join(root, 'config'))).toBe(false);
        expect(exists(s)).toBe(false);
    });

    it('대상 자리의 심링크(폴더 밖·.git/config)를 따라 쓰지 않는다', async () => {
        fs.writeFileSync(path.join(outside, 'victim'), 'keep');
        fs.symlinkSync(path.join(outside, 'victim'), path.join(root, 'out.txt'));
        fs.mkdirSync(path.join(root, '.git'));
        fs.writeFileSync(path.join(root, '.git', 'config'), 'keep');
        fs.symlinkSync(path.join(root, '.git', 'config'), path.join(root, 'cfg.txt'));
        for (const name of ['out.txt', 'cfg.txt']) {
            const s = staged('evil');
            await expect(place(name, s)).rejects.toBeInstanceOf(DownloadRejectedError);
            expect(exists(s)).toBe(false);
        }
        expect(fs.readFileSync(path.join(outside, 'victim'), 'utf8')).toBe('keep');
        expect(fs.readFileSync(path.join(root, '.git', 'config'), 'utf8')).toBe('keep');
        expect(fs.readdirSync(root).sort()).toEqual(['.git', 'cfg.txt', 'out.txt']);
    });

    it('이름에 경로 글자·점 이름이 있으면 "download" 로 바꾼다', async () => {
        for (const name of ['../x', 'a/b', 'a\\b', 'x\0y', '', '.', '..']) {
            const saved = await place(name, staged(name));
            expect(saved).toMatch(/^download( \(\d+\))?$/);
        }
        expect(fs.readdirSync(root).sort()).toEqual(['download', ...[1, 2, 3, 4, 5, 6].map((n) => `download (${n})`)].sort());
        expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('link 가 EXDEV 면 copyFile 로 옮기고 대기 파일을 지운다', async () => {
        const link = jest.spyOn(fs.promises, 'link').mockRejectedValueOnce(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
        const s = staged('copied');
        expect(await place('report.txt', s)).toBe('report.txt');
        expect(link).toHaveBeenCalledTimes(1);
        expect(read('report.txt')).toBe('copied');
        expect(exists(s)).toBe(false);
    });

    it('copyFile 갈래도 덮어쓰지 않는다 — 대상이 있으면 다음 후보', async () => {
        jest.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
        fs.writeFileSync(path.join(root, 'report.txt'), 'old');
        const s = staged('copied');
        expect(await place('report.txt', s)).toBe('report (1).txt');
        expect(read('report.txt')).toBe('old');
        expect(read('report (1).txt')).toBe('copied');
        expect(exists(s)).toBe(false);
    });

    it('후보를 모두 쓰면 저장하지 않는다 — 가드 거절이 아닌 오류(결과에는 failed), 대기 파일 삭제', async () => {
        fs.writeFileSync(path.join(root, 'report.txt'), 'old');
        for (let n = 1; n < BROWSER_DOWNLOAD_NAME_TRIES; n++) fs.writeFileSync(path.join(root, `report (${n}).txt`), 'old');
        const s = staged('new');
        const err = await place('report.txt', s).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(DownloadRejectedError);
        expect((err as Error).message).toBe('같은 이름의 파일이 너무 많아 저장하지 않았습니다: report.txt');
        expect(fs.readdirSync(root)).toHaveLength(BROWSER_DOWNLOAD_NAME_TRIES);
        expect(exists(s)).toBe(false);
    });
});

describe('코어 경유 — browser 갈래가 넘기는 placeDownload 는 실행 폴더·git 가드에 묶인다', () => {
    it('HEAD 는 거절, 보통 이름은 실행 폴더에 저장', async () => {
        let captured: BrowserRunOptions | undefined;
        jest.spyOn(LocalBrowser.prototype, 'run').mockImplementation(async (_spec, o) => { captured = o; return { ok: true, results: [] }; });
        fs.mkdirSync(path.join(root, 'sub'));
        const core = new BridgeCore({ folder: root, confirm: async () => 'no', sandboxProfileDir: os.tmpdir(), browserProfileDir: path.join(tmp, 'profile') });
        core.prepare();
        const r = await new Promise<BridgeResult>((resolve) => { void core.handleExec({ kind: 'browser', folder: 'sub', actions: [] } as BridgeMsg, resolve); });
        expect(r.ok).toBe(true);
        expect(captured?.placeDownload).toBeDefined();
        const s1 = staged(REF);
        await expect(captured!.placeDownload!('HEAD', s1)).rejects.toThrow(new DownloadRejectedError(`${DENIED}HEAD`));
        expect(await captured!.placeDownload!('report.txt', staged('ok'))).toBe('report.txt');
        expect(read('sub/report.txt')).toBe('ok');
        expect(fs.readdirSync(path.join(root, 'sub'))).toEqual(['report.txt']);
    });
});
