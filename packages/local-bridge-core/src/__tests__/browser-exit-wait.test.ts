/** killAndWaitSync — 끝났는지 확인하지 못하면(ps 실행 실패·빈 출력) 끝난 것으로 보지 않는다(리뷰 r4). */
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'child_process';
import { killAndWaitSync } from '../browser/chrome';

// jest 샌드박스의 process.env 는 자식 실행에 쓰이지 않아 PATH 로 ps 를 바꿀 수 없다 — spawnSync 결과를 바꿔 끼운다.
jest.mock('child_process', () => {
    const actual = jest.requireActual<typeof import('child_process')>('child_process');
    return { ...actual, spawnSync: jest.fn(actual.spawnSync) };
});
const spawnSyncMock = spawnSync as unknown as jest.Mock;

const posix = process.platform === 'win32' ? describe.skip : describe;

posix('killAndWaitSync 종료 확인', () => {
    const fakePs = (r: Partial<SpawnSyncReturns<string>>) =>
        spawnSyncMock.mockReturnValue({ pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, ...r });
    let proc: ChildProcess | undefined;
    afterEach(() => {
        spawnSyncMock.mockReset();
        spawnSyncMock.mockImplementation(jest.requireActual<typeof import('child_process')>('child_process').spawnSync);
        try { proc?.kill('SIGKILL'); } catch { /* gone */ }
    });
    const start = (): ChildProcess => { proc = spawn('/bin/sleep', ['60'], { stdio: 'ignore' }); return proc; };

    it('ps 가 정상이면 끈 자식(거두기 전 좀비)을 끝난 것으로 본다', () => {
        expect(killAndWaitSync(start(), 2000)).toBe(true);
    });

    it('ps 를 실행하지 못하면 끝났다고 하지 않는다', () => {
        const p = start();
        fakePs({ error: Object.assign(new Error('spawnSync ps ENOENT'), { code: 'ENOENT' }) });
        expect(killAndWaitSync(p, 100)).toBe(false);
    });

    it('ps 가 실패하고 빈 출력을 내면 끝났다고 하지 않는다', () => {
        const p = start();
        fakePs({ status: 1 });
        expect(killAndWaitSync(p, 100)).toBe(false);
    });
});
