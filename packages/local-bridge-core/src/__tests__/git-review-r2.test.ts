/**
 * PR-A 재리뷰(REVIEW_A_R2.md) N1~N3 — 실제 sandbox-exec·git. 탐침 `review-probe-a.ts` 의 r2_* 사례를 옮겼다.
 * 레포·표식은 실제 홈 아래 임시 폴더(프로파일이 늘 여는 임시 경로 밖)다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { GITFILE_MAX_BYTES, SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import { detectGit, rootGitDir } from '../git-trust';
import type { BridgeMsg, BridgeResult } from '../types';

// jest 의 process.env 는 사본이라 os.homedir()(libuv 는 실제 환경을 읽는다)가 HOME 을 따라오게 한다(conformance-exec 와 같다).
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const TASK = 'gitrv201-1111-2222-3333-444455556666';
const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';

let tmp = '';
let outside = '';
const writers: ChildProcess[] = [];

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitr2-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitr2-out-'));
});
afterEach(() => {
    for (const w of writers.splice(0)) w.kill('SIGKILL');
    for (const d of [tmp, outside]) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
    });
}
function makeRepo(rel: string): string {
    const repo = path.join(tmp, rel);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    return repo;
}
function makeCore(folder: string, approve = false): BridgeCore {
    const core = new BridgeCore({ folder, confirm: async () => (approve ? 'yes' : 'no'), sandboxProfileDir: os.tmpdir() });
    core.prepare();
    return core;
}
function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}
const write = (p: string, content: string): BridgeMsg => ({ kind: 'write', path: p, contentB64: Buffer.from(content).toString('base64') } as BridgeMsg);
const del = (p: string): BridgeMsg => ({ kind: 'delete', path: p } as BridgeMsg);
const exec = (command: string): BridgeMsg => ({ kind: 'exec', command } as BridgeMsg);
const denied = (p: string): BridgeResult => ({ ok: false, error: `${DENIED}${p}` });
/**
 * FIFO 를 만들고, 몇 초 뒤부터 그 FIFO 에 계속 쓰는 자식을 띄운다 — 읽는 쪽(브리지나 git)은 그때까지 멈췄다가 풀린다.
 * 브리지가 동기로 읽으면 이벤트 루프가 그동안 멈춘다(멈춤을 시간으로 잰다).
 */
function fifoWithLateWriter(p: string, delaySec: number): void {
    execFileSync('mkfifo', [p]);
    writers.push(spawn('sh', ['-c', `sleep ${delaySec}; while :; do printf 'x\\n' > "$0"; done`, p], { stdio: 'ignore' }));
}
/** fn 이 도는 동안 이벤트 루프가 가장 길게 멈춘 시간(ms). */
async function maxLoopStall<T>(fn: () => Promise<T>): Promise<[T, number]> {
    let last = Date.now();
    let max = 0;
    const t = setInterval(() => { const now = Date.now(); max = Math.max(max, now - last); last = now; }, 50);
    try {
        const r = await fn();
        max = Math.max(max, Date.now() - last);
        return [r, max];
    } finally { clearInterval(t); }
}

const sbDescribe = SANDBOX_ENABLED ? describe : describe.skip;

describe('N1 — 연결 폴더 루트의 .git 은 없어도 이름으로 지킨다(파일 kind)', () => {
    it('하위 폴더 연결: 폴더 안에 새 .git 의 config·hooks·commondir·config.worktree·.git 자신을 못 쓴다', async () => {
        const repo = makeRepo('repo');
        const sub = path.join(repo, 'apps', 'web');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'w.txt'), 'w\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'web');
        const core = makeCore(sub);
        const marker = path.join(outside, 'fsmon');
        expect(await run(core, write('.git/HEAD', 'ref: refs/heads/main\n'))).toEqual({ ok: true });
        expect(await run(core, write('.git/objects/.keep', ''))).toEqual({ ok: true });
        expect(await run(core, write('.git/refs/heads/.keep', ''))).toEqual({ ok: true });
        for (const p of ['.git/config', '.git/Config', '.GIT/config', '.git/hooks/pre-commit', '.git/HOOKS/x', '.git/commondir', '.git/config.worktree']) {
            expect(await run(core, write(p, `[core]\n\tfsmonitor = "touch ${marker}; true #"\n`))).toEqual(denied(p));
        }
        try { git(sub, 'status'); } catch { /* 가짜 .git 이라 실패해도 된다 */ }
        expect(fs.existsSync(marker)).toBe(false);
        expect(fs.existsSync(path.join(sub, '.git', 'config'))).toBe(false);
    });

    it('레포 아닌 폴더: .git 자신(파일)을 쓰거나 지울 수 없고 .git/HEAD 는 종전대로 쓴다', async () => {
        const plain = path.join(tmp, 'plain');
        fs.mkdirSync(plain);
        const core = makeCore(plain);
        expect(await run(core, write('.git', 'gitdir: ./x\n'))).toEqual(denied('.git'));
        expect(fs.existsSync(path.join(plain, '.git'))).toBe(false);
        expect(await run(core, write('.git/HEAD', 'ref: refs/heads/main\n'))).toEqual({ ok: true });
        expect(await run(core, del('.git'))).toEqual(denied('.git'));
        expect(await run(core, del('.git/HEAD'))).toEqual({ ok: true });
    });

    sbDescribe('샌드박스', () => {
        it('연결 뒤 승인된 git init 으로 생긴 .git: 같은 연결에서 파일 kind 로 config·hooks 를 못 쓴다', async () => {
            const plain = path.join(tmp, 'plain');
            fs.mkdirSync(plain);
            const core = makeCore(plain, true);
            expect(await run(core, exec('git init -q && echo inited'))).toMatchObject({ ok: true, exitCode: 0 });
            expect(await run(core, write('.git/config', '[core]\n\tfsmonitor = x\n'))).toEqual(denied('.git/config'));
            expect(await run(core, write('.git/hooks/pre-commit', '#!/bin/sh\n'))).toEqual(denied('.git/hooks/pre-commit'));
        });
    });

    it('.git 이 폴더 안 심링크면 심링크 자리(.git 자신)를 지우거나 덮어쓸 수 없다', async () => {
        const repo = makeRepo('repo');
        fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store'));
        fs.symlinkSync('store', path.join(repo, '.git'));
        const core = makeCore(repo);
        expect(await run(core, del('.git'))).toEqual(denied('.git'));
        expect(fs.lstatSync(path.join(repo, '.git')).isSymbolicLink()).toBe(true);
    });
});

describe('N2 — .git 이 폴더 안을 가리키는 gitfile·심링크면 탐지가 실패해도 그 대상을 지킨다', () => {
    function gitfileRepo(): string {
        const repo = makeRepo('repo');
        fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store.git'));
        fs.writeFileSync(path.join(repo, '.git'), 'gitdir: ./store.git\n');
        return repo;
    }

    it('gitfile → ./store.git: HEAD 를 깨고 재연결해도 config·hooks 를 파일 kind 로 못 쓴다', async () => {
        const repo = gitfileRepo();
        const core = makeCore(repo);
        expect(await run(core, write('store.git/config', 'x'))).toEqual(denied('store.git/config'));
        expect(await run(core, write('store.git/HEAD', 'garbage\n'))).toEqual({ ok: true });
        core.prepare();
        expect(detectGit(repo)).toBeNull();
        expect(await run(core, write('store.git/hooks/pre-commit', '#!/bin/sh\n'))).toEqual(denied('store.git/hooks/pre-commit'));
        expect(await run(core, write('store.git/config', 'x'))).toEqual(denied('store.git/config'));
        expect(await run(core, del('store.git'))).toEqual(denied('store.git'));
    });

    sbDescribe('샌드박스', () => {
        it('gitfile → ./store.git: 탐지 실패 뒤에도 exec 로 store.git/config 를 못 고친다', async () => {
            const repo = gitfileRepo();
            fs.writeFileSync(path.join(repo, 'store.git', 'HEAD'), 'garbage\n');
            const core = makeCore(repo, true);
            const r = await run(core, exec('echo "#x" >> store.git/config && echo wrote'));
            expect(r.stdout ?? '').not.toContain('wrote');
            expect(fs.readFileSync(path.join(repo, 'store.git', 'config'), 'utf8')).not.toContain('#x');
        });

        it('.git → store 심링크: 탐지 실패 뒤에도 exec 로 store/config 를 못 고친다', async () => {
            const repo = makeRepo('repo');
            fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store'));
            fs.symlinkSync('store', path.join(repo, '.git'));
            fs.writeFileSync(path.join(repo, 'store', 'HEAD'), 'garbage\n');
            const core = makeCore(repo, true);
            expect(await run(core, write('store/config', 'x'))).toEqual(denied('store/config'));
            const r = await run(core, exec('echo "#x" >> store/config && echo wrote'));
            expect(r.stdout ?? '').not.toContain('wrote');
        });
    });

    it('rootGitDir: 폴더 안 대상만, gitdir 한 줄·크기 상한·일반 파일만', () => {
        const root = fs.realpathSync(path.join(tmp));
        const store = path.join(root, 'store.git');
        fs.mkdirSync(store);
        const dotGit = path.join(root, '.git');
        const at = (content: string): ReturnType<typeof rootGitDir> => { fs.rmSync(dotGit, { force: true }); fs.writeFileSync(dotGit, content); return rootGitDir(root); };
        expect(at('gitdir: ./store.git\n')).toEqual({ gitDir: store, commonDir: store });
        expect(at(`gitdir: ${store}`)).toEqual({ gitDir: store, commonDir: store });
        expect(at(`gitdir: ${outside}\n`)).toBeNull(); // 폴더 밖 — 어차피 쓰기가 열리지 않는다
        expect(at('gitdir: ./store.git\nextra\n')).toBeNull(); // 한 줄만
        expect(at('x\ngitdir: ./store.git\n')).toBeNull();
        expect(at(`gitdir: ./store.git\n${' '.repeat(GITFILE_MAX_BYTES)}`)).toBeNull(); // 크기 상한
        expect(at('gitdir: ./none\n')).toBeNull();
        fs.rmSync(dotGit);
        fs.symlinkSync('store.git', dotGit);
        expect(rootGitDir(root)).toEqual({ gitDir: store, commonDir: store });
        fs.rmSync(dotGit);
        fs.symlinkSync(outside, dotGit);
        expect(rootGitDir(root)).toBeNull();
    });

    it('rootGitDir: .git 이 FIFO 면 읽지 않는다(멈추지 않는다)', () => {
        const root = fs.realpathSync(tmp);
        fifoWithLateWriter(path.join(root, '.git'), 4);
        const t0 = Date.now();
        expect(rootGitDir(root)).toBeNull();
        expect(Date.now() - t0).toBeLessThan(2000);
    });
});

describe('N3 — 코어가 샌드박스 밖에서 읽는 git 메타 파일은 일반 파일만 읽는다', () => {
    it('info/exclude 가 FIFO 여도 worktree add 중 브리지의 이벤트 루프가 멈추지 않는다(등록은 건너뛴다)', async () => {
        const repo = makeRepo('repo');
        fs.rmSync(path.join(repo, '.git', 'info', 'exclude'), { force: true });
        fifoWithLateWriter(path.join(repo, '.git', 'info', 'exclude'), 5);
        const core = makeCore(repo);
        // git 자식도 exclude 를 읽어 쓰는 자식이 나올 때까지 기다린다 — 그것은 자식의 일이고 이벤트 루프는 돈다.
        const [r, stall] = await maxLoopStall(() => run(core, { kind: 'worktree', op: 'add', taskId: TASK } as BridgeMsg));
        expect({ ok: r.ok, stalled: stall >= 2000 }).toEqual({ ok: true, stalled: false });
        expect(fs.lstatSync(path.join(repo, '.git', 'info', 'exclude')).isFIFO()).toBe(true);
    }, 30000);

    it('linked worktree 메타의 gitdir 이 FIFO 여도 연결 탐지가 멈추지 않는다', () => {
        const main = makeRepo('main');
        git(main, 'worktree', 'add', '-q', path.join(tmp, 'lw'), '-b', 'lw');
        const meta = path.join(main, '.git', 'worktrees', 'lw', 'gitdir');
        fs.rmSync(meta);
        fifoWithLateWriter(meta, 6);
        const t0 = Date.now();
        expect(detectGit(path.join(tmp, 'lw'))).toBeNull();
        expect(Date.now() - t0).toBeLessThan(6000);
    }, 20000);
});
