/**
 * exec 출력 상한·정상·차단 — 상한은 stderr 끝에 중단 사유 한 줄, 표식 `truncated`(설계 2026-11-16 D1·§8 F2).
 * 기본 시간 제한(EXEC_TIMEOUT_MS)으로 돈다 — 시간 초과 사례는 `exec-stop-notice.test.ts`(mock 으로 줄인 시간 제한).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EXEC_TIMEOUT_MS, execStopNotice } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const OVERFLOW = execStopNotice('overflow', EXEC_TIMEOUT_MS);

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve, reject) => { core.handleExec(m, resolve).catch(reject); });
}

// Windows 는 cmd.exe 라 head·tr 가 없다 — 명령이 posix 셸 전용이다.
(process.platform === 'win32' ? describe.skip : describe)('exec 중단 사유 — 상한·정상·차단', () => {
    let base: string;
    let prof: string;
    let core: BridgeCore;
    const saved = process.env.OMK_BRIDGE_AUTO_APPROVE;
    beforeAll(() => { delete process.env.OMK_BRIDGE_AUTO_APPROVE; });
    afterAll(() => { if (saved !== undefined) process.env.OMK_BRIDGE_AUTO_APPROVE = saved; });
    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-stop-'));
        prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-prof-'));
        core = new BridgeCore({ folder: base, confirm: async () => 'yes', sandboxProfileDir: prof });
        core.prepare();
    });
    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(prof, { recursive: true, force: true });
    });

    it('stdout 출력 상한 초과 — stderr 에 상한 문구, truncated, 종료 코드 1', async () => {
        const r = await run(core, { kind: 'exec', command: "head -c 1048577 /dev/zero | tr '\\0' a" });
        expect({ ...r, stdout: r.stdout?.length }).toStrictEqual({ ok: true, stdout: 1048576, stderr: OVERFLOW, exitCode: 1, truncated: true });
    });

    it('정상 종료·0 아닌 종료 — 문구·표식 없음', async () => {
        expect(await run(core, { kind: 'exec', command: 'echo ok' })).toStrictEqual({ ok: true, stdout: 'ok\n', stderr: '', exitCode: 0 });
        expect(await run(core, { kind: 'exec', command: 'echo e >&2; exit 2' })).toStrictEqual({ ok: true, stdout: '', stderr: 'e\n', exitCode: 2 });
    });

    it('차단·거부 — 문구·표식 없음', async () => {
        expect(await run(core, { kind: 'exec', command: 'sudo ls' })).toStrictEqual(expect.objectContaining({ ok: false, exitCode: 126 }));
        const no = new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: prof });
        no.prepare();
        const r = await run(no, { kind: 'exec', command: 'echo x' });
        expect(r).toStrictEqual({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 });
    });
});
