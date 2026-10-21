import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startLiveTerminal, type LiveTerminalState } from './live-terminal';
import { LIVE_VIEW } from '../../config/agent-task-live-view';

describe('live-terminal — 실행 중 터미널 출력 기록', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'omk-live-term-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    const file = () => join(dir, LIVE_VIEW.TERMINAL_FILE);
    const read = (): LiveTerminalState => JSON.parse(readFileSync(file(), 'utf8')) as LiveTerminalState;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function waitForFile(): Promise<void> {
        for (let i = 0; i < 100 && !existsSync(file()); i++) await sleep(10);
    }

    it('시작하면 command·startedAt 이 담긴 파일을 쓴다', async () => {
        startLiveTerminal(dir, 'echo hi', { now: () => 1000 });
        await waitForFile();
        expect(read()).toEqual({ command: 'echo hi', output: '', truncatedHead: false, startedAt: 1000, endedAt: null, exitCode: null });
    });

    it('tailChars 를 넘으면 끝부분만 남기고 truncatedHead 가 true', async () => {
        const t = startLiveTerminal(dir, 'x', { tailChars: 10 });
        t.append('0123456789abc');
        await t.finish(0);
        const s = read();
        expect(s.output).toBe('3456789abc');
        expect(s.truncatedHead).toBe(true);
    });

    it('writeMs 안의 append 는 파일을 다시 쓰지 않고 finish 는 바로 쓴다', async () => {
        let now = 0;
        const t = startLiveTerminal(dir, 'x', { now: () => now, writeMs: 500 });
        await waitForFile();
        now = 100;
        t.append('a');
        await sleep(50);
        expect(read().output).toBe('');
        now = 600;
        t.append('b');
        await sleep(50);
        expect(read().output).toBe('ab');
        now = 700;
        t.append('c');
        await t.finish(0);
        expect(read().output).toBe('abc');
    });

    it('finish 는 endedAt·exitCode 를 남긴다', async () => {
        let now = 10;
        const t = startLiveTerminal(dir, 'false', { now: () => now });
        now = 42;
        await t.finish(1);
        const s = read();
        expect(s.startedAt).toBe(10);
        expect(s.endedAt).toBe(42);
        expect(s.exitCode).toBe(1);
        expect(existsSync(`${file()}.tmp`)).toBe(false);
    });

    it('작업 폴더가 사라져도 throw 하지 않는다', async () => {
        const gone = join(dir, 'gone');
        const t = startLiveTerminal(gone, 'x', { writeMs: 0 });
        expect(() => t.append('a')).not.toThrow();
        await expect(t.finish(0)).resolves.toBeUndefined();
        expect(existsSync(gone)).toBe(false);
    });
});
