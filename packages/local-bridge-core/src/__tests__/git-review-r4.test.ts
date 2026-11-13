/**
 * PR-A 4차 리뷰(REVIEW_A_R4.md) S1·S2 + 설계 D-11(파일 kind 는 git 이 저장소로 인식하는 구조를 만들거나 고치지 못한다) —
 * 실제 git·sandbox-exec. 탐침 `review-probe-a.ts` 의 r4_* 사례를 옮겼다. 작업 폴더는 실제 홈 아래 임시 폴더다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { GITFILE_MAX_BYTES, SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const TASK = 'gitrv401-1111-2222-3333-444455556666';
const WT = `.openmake/worktrees/${TASK}`;
const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';
const REF = 'ref: refs/heads/main\n';

let tmp = '';
let outside = '';

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitr4-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitr4-out-'));
});
afterEach(() => {
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
function plain(rel = 'plain'): string {
    const root = path.join(tmp, rel);
    fs.mkdirSync(root, { recursive: true });
    return root;
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
const write = (p: string, content = 'x'): BridgeMsg => ({ kind: 'write', path: p, contentB64: Buffer.from(content).toString('base64') } as BridgeMsg);
const del = (p: string): BridgeMsg => ({ kind: 'delete', path: p } as BridgeMsg);
const exec = (command: string): BridgeMsg => ({ kind: 'exec', command } as BridgeMsg);
const denied = (p: string): BridgeResult => ({ ok: false, error: `${DENIED}${p}` });
const ok = { ok: true };
const fsmonitor = (marker: string): string => `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = "touch ${marker}; true #"\n`;
/** 사용자의 후속 git status — 심은 fsmonitor 가 돌았는가. */
function statusRan(cwd: string, marker: string): boolean {
    try { git(cwd, 'status'); } catch { /* 가짜 git 디렉터리라 실패해도 된다 */ }
    return fs.existsSync(marker);
}

describe('S1 — HEAD 가 이미 있는 폴더(연결 전부터)', () => {
    for (const layout of ['file', 'dangling-symlink', 'file+objects'] as const) {
        it(`루트 ${layout}: objects·refs 는 되지만 config 는 거절, 후속 git status 가 돌지 않는다`, async () => {
            const root = plain();
            if (layout === 'dangling-symlink') fs.symlinkSync('refs/heads/main', path.join(root, 'HEAD'));
            else fs.writeFileSync(path.join(root, 'HEAD'), REF);
            if (layout === 'file+objects') fs.mkdirSync(path.join(root, 'objects'));
            const core = makeCore(root);
            const marker = path.join(outside, 'fsmon');
            for (const p of ['objects/.keep', 'refs/heads/.keep']) expect(await run(core, write(p, ''))).toEqual(ok);
            expect(await run(core, write('config', fsmonitor(marker)))).toEqual(denied('config'));
            expect(statusRan(root, marker)).toBe(false);
        });
    }

    it('하위 폴더: sub/HEAD 가 이미 있으면 sub/config 거절, sub 에서 후속 git status 가 돌지 않는다', async () => {
        const root = plain();
        const sub = path.join(root, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'HEAD'), REF);
        const core = makeCore(root);
        const marker = path.join(outside, 'fsmon');
        for (const p of ['sub/objects/.keep', 'sub/refs/heads/.keep']) expect(await run(core, write(p, ''))).toEqual(ok);
        expect(await run(core, write('sub/config', fsmonitor(marker)))).toEqual(denied('sub/config'));
        expect(statusRan(sub, marker)).toBe(false);
    });

    (SANDBOX_ENABLED ? it : it.skip)('승인된 exec: 루트에 HEAD 만 있어도 연결 때 루트를 지킨다(프로파일 금지 줄)', async () => {
        const root = plain();
        fs.writeFileSync(path.join(root, 'HEAD'), REF);
        const core = makeCore(root, true);
        const r = await run(core, exec('echo x >> config && echo wrote'));
        expect(r).toMatchObject({ ok: true, stdout: '' });
        expect(r.exitCode).not.toBe(0);
        expect(fs.existsSync(path.join(root, 'config'))).toBe(false);
    });
});

describe('D-11 — 연결 뒤에 생긴 구조도 요청 시점에 본다', () => {
    it('연결 뒤 루트에 HEAD 가 생기면 config·hooks·commondir·비ASCII 이름 거절, HEAD 쓰기는 된다', async () => {
        const root = plain();
        fs.writeFileSync(path.join(root, '한글.md'), 'x\n');
        const core = makeCore(root);
        const marker = path.join(outside, 'fsmon');
        fs.writeFileSync(path.join(root, 'HEAD'), REF); // 다운로드·승인된 exec 등 다른 길로 생긴 것
        for (const p of ['objects/.keep', 'refs/heads/.keep']) expect(await run(core, write(p, ''))).toEqual(ok);
        for (const p of ['config', 'hooks/pre-commit', 'commondir', 'config.worktree', '한글2.md']) expect(await run(core, write(p, fsmonitor(marker)))).toEqual(denied(p));
        expect(await run(core, del('한글.md'))).toEqual(denied('한글.md'));
        expect(await run(core, write('HEAD', 'ref: refs/heads/x\n'))).toEqual(ok);
        expect(statusRan(root, marker)).toBe(false);
    });

    it('하위 폴더에서 config 먼저 → HEAD 나중: HEAD 를 새로 만들 수 없어 후속 git status 가 돌지 않는다', async () => {
        const root = plain();
        const core = makeCore(root);
        const marker = path.join(outside, 'fsmon');
        for (const p of ['sub/config', 'sub/objects/.keep', 'sub/refs/heads/.keep']) expect(await run(core, write(p, p.endsWith('config') ? fsmonitor(marker) : ''))).toEqual(ok);
        expect(await run(core, write('sub/HEAD', REF))).toEqual(denied('sub/HEAD'));
        expect(await run(core, write('sub/head', REF))).toEqual(denied('sub/head'));
        expect(fs.existsSync(path.join(root, 'sub', 'HEAD'))).toBe(false);
        expect(statusRan(path.join(root, 'sub'), marker)).toBe(false);
    });

    it('하위 폴더의 새 .git: .git 아래 무엇이든 거절, sub 에서 후속 git status 가 돌지 않는다', async () => {
        const root = plain();
        fs.mkdirSync(path.join(root, 'sub'));
        const core = makeCore(root);
        const marker = path.join(outside, 'fsmon');
        for (const p of ['sub/.git/HEAD', 'sub/.git/objects/.keep', 'sub/.git/refs/heads/.keep', 'sub/.git/config', 'sub/.GIT/config']) {
            expect(await run(core, write(p, p.endsWith('config') ? fsmonitor(marker) : REF))).toEqual(denied(p));
        }
        expect(await run(core, write('sub/.git', 'gitdir: ../store.git\n'))).toEqual(denied('sub/.git'));
        expect(statusRan(path.join(root, 'sub'), marker)).toBe(false);
    });

    it('믿는 레포의 .git 아래(HEAD·info·refs·objects)도 파일 kind 로 쓰거나 지울 수 없다', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        for (const p of ['.git/HEAD', '.git/info/exclude', '.git/refs/heads/x', '.git/objects/x', 'src/.git/config']) expect(await run(core, write(p, REF))).toEqual(denied(p));
        for (const p of ['.git', '.git/description']) expect(await run(core, del(p))).toEqual(denied(p));
    });

    it('HEAD 는 어느 폴더에서든 새로 만들거나 지울 수 없다(이미 있으면 내용은 쓴다 — 5차 T1)', async () => {
        const root = plain();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'HEAD'), 'old\n');
        const core = makeCore(root);
        for (const p of ['src/HEAD', 'src/head', 'src/HEAD/x']) expect(await run(core, write(p))).toEqual(denied(p));
        expect(await run(core, write('docs/HEAD', 'new\n'))).toEqual(ok);
        expect(await run(core, del('docs/HEAD'))).toEqual(denied('docs/HEAD'));
    });
});

describe('D-11 — 과한 차단 없음', () => {
    it('HEAD 없는 폴더: config·hooks·비ASCII·.github·.gitignore·.git2 는 그대로 된다', async () => {
        const root = plain();
        const core = makeCore(root);
        for (const p of ['config', 'hooks/x', '한글.md', 'src/config', 'src/hooks/x', '.github/x', '.gitignore', '.git2/config', 'sub/.gitkeep']) {
            expect(await run(core, write(p))).toEqual(ok);
        }
    });

    it('우연히 bare 꼴인 프로젝트(r4_coincidental_bare): 막히는 것은 HEAD 폴더 바로 아래 금지 이름·비ASCII 뿐', async () => {
        const root = plain();
        fs.writeFileSync(path.join(root, 'HEAD'), 'release notes\n');
        for (const d of ['objects', 'refs', 'config', 'src']) fs.mkdirSync(path.join(root, d));
        fs.writeFileSync(path.join(root, '한글.md'), 'x\n');
        const core = makeCore(root);
        for (const p of ['HEAD', 'a.txt', 'config/app.yml', 'src/한글.md', 'objects/한글.bin']) expect(await run(core, write(p))).toEqual(ok);
        for (const p of ['hooks/useThing.ts', 'commondir', '한글2.md', 'café.txt']) expect(await run(core, write(p))).toEqual(denied(p));
        expect(await run(core, del('한글.md'))).toEqual(denied('한글.md'));
    });
});

describe('S2 — omk-base 읽기 상한', () => {
    it('omk-base 가 GITFILE_MAX_BYTES 를 넘으면 기준점 없음(HEAD 기준)으로 본다', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        expect(await run(core, { kind: 'worktree', op: 'add', taskId: TASK } as BridgeMsg)).toMatchObject({ ok: true });
        // 형식은 맞는(가짜) sha 뒤에 공백을 붙여 상한을 넘긴다 — 읽으면 그 sha 로 diff 해 실패한다.
        const base = path.join(repo, '.git', 'worktrees', TASK, 'omk-base');
        fs.writeFileSync(base, `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef${' '.repeat(GITFILE_MAX_BYTES)}\n`);
        fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'changed\n');
        const d = await run(core, { kind: 'worktree', op: 'diff', taskId: TASK } as BridgeMsg);
        expect(d).toMatchObject({ ok: true });
        expect(d.stdout).toContain('+changed');
    }, 30000);
});
