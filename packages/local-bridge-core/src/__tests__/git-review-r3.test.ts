/**
 * PR-A 3차 리뷰(REVIEW_A_R3.md) R1~R4 + R5(test-runner 표식 읽기) — 실제 git·sandbox-exec. 탐침 `review-probe-a.ts` 의 r3_* 사례를 옮겼다.
 * 레포·표식은 실제 홈 아래 임시 폴더(프로파일이 늘 여는 임시 경로 밖)다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { MAX_BUFFER } from '../constants';
import { BridgeCore } from '../core';
import { rootGitDir } from '../git-trust';
import type { BridgeMsg, BridgeResult } from '../types';

jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const TASK = 'gitrv301-1111-2222-3333-444455556666';
const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';

let tmp = '';
let outside = '';
const writers: ChildProcess[] = [];

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitr3-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitr3-out-'));
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
function subfolder(): string {
    const repo = makeRepo('repo');
    const sub = path.join(repo, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'w.txt'), 'w\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'web');
    return sub;
}
function makeCore(folder: string): BridgeCore {
    const core = new BridgeCore({ folder, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
    core.prepare();
    return core;
}
function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}
const write = (p: string, content = 'x'): BridgeMsg => ({ kind: 'write', path: p, contentB64: Buffer.from(content).toString('base64') } as BridgeMsg);
const del = (p: string): BridgeMsg => ({ kind: 'delete', path: p } as BridgeMsg);
const denied = (p: string): BridgeResult => ({ ok: false, error: `${DENIED}${p}` });
const fsmonitor = (marker: string): string => `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = "touch ${marker}; true #"\n`;
/** 사용자의 후속 git status — 심은 fsmonitor 가 돌았는가. */
function statusRan(cwd: string, marker: string): boolean {
    try { git(cwd, 'status'); } catch { /* 가짜 git 디렉터리라 실패해도 된다 */ }
    return fs.existsSync(marker);
}
function fifoWithLateWriter(p: string, delaySec: number): void {
    execFileSync('mkfifo', [p]);
    writers.push(spawn('sh', ['-c', `sleep ${delaySec}; while :; do printf 'x\\n' > "$0"; done`, p], { stdio: 'ignore' }));
}
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

describe('R1 — 지키는 git 디렉터리 바로 아래 첫 이름에 ASCII 가 아닌 글자가 있으면 거절한다', () => {
    it('하위 폴더 연결: 새 .git 의 conﬁg(U+FB01)·config.worKtree(U+212A)·hooKs·hookſ 를 못 쓰고 후속 git status 가 돌지 않는다', async () => {
        const sub = subfolder();
        const core = makeCore(sub);
        const marker = path.join(outside, 'fsmon');
        for (const p of ['.git/HEAD', '.git/objects/.keep', '.git/refs/heads/.keep']) expect(await run(core, write(p, p.endsWith('HEAD') ? 'ref: refs/heads/main\n' : ''))).toEqual({ ok: true });
        for (const p of ['.git/con\uFB01g', '.git/config.wor\u212Atree', '.git/hoo\u212As/pre-commit', '.git/hook\u017F/pre-commit', '.git/\uFF43onfig']) {
            expect(await run(core, write(p, fsmonitor(marker)))).toEqual(denied(p));
        }
        expect(statusRan(sub, marker)).toBe(false);
        // 둘째 이름부터는 종전대로(브랜치 이름 등)
        expect(await run(core, write('.git/refs/heads/한글', '0'.repeat(40)))).toEqual({ ok: true });
    });

    it('믿는 일반 레포 + extensions.worktreeConfig: 아직 없는 config.worKtree 를 못 쓰고 후속 git status 가 돌지 않는다', async () => {
        const repo = makeRepo('repo');
        git(repo, 'config', 'extensions.worktreeConfig', 'true');
        const core = makeCore(repo);
        const marker = path.join(outside, 'fsmon');
        expect(await run(core, write('.git/config.wor\u212Atree', fsmonitor(marker)))).toEqual(denied('.git/config.wor\u212Atree'));
        expect(await run(core, del('.git/\uFF58'))).toEqual(denied('.git/\uFF58'));
        expect(statusRan(repo, marker)).toBe(false);
        expect(await run(core, write('.git/refs/heads/브랜치', '0'.repeat(40)))).toEqual({ ok: true });
        expect(await run(core, write('한글.txt'))).toEqual({ ok: true });
    });
});

describe('R2 — 연결 폴더 루트가 지키는 git 디렉터리가 아니면 루트의 HEAD 를 파일 kind 로 만들지 못한다', () => {
    for (const layout of ['subfolder', 'plain'] as const) {
        it(`${layout}: HEAD·objects·refs·config 로 루트를 bare 꼴로 만들 수 없고 후속 git status 가 돌지 않는다`, async () => {
            const root = layout === 'subfolder' ? subfolder() : path.join(tmp, 'plain');
            fs.mkdirSync(root, { recursive: true });
            const core = makeCore(root);
            const marker = path.join(outside, 'fsmon');
            expect(await run(core, write('HEAD', 'ref: refs/heads/main\n'))).toEqual(denied('HEAD'));
            expect(await run(core, write('head', 'ref: refs/heads/main\n'))).toEqual(denied('head'));
            for (const p of ['objects/.keep', 'refs/heads/.keep']) expect(await run(core, write(p, ''))).toEqual({ ok: true });
            expect(await run(core, write('config', fsmonitor(marker)))).toEqual({ ok: true }); // 루트 config 는 막지 않는다
            expect(fs.existsSync(path.join(root, 'HEAD'))).toBe(false);
            expect(statusRan(root, marker)).toBe(false);
            expect(await run(core, write('src/HEAD'))).toEqual({ ok: true }); // 하위 폴더는 넓히지 않는다
        });
    }

    it('루트가 이미 bare 꼴이면 루트를 지킨다 — config·hooks 거절, HEAD 는 종전대로', async () => {
        const root = path.join(tmp, 'bare');
        for (const d of ['objects', 'refs/heads']) fs.mkdirSync(path.join(root, d), { recursive: true });
        fs.writeFileSync(path.join(root, 'HEAD'), 'ref: refs/heads/main\n');
        const core = makeCore(root);
        for (const p of ['config', 'hooks/pre-commit', 'commondir']) expect(await run(core, write(p))).toEqual(denied(p));
        expect(await run(core, write('HEAD', 'ref: refs/heads/x\n'))).toEqual({ ok: true });
        expect(await run(core, write('a.txt'))).toEqual({ ok: true });
    });
});

describe('R3 — gitfile 해석을 git 에 맞춘다(끝 줄바꿈 여럿, 심링크 → gitfile)', () => {
    it('rootGitDir: 끝 \\r·\\n 을 모두 떼고, 심링크가 가리키는 gitfile 은 심링크 자리 기준으로 푼다', () => {
        const root = fs.realpathSync(tmp);
        const store = path.join(root, 'store.git');
        fs.mkdirSync(store);
        const dotGit = path.join(root, '.git');
        const at = (content: string): ReturnType<typeof rootGitDir> => { fs.rmSync(dotGit, { force: true }); fs.writeFileSync(dotGit, content); return rootGitDir(root); };
        const want = { gitDir: store, commonDir: store };
        expect(at('gitdir: ./store.git\n\n')).toEqual(want);
        expect(at('gitdir: ./store.git\r\n\r\n\n')).toEqual(want);
        expect(at(`gitdir: ./store.git${'\n'.repeat(5000)}`)).toBeNull(); // 크기 상한은 그대로
        expect(at('gitdir: ./store.git\n\nx\n')).toBeNull();
        fs.rmSync(dotGit);
        fs.mkdirSync(path.join(root, 'sub'));
        fs.writeFileSync(path.join(root, 'sub', 'gf'), 'gitdir: ./store.git\n');
        fs.symlinkSync('sub/gf', dotGit);
        expect(rootGitDir(root)).toEqual(want); // git 도 <root>/store.git 을 쓴다(실측)
        fs.renameSync(store, path.join(root, 'sub', 'store.git'));
        expect(rootGitDir(root)).toBeNull(); // git 도 거절한다(실측)
    });

    it('끝 줄바꿈 둘인 gitfile → ./store.git: HEAD 를 깨 탐지가 실패해도 config·hooks 를 파일 kind 로 못 쓴다', async () => {
        const repo = makeRepo('repo');
        fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store.git'));
        fs.writeFileSync(path.join(repo, '.git'), 'gitdir: ./store.git\n\n');
        fs.writeFileSync(path.join(repo, 'store.git', 'HEAD'), 'garbage\n');
        const core = makeCore(repo);
        for (const p of ['store.git/config', 'store.git/hooks/pre-commit']) expect(await run(core, write(p))).toEqual(denied(p));
    });

    it('.git → gitfile 심링크: 탐지가 실패해도 대상 git 디렉터리를 지킨다', async () => {
        const repo = makeRepo('repo');
        fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store.git'));
        fs.writeFileSync(path.join(repo, 'gf'), 'gitdir: ./store.git\n');
        fs.symlinkSync('gf', path.join(repo, '.git'));
        fs.writeFileSync(path.join(repo, 'store.git', 'HEAD'), 'garbage\n');
        const core = makeCore(repo);
        for (const p of ['store.git/config', 'store.git/hooks/pre-commit']) expect(await run(core, write(p))).toEqual(denied(p));
    });
});

describe('R4 — info/exclude 읽기 상한', () => {
    it('info/exclude 가 MAX_BUFFER 를 넘으면 제외 등록만 건너뛴다(worktree add 는 된다)', async () => {
        const repo = makeRepo('repo');
        const ex = path.join(repo, '.git', 'info', 'exclude');
        const big = `${'#'.repeat(MAX_BUFFER)}\n`;
        fs.writeFileSync(ex, big);
        const core = makeCore(repo);
        const r = await run(core, { kind: 'worktree', op: 'add', taskId: TASK } as BridgeMsg);
        expect(r.ok).toBe(true);
        expect(fs.statSync(ex).size).toBe(big.length);
    }, 30000);
});

describe('R5 — test-runner 표식 파일은 일반 파일만·상한 안에서 읽는다', () => {
    for (const name of ['package.json', 'pyproject.toml']) {
        it(`${name} 가 FIFO 여도 test_runner 동안 이벤트 루프가 멈추지 않고 표식 없음이다`, async () => {
            const root = path.join(tmp, 'proj');
            fs.mkdirSync(root);
            fifoWithLateWriter(path.join(root, name), 4);
            const core = makeCore(root);
            const [r, stall] = await maxLoopStall(() => run(core, { kind: 'test_runner' } as BridgeMsg));
            expect({ r, stalled: stall >= 2000 }).toEqual({ r: { ok: true, testRunner: 'none' }, stalled: false });
        }, 20000);
    }

    it('package.json 이 MAX_BUFFER 를 넘으면 표식 없음이다', async () => {
        const root = path.join(tmp, 'proj');
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), `{"scripts":{"test":"jest"},"pad":"${' '.repeat(MAX_BUFFER)}"}`);
        const core = makeCore(root);
        expect(await run(core, { kind: 'test_runner' } as BridgeMsg)).toEqual({ ok: true, testRunner: 'none' });
    });
});
