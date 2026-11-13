/**
 * 폴더 선택(`folder`)으로 고른 중첩 레포의 worktree 격리 — 지시서 PR-A-2 §2(회귀 수정).
 *
 * 여러 레포를 담은 상위 폴더를 연결하고 폴더를 골라 쓰는 것은 흔한 사용이다. `base` 의 git 이 연결 때 보관한 것과 다르면
 * (또는 보관한 git 이 없으면) 그 자리에서 base 의 git dir·common dir 를 다시 구해 **둘 다 연결 폴더 안일 때만** 그 값으로
 * 연산한다(design.md D-3 의 4번 배치). 하나라도 폴더 밖이면 거절. git 은 종전대로 도구 프로파일 + 고정 인자 안에서 돈다.
 *
 * 레포·표식은 실제 홈 아래 임시 폴더에 둔다 — 프로파일이 늘 여는 임시 경로 안이면 경계를 시험하지 못한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const TASK = 'gitnest1-1111-2222-3333-444455556666';
const WT = `.openmake/worktrees/${TASK}`;
const MISMATCH = 'git 디렉터리가 연결할 때와 달라 worktree 연산을 거부했습니다(폴더 재연결 필요).';

let tmp = '';
let outside = '';
let prof = '';

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitnest-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitnest-out-'));
    prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gitnest-prof-'));
});
afterEach(() => {
    for (const d of [tmp, outside, prof]) fs.rmSync(d, { recursive: true, force: true });
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

function makeCore(folder: string): BridgeCore {
    const core = new BridgeCore({ folder, confirm: async () => 'no', sandboxProfileDir: prof });
    core.prepare();
    return core;
}

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}
const wt = (op: string, folder: string): BridgeMsg => ({ kind: 'worktree', op, taskId: TASK, folder } as BridgeMsg);

/** add → 변경 → diff(변경이 보인다) → 되돌림 → remove(정리). */
async function lifecycle(core: BridgeCore, folder: string, repo: string): Promise<void> {
    expect(await run(core, wt('add', folder))).toMatchObject({ ok: true, worktreeRel: WT });
    expect(fs.readFileSync(path.join(repo, WT, 'a.txt'), 'utf8')).toBe('base\n');
    fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'changed\n');
    const d = await run(core, wt('diff', folder));
    expect(d).toMatchObject({ ok: true });
    expect(d.stdout).toContain('+changed');
    fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'base\n');
    expect(await run(core, wt('remove', folder))).toMatchObject({ ok: true, kept: false });
    expect(fs.existsSync(path.join(repo, WT))).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.openmake/');
}

describe('중첩 레포를 folder 로 골라도 worktree 격리가 된다', () => {
    it('레포가 아닌 폴더를 연결 + 하위 레포를 고른다', async () => {
        const root = path.join(tmp, 'ws');
        const repo = makeRepo('ws/proj');
        await lifecycle(makeCore(root), 'proj', repo);
    }, 30000);

    it('레포인 폴더를 연결 + 그 안 중첩 레포를 고른다(바깥 레포는 그대로)', async () => {
        const root = makeRepo('ws');
        const repo = makeRepo('ws/inner');
        await lifecycle(makeCore(root), 'inner', repo);
        expect(git(root, 'branch', '--list', 'omk-task/*').trim()).toBe('');
    }, 30000);

    it('중첩 레포의 .git 이 폴더 밖 레포를 가리키는 gitfile 이면 거절한다', async () => {
        const other = makeRepo('other');
        const root = path.join(tmp, 'ws');
        fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
        fs.writeFileSync(path.join(root, 'proj', '.git'), `gitdir: ${other}/.git\n`);
        const core = makeCore(root);
        expect(await run(core, wt('add', 'proj'))).toEqual({ ok: false, error: 'git 레포가 아닙니다' });
        expect(git(other, 'branch', '--list', 'omk-task/*').trim()).toBe('');
        // 레포인 연결 폴더 안이면 대조 거절 문구
        const root2 = makeRepo('ws2');
        fs.mkdirSync(path.join(root2, 'proj'));
        fs.writeFileSync(path.join(root2, 'proj', '.git'), `gitdir: ${other}/.git\n`);
        expect(await run(makeCore(root2), wt('add', 'proj'))).toEqual({ ok: false, error: MISMATCH });
    }, 30000);

    (SANDBOX_ENABLED ? it : it.skip)('중첩 레포에 fsmonitor·필터·훅을 심어도 폴더 밖 표식이 없다', async () => {
        const root = path.join(tmp, 'ws');
        const repo = makeRepo('ws/proj');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=x\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        const m = (n: string): string => path.join(outside, n);
        fs.appendFileSync(path.join(repo, '.git', 'config'), [
            '[core]', `\tfsmonitor = "touch ${m('fsmonitor')}; true #"`,
            '[filter "x"]', `\tclean = "sh -c 'touch ${m('clean')}; cat'"`, `\tsmudge = "sh -c 'touch ${m('smudge')}; cat'"`, '',
        ].join('\n'));
        fs.writeFileSync(path.join(repo, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${m('hook')}\n`, { mode: 0o755 });
        await lifecycle(makeCore(root), 'proj', repo);
        expect(fs.readdirSync(outside)).toEqual([]);
    }, 30000);

    it('E1c — 중첩 레포의 worktree .git 을 worktree 안 가짜 gitdir 로 돌려 두면 거절한다', async () => {
        const root = path.join(tmp, 'ws');
        const repo = makeRepo('ws/proj');
        const core = makeCore(root);
        expect(await run(core, wt('add', 'proj'))).toMatchObject({ ok: true });
        const fake = path.join(repo, WT, 'fake');
        for (const d of ['objects', 'refs/heads']) fs.mkdirSync(path.join(fake, d), { recursive: true });
        fs.writeFileSync(path.join(fake, 'HEAD'), 'ref: refs/heads/main\n');
        fs.writeFileSync(path.join(fake, 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = "touch ${path.join(outside, 'e1c')}; true #"\n`);
        fs.writeFileSync(path.join(repo, WT, '.git'), 'gitdir: ./fake\n');
        expect(await run(core, wt('diff', 'proj'))).toEqual({ ok: false, error: MISMATCH });
        expect(await run(core, wt('remove', 'proj'))).toEqual({ ok: false, error: MISMATCH });
        expect(fs.readdirSync(outside)).toEqual([]);
    }, 30000);
});
