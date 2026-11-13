/**
 * BridgeCore — kind 디스패치·exec 3단 방어·일괄 승인 수명주기·폴더 열거 규칙 (실 fs).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BRIDGE_KINDS, BROWSER_KIND, SANDBOX_ENABLED, sbq } from '../constants';
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

    it('test_runner: 러너 탐지는 확인 창 없이 처리한다(읽기 전용 — 서버 명령을 실행하지 않는다)', async () => {
        const confirm = jest.fn<ReturnType<ConfirmFn>, Parameters<ConfirmFn>>();
        const core = makeCore(base, { confirm });
        expect(await run(core, { kind: 'test_runner', path: '.' })).toMatchObject({ ok: true, testRunner: 'none' });
        fs.writeFileSync(path.join(base, 'sub/package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
        expect(await run(core, { kind: 'test_runner', path: 'sub' })).toMatchObject({ ok: true, testRunner: 'npm' });
        expect(confirm).not.toHaveBeenCalled();
        await expect(run(core, { kind: 'test_runner', path: '../..' })).rejects.toThrow(/스코프 밖/);
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

    // 헬퍼는 연결 폴더마다 코어를 만들고 모두 같은 프로파일 폴더를 넘긴다. 파일 이름이 pid 하나뿐이면
    // 나중에 준비한 폴더의 프로파일이 모든 코어의 exec 에 적용됐다(A 의 명령이 A 에는 못 쓰고 B 에 썼다).
    // 프로파일 텍스트 검사(코어마다 자기 파일·자기 루트만)는 항상 한다 — 이것만으로 파일 공유 회귀를 잡는다.
    // 서로의 폴더 실제 쓰기 실패 단언은 폴더가 프로파일이 늘 여는 쓰기 경로(임시·캐시 등) 밖일 때만 한다:
    // 검증 스크립트가 HOME 을 임시 폴더(/private/var/folders 아래)로 바꾸면 홈 아래 폴더가 처음부터 쓰기 허용
    // 구역 안이라 A 가 B 에 쓸 수 있다(제품 결함이 아니라 환경 — 2026-11-12 스테이징 검증).
    (SANDBOX_ENABLED ? it : it.skip)('exec: 폴더가 둘이어도 각 코어는 자기 폴더에만 쓴다(프로파일 파일이 코어마다 따로)', async () => {
        const home = fs.realpathSync(os.homedir());
        const a = fs.mkdtempSync(path.join(home, '.omk-sbtest-a-'));
        const b = fs.mkdtempSync(path.join(home, '.omk-sbtest-b-'));
        const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-prof-'));
        const rootLine = (root: string) => `(allow file-write* (subpath ${sbq(root)}))`;
        // 프로파일에서 자기 루트 줄을 뺀 나머지 쓰기 허용 subpath(코어의 생성 규칙이 늘 여는 경로).
        const otherWritable = (profile: string, own: string) => profile.split('\n')
            .filter((l) => l.startsWith('(allow file-write*') && l !== rootLine(own))
            .flatMap((l) => [...l.matchAll(/\(subpath "((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1].replace(/\\(.)/g, '$1')));
        const isUnder = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
        try {
            const coreA = makeCore(a, { sandboxProfileDir: prof });
            const coreB = makeCore(b, { sandboxProfileDir: prof });
            coreA.prepare();
            coreB.prepare();

            const profiles = fs.readdirSync(prof).sort();
            expect(profiles).toHaveLength(2);
            for (const f of profiles) expect(f).toMatch(new RegExp(`^omk-exec-sandbox-${process.pid}-\\d+\\.sb$`));
            const read = () => profiles.map((f) => fs.readFileSync(path.join(prof, f), 'utf8'));
            const checkProfiles = () => {
                const contents = read();
                const ofA = contents.filter((c) => c.includes(rootLine(a)));
                const ofB = contents.filter((c) => c.includes(rootLine(b)));
                expect(ofA).toHaveLength(1);
                expect(ofB).toHaveLength(1);
                expect(ofA[0]).not.toContain(`(subpath ${sbq(b)})`);
                expect(ofB[0]).not.toContain(`(subpath ${sbq(a)})`);
                return { profA: ofA[0], profB: ofB[0] };
            };
            const { profA, profB } = checkProfiles();

            const write = (core: BridgeCore, dir: string, name: string) => run(core, { kind: 'exec', command: `echo x > '${path.join(dir, name)}'` });
            expect(await write(coreA, a, 'a-in-a')).toMatchObject({ ok: true, exitCode: 0 });
            expect(await write(coreB, b, 'b-in-b')).toMatchObject({ ok: true, exitCode: 0 });
            expect(fs.existsSync(path.join(a, 'a-in-a'))).toBe(true);
            expect(fs.existsSync(path.join(b, 'b-in-b'))).toBe(true);

            const shared = [...otherWritable(profA, a).filter((d) => isUnder(b, d)), ...otherWritable(profB, b).filter((d) => isUnder(a, d))];
            if (shared.length === 0) {
                expect((await write(coreA, b, 'a-in-b')).exitCode).not.toBe(0);
                expect((await write(coreB, a, 'b-in-a')).exitCode).not.toBe(0);
                expect(fs.existsSync(path.join(b, 'a-in-b'))).toBe(false);
                expect(fs.existsSync(path.join(a, 'b-in-a'))).toBe(false);
            } else {
                console.warn(`서로의 폴더 쓰기 실패 단언 건너뜀: 테스트 폴더(${home} 아래)가 프로파일이 늘 여는 쓰기 경로 안(${[...new Set(shared)].join(', ')})`);
            }

            // 같은 코어가 다시 준비하면 자기 파일을 다시 쓴다(새 파일을 만들지 않는다).
            coreA.prepare();
            expect(fs.readdirSync(prof).sort()).toEqual(profiles);
            checkProfiles();
            if (shared.length === 0) expect((await write(coreA, b, 'a-in-b-2')).exitCode).not.toBe(0);
        } finally {
            for (const d of [a, b, prof]) fs.rmSync(d, { recursive: true, force: true });
        }
    });

    it('exec: 자식 환경에 호스트 비밀이 상속되지 않는다(allowlist)', async () => {
        process.env.OMK_COMPANION_API_KEY = 'omk_live_leak_probe';
        process.env.OMK_TEST_SECRET_PROBE = 'leak';
        try {
            const core = makeCore(base);
            core.prepare();
            const r = await run(core, { kind: 'exec', command: 'env' });
            expect(r.ok).toBe(true);
            expect(r.stdout).not.toContain('omk_live_leak_probe');
            expect(r.stdout).not.toContain('OMK_TEST_SECRET_PROBE');
            expect(r.stdout).toMatch(/^HOME=/m);
            expect(r.stdout).toMatch(/^PATH=/m);
        } finally {
            delete process.env.OMK_COMPANION_API_KEY;
            delete process.env.OMK_TEST_SECRET_PROBE;
        }
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

    it('알 수 없는 kind 는 거부한다 (화이트리스트)', async () => {
        const r = await run(makeCore(base), { kind: 'evil_rpc' });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('지원하지 않는 kind');
    });

    it('BRIDGE_KINDS(서버에 알리는 능력 목록)는 handleExec 가 처리하는 종류와 정확히 같다', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'core.ts'), 'utf8');
        const body = src.slice(src.indexOf('switch (m.kind)'));
        const cases = [...body.matchAll(/case '([a-z_A-Z]+)'/g)].map((m) => m[1]);
        // browser 는 능력 목록에 조건부로 들어간다(전용 프로필 + Chrome) — 기본 목록에는 없다
        expect([...cases].sort()).toEqual([...BRIDGE_KINDS, BROWSER_KIND].sort());
    });

    it('전용 프로필을 주지 않으면 브라우저를 알리지도 처리하지도 않는다', async () => {
        const core = makeCore(base);
        expect(core.capabilities()).toEqual([...BRIDGE_KINDS]);
        const r = await run(core, { kind: 'browser', actions: [{ type: 'goto', url: 'https://example.com' }] });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('브라우저를 쓸 수 없습니다');
    });
});
