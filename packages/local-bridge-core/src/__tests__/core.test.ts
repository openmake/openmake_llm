/**
 * BridgeCore — kind 디스패치·exec 3단 방어·일괄 승인 수명주기·폴더 열거 규칙 (실 fs).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult, ConfirmFn } from '../types';

function makeCore(folder: string, overrides?: Partial<ConstructorParameters<typeof BridgeCore>[0]>): BridgeCore {
    return new BridgeCore({
        folder,
        confirm: async () => 'yes',
        sandboxProfileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'omk-prof-')),
        ...overrides,
    });
}

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve, reject) => {
        core.handleExec(m, resolve).catch(reject);
    });
}

describe('BridgeCore', () => {
    let base: string;
    const savedAutoApprove = process.env.OMK_BRIDGE_AUTO_APPROVE;
    beforeAll(() => { delete process.env.OMK_BRIDGE_AUTO_APPROVE; }); // 훅이 켜져 있으면 confirm 검증이 무효
    afterAll(() => { if (savedAutoApprove !== undefined) process.env.OMK_BRIDGE_AUTO_APPROVE = savedAutoApprove; });
    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-core-'));
        fs.writeFileSync(path.join(base, 'hello.txt'), 'world');
        fs.mkdirSync(path.join(base, 'sub'));
        fs.mkdirSync(path.join(base, '.hidden'));
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    it('read/write/list/delete — 스코프 안 파일 I/O', async () => {
        const core = makeCore(base);
        expect(await run(core, { kind: 'read', path: 'hello.txt' })).toMatchObject({ ok: true, content: 'world' });
        await run(core, { kind: 'write', path: 'sub/new.txt', contentB64: Buffer.from('데이터').toString('base64') });
        expect(fs.readFileSync(path.join(base, 'sub/new.txt'), 'utf8')).toBe('데이터');
        const list = await run(core, { kind: 'list', path: '.' });
        expect(list.entries).toContain('sub/');       // 디렉토리 '/' 접미사 규약
        expect(list.entries).toContain('hello.txt');
        const del = await run(core, { kind: 'delete', path: 'sub/new.txt' });
        expect(del.ok).toBe(true);
        expect(fs.existsSync(path.join(base, 'sub/new.txt'))).toBe(false);
    });

    it('연결 폴더 루트 삭제는 거부된다 (done 밖 throw → 호출부 catch 계약)', async () => {
        const core = makeCore(base);
        await expect(run(core, { kind: 'delete', path: '.' })).rejects.toThrow(/루트는 삭제할 수 없습니다/);
    });

    it('스코프 밖 read 는 throw (연결부가 error 응답으로 변환)', async () => {
        const core = makeCore(base);
        await expect(run(core, { kind: 'read', path: '../../etc/hosts' })).rejects.toThrow(/스코프 밖/);
    });

    it('exec: denylist 는 confirm 없이 즉시 거부(exitCode 126)', async () => {
        const confirm = jest.fn<ReturnType<ConfirmFn>, Parameters<ConfirmFn>>();
        const core = makeCore(base, { confirm });
        const r = await run(core, { kind: 'exec', command: 'sudo ls' });
        expect(r).toMatchObject({ ok: false, exitCode: 126 });
        expect(r.error).toContain('위험 명령');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('exec: 사용자 거부 시 실행하지 않는다', async () => {
        const core = makeCore(base, { confirm: async () => 'no' });
        const r = await run(core, { kind: 'exec', command: 'touch should-not-exist' });
        expect(r).toMatchObject({ ok: false, exitCode: 126 });
        expect(fs.existsSync(path.join(base, 'should-not-exist'))).toBe(false);
    });

    (SANDBOX_ENABLED ? it : it.skip)('exec: prepare() 없이는 fail-closed (샌드박스 프로파일 부재)', async () => {
        const core = makeCore(base); // prepare() 미호출
        const r = await run(core, { kind: 'exec', command: 'echo hi' });
        expect(r).toMatchObject({ ok: false, exitCode: 126 });
        expect(r.error).toContain('샌드박스 프로파일');
    });

    it('exec: 승인 후 실행 — stdout 회수 (샌드박스 경유 포함)', async () => {
        const core = makeCore(base);
        core.prepare();
        const r = await run(core, { kind: 'exec', command: 'echo -n done-$((1+1))' });
        expect(r).toMatchObject({ ok: true, exitCode: 0 });
        expect(r.stdout).toBe('done-2');
    });

    it("일괄 승인('all')은 그 작업에만 유효하고 task_end 에서 회수된다", async () => {
        const answers: Array<'all' | 'no'> = ['all', 'no'];
        const confirm = jest.fn(async () => answers.shift() ?? 'no');
        const changes: number[] = [];
        const core = makeCore(base, { confirm, onAutoApproveChange: () => changes.push(core.autoApprovedCount()) });
        core.prepare();
        // 1회차 'all' → 이후 같은 taskId 는 confirm 없이 실행
        expect((await run(core, { kind: 'exec', command: 'echo 1', taskId: 't-1' })).ok).toBe(true);
        expect((await run(core, { kind: 'exec', command: 'echo 2', taskId: 't-1' })).ok).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
        // 다른 작업에는 적용되지 않는다
        expect((await run(core, { kind: 'exec', command: 'echo 3', taskId: 't-2' })).ok).toBe(false);
        // task_end → 회수, 다시 confirm 경유
        expect((await run(core, { kind: 'task_end', taskId: 't-1' })).ok).toBe(true);
        expect(core.autoApprovedCount()).toBe(0);
        expect(changes).toEqual([1, 0]);
    });

    it('folders: 숨김·심링크 제외, 상한 초과 시 truncated', async () => {
        fs.symlinkSync(os.tmpdir(), path.join(base, 'sym'));
        const core = makeCore(base);
        const r = await run(core, { kind: 'folders', path: '.' });
        expect(r.ok).toBe(true);
        expect(r.entries).toEqual(['sub']);   // .hidden·sym(심링크)·파일 제외
        expect(r.truncated).toBe(false);
    });

    it('folder(폴더 선택) base 재지정 — 스코프 밖 folder 는 거부', async () => {
        fs.writeFileSync(path.join(base, 'sub', 'inner.txt'), 'inner');
        const core = makeCore(base);
        const r = await run(core, { kind: 'read', path: 'inner.txt', folder: 'sub' });
        expect(r).toMatchObject({ ok: true, content: 'inner' });
        await expect(run(core, { kind: 'read', path: 'x', folder: '../..' })).rejects.toThrow(/스코프 밖/);
    });

    it('폐기된 browser kind 는 화이트리스트에서 빠져 거부된다 (2026-08-23)', async () => {
        const r = await run(makeCore(base), { kind: 'browser' } as BridgeMsg);
        expect(r.ok).toBe(false);
        expect(r.error).toContain('지원하지 않는 kind');
    });

    it('알 수 없는 kind 는 거부한다 (화이트리스트)', async () => {
        const r = await run(makeCore(base), { kind: 'evil_rpc' });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('지원하지 않는 kind');
    });
});
