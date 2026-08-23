/**
 * 파일 kind FS 타임아웃 가드 — 외장 볼륨 TCC 권한 미결로 readdir 가 open 에서 영구
 * 블록되던 실사례(2026-08-23) 회귀. sync 시절엔 이벤트 루프가 굶어 pong 이 끊기고
 * 헬퍼의 모든 루트 연결이 하트비트로 강제 종료됐다 — async+타임아웃 전환으로
 * ① 블록된 요청이 오류로 해소되고 ② 그동안 다른 요청이 계속 처리됨을 검증한다.
 */
process.env.OMK_BRIDGE_FS_TIMEOUT_MS = '300'; // constants 가 import 시점에 읽으므로 require 전에 설정

const fs = require('fs') as typeof import('fs');
const os = require('os') as typeof import('os');
const path = require('path') as typeof import('path');
const { BridgeCore } = require('../core') as typeof import('../core');
import type { BridgeMsg, BridgeResult } from '../types';

type Core = InstanceType<typeof BridgeCore>;

function run(core: Core, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve, reject) => {
        core.handleExec(m, resolve).catch(reject);
    });
}

describe('FS 타임아웃 가드 (FS_OP_TIMEOUT_MS)', () => {
    let base: string;
    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-fsto-'));
        fs.writeFileSync(path.join(base, 'hello.txt'), 'world');
        fs.mkdirSync(path.join(base, 'sub'));
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(base, { recursive: true, force: true });
    });

    function makeCore(): Core {
        return new BridgeCore({
            folder: base,
            confirm: async () => 'yes',
            sandboxProfileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'omk-prof-')),
        });
    }

    it('블록된 folders 는 타임아웃 오류로 해소되고, 그동안 다른 요청은 계속 처리된다', async () => {
        const core = makeCore();
        // readdir 영구 블록 시뮬레이션 (TCC 미결 시 open$NOCANCEL 영구 대기와 등가)
        jest.spyOn(fs.promises, 'readdir').mockImplementation(() => new Promise(() => { /* never */ }));
        const blocked = run(core, { kind: 'folders', path: '.' });
        blocked.catch(() => { /* 아래에서 assert — unhandled rejection 방지 */ });
        // 블록 중에도 read 는 정상 처리 — 이벤트 루프가 살아 있다(= pong 유지 = 다른 루트 생존)
        expect(await run(core, { kind: 'read', path: 'hello.txt' })).toMatchObject({ ok: true, content: 'world' });
        await expect(blocked).rejects.toThrow(/folders 시간 초과/);
    });

    it('블록된 listAll 도 동일하게 타임아웃된다', async () => {
        const core = makeCore();
        jest.spyOn(fs.promises, 'readdir').mockImplementation(() => new Promise(() => { /* never */ }));
        await expect(run(core, { kind: 'listAll' })).rejects.toThrow(/listAll 시간 초과/);
    });

    it('정상 폴더에서는 타임아웃 없이 기존 규약대로 동작한다', async () => {
        const core = makeCore();
        const r = await run(core, { kind: 'folders', path: '.' });
        expect(r).toMatchObject({ ok: true, entries: ['sub'], truncated: false });
        const list = await run(core, { kind: 'list', path: '.' });
        expect(list.entries).toContain('sub/');
        expect(list.entries).toContain('hello.txt');
    });
});
