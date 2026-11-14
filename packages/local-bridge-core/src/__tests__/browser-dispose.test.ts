/**
 * LocalBrowser.dispose — 띄우는 중의 정리(PR-1.7 리뷰 r1 M-1, Rust `tests/browser_dispose.rs` 와 같은 동작).
 * 정리는 진행 중인 기동을 끊어 띄우던 자식을 끄고, 정리 뒤에 온 요청은 Chrome 을 띄우지 않는다.
 * 주소 파일을 쓰지 않고 `exec sleep` 하는 가짜 실행 파일(OMK_BRIDGE_CHROME)로 확인한다(Chrome 불필요).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BROWSER_DISPOSED_ERROR, LocalBrowser, type BrowserRunOptions } from '../browser/local-browser';

const posix = process.platform === 'win32' ? describe.skip : describe;

const alive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch { return false; }
};

async function waitFor(f: () => boolean, ms = 8000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (f()) return true;
        await new Promise((r) => setTimeout(r, 20));
    }
    return f();
}

posix('LocalBrowser.dispose — 띄우는 중의 정리(M-1)', () => {
    let tmp = '';
    let pidsFile = '';
    const saved = process.env.OMK_BRIDGE_CHROME;
    const pids = (): number[] => (fs.existsSync(pidsFile) ? fs.readFileSync(pidsFile, 'utf8') : '')
        .split('\n').filter(Boolean).map(Number);
    const spec = { actions: [{ type: 'wait', ms: 0 }], sitePolicy: { allow: [], deny: [] } };
    const opts = (taskId: string): BrowserRunOptions => ({ taskId, saveFile: async () => undefined });

    beforeEach(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-dispose-')));
        pidsFile = path.join(tmp, 'pids');
        const bin = path.join(tmp, 'fake-chrome');
        fs.writeFileSync(bin, ['#!/bin/sh', `echo $$ >> '${pidsFile}'`, 'exec sleep 60'].join('\n'), { mode: 0o755 });
        process.env.OMK_BRIDGE_CHROME = bin;
    });
    afterEach(() => {
        for (const p of pids()) { try { process.kill(p, 'SIGKILL'); } catch { /* 이미 없음 */ } }
        if (saved === undefined) delete process.env.OMK_BRIDGE_CHROME; else process.env.OMK_BRIDGE_CHROME = saved;
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('띄우는 중이면 기동을 끊어 자식을 끄고, 정리 뒤 요청은 띄우지 않는다', async () => {
        const profile = path.join(tmp, 'profile');
        const browser = LocalBrowser.forProfile(profile);
        const running = browser.run(spec, opts('A'));
        expect(await waitFor(() => pids().length === 1 && alive(pids()[0]))).toBe(true);
        const t0 = Date.now();
        await browser.dispose();
        expect(Date.now() - t0).toBeLessThan(1500);
        expect((await running).error).toBe(BROWSER_DISPOSED_ERROR);
        const [pid] = pids();
        expect(await waitFor(() => !alive(pid), 3000)).toBe(true);
        // 분리된 요청이 쥔 같은 인스턴스 — 띄우지 않는다
        expect((await browser.run(spec, opts('B'))).error).toBe(BROWSER_DISPOSED_ERROR);
        expect(pids()).toHaveLength(1);
        await browser.dispose();
    }, 15000);
});
