/**
 * exec 시간 초과 — 결과 stderr 끝에 중단 사유 한 줄, 표식 `timedOut`(설계 2026-11-16 D1·§8 F2).
 * 시간 제한을 줄여 실제 자식(sleep)으로 본다 — 가짜 타이머를 쓰지 않는다. mock 이 파일 단위라 시간 초과 사례만 둔다
 * (상한·정상·차단 사례는 `exec-stop-notice-plain.test.ts`, 기본 시간 제한).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../constants', () => ({ ...jest.requireActual('../constants'), EXEC_TIMEOUT_MS: 1500 }));

import { execStopNotice } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const TIMEOUT = execStopNotice('timeout', 1500);

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve, reject) => { core.handleExec(m, resolve).catch(reject); });
}

// Windows 는 cmd.exe 라 sleep·head 가 없다 — 명령이 posix 셸 전용이다.
(process.platform === 'win32' ? describe.skip : describe)('exec 중단 사유 — 시간 초과', () => {
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

    it('직접 자식이 살아 있는 시간 초과 — stderr 끝에 시간 제한 문구, timedOut, 종료 코드 1', async () => {
        const r = await run(core, { kind: 'exec', command: 'echo p; sleep 5' });
        expect(r).toStrictEqual({ ok: true, stdout: 'p\n', stderr: TIMEOUT, exitCode: 1, timedOut: true });
    });

    it('기존 stderr 가 줄바꿈 없이 끝나면 줄바꿈 하나 뒤에 붙인다', async () => {
        const r = await run(core, { kind: 'exec', command: 'echo -n err >&2; sleep 5' });
        expect(r).toStrictEqual({ ok: true, stdout: '', stderr: `err\n${TIMEOUT}`, exitCode: 1, timedOut: true });
    });

    it('직접 자식이 끝난 뒤의 시간 초과(손자가 파이프를 쥠) — 문구·표식 없음, 그 종료 코드', async () => {
        const r = await run(core, { kind: 'exec', command: 'sleep 5 & echo fg; exit 3' });
        expect(r).toStrictEqual({ ok: true, stdout: 'fg\n', stderr: '', exitCode: 3 });
    });

    it('직접 자식이 신호로 끝난 뒤의 시간 초과(손자가 파이프를 쥠) — 시간 제한 문구, timedOut, 종료 코드 1', async () => {
        const r = await run(core, { kind: 'exec', command: 'sleep 5 & echo fg; kill -9 $$' });
        expect(r).toStrictEqual({ ok: true, stdout: 'fg\n', stderr: TIMEOUT, exitCode: 1, timedOut: true });
    });
});
