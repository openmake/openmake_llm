/**
 * code_nav 예산 < 관문 제한 — 느린 훑기가 관문 오류(`code_nav 시간 초과`)가 아니라 잘린 결과(`truncated`)로 끝난다
 * (설계 2026-11-15 D-3). 관문을 줄여 재현한다 — 상수가 import 시점에 읽히므로 require 전에 환경을 둔다.
 */
process.env.OMK_BRIDGE_FS_TIMEOUT_MS = '1000'; // 실제 예산 = min(15000, 1000 × 4/5) = 800ms

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

describe('code_nav 예산은 관문 제한보다 짧다', () => {
    let base: string;
    let prof: string;
    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-navb-'));
        prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-prof-'));
        // 폴더 40개 × readdir 50ms = 2초 — 관문(1초)보다 길다.
        for (let i = 0; i < 40; i++) {
            fs.mkdirSync(path.join(base, `d${i}`));
            fs.writeFileSync(path.join(base, `d${i}`, 'a.txt'), 'x\n');
        }
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(prof, { recursive: true, force: true });
    });

    it('느린 훑기는 관문 오류가 아니라 truncated 로 답한다', async () => {
        const core = new BridgeCore({ folder: base, confirm: async () => 'yes', sandboxProfileDir: prof });
        const real = fs.promises.readdir.bind(fs.promises) as (...a: unknown[]) => Promise<unknown>;
        jest.spyOn(fs.promises, 'readdir').mockImplementation((async (...a: unknown[]) => {
            await new Promise((r) => setTimeout(r, 50));
            return real(...a);
        }) as unknown as typeof fs.promises.readdir);
        const r = await run(core, { kind: 'code_nav', op: 'files', path: '.' } as BridgeMsg);
        expect(r.ok).toBe(true);
        expect(r.codeNav?.truncated).toBe(true);
    });
});
