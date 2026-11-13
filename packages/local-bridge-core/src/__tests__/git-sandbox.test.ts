/**
 * 확인 없이 도는 worktree git 이 OS 경계 안에 있는가 — 설계 2026-11-14-bridge-unconfirmed-exec D-1~D-4(PR-A).
 *
 * 실측 결함(2026-11-14): ① 파일 쓰기만으로 worktree 의 `.git` 을 가짜 git 디렉터리로 돌려 두면 `worktree diff` 의
 * `git add -A -N .` 이 가짜 설정(core.fsmonitor)을 **샌드박스 밖에서** 실행했다(E1c). ② exec 로 `.git` 을 옮겼다 되돌리면
 * config 쓰기 금지가 빗나갔다(E2). ③ 파일 kind 는 `.git/config` 를 그대로 고칠 수 있었다.
 *
 * "폴더 밖" 표식과 레포는 실제 홈(`os.userInfo().homedir`) 아래 임시 폴더에 둔다 — 프로파일이 늘 여는 임시·캐시 경로
 * (`/private/var/folders` 등) 안이면 그 허용 줄이 쓰기를 열어 경계를 시험하지 못한다(사용자 레포도 보통 홈 아래다).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const TASK = 'gitsb001-1111-2222-3333-444455556666';
const WT = `.openmake/worktrees/${TASK}`;
const MISMATCH = 'git 디렉터리가 연결할 때와 달라 worktree 연산을 거부했습니다(폴더 재연결 필요).';

let tmp = '';
let outside = '';
let prof = '';

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitsb-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitsb-out-'));
    prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gitsb-prof-'));
});
afterEach(() => {
    for (const d of [tmp, outside, prof]) fs.rmSync(d, { recursive: true, force: true });
});

/** 사용자 설정이 끼어들지 않는 git(테스트 준비용 — 코어가 띄우는 git 이 아니다). */
function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
    });
}

/** 커밋 하나가 있는 레포. */
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
    const core = new BridgeCore({ folder, confirm: async () => 'no', sandboxProfileDir: prof, autoApproveAll: true });
    core.prepare();
    return core;
}

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}
const wt = (op: string): BridgeMsg => ({ kind: 'worktree', op, taskId: TASK } as BridgeMsg);
const write = (p: string, content: string): BridgeMsg => ({ kind: 'write', path: p, contentB64: Buffer.from(content).toString('base64') } as BridgeMsg);

/** 폴더 밖에 아무 표식도 생기지 않았다. */
function expectNoEscape(): void {
    expect(fs.readdirSync(outside)).toEqual([]);
}

const sbDescribe = SANDBOX_ENABLED ? describe : describe.skip;

sbDescribe('E1c — 파일 쓰기로 만든 가짜 git 디렉터리가 worktree diff 에서 실행되지 않는다', () => {
    function plantFakeGitDir(): Record<string, string> {
        const marker = path.join(outside, 'e1c-fsmonitor');
        return {
            [`${WT}/fake/HEAD`]: 'ref: refs/heads/main\n',
            [`${WT}/fake/objects/.keep`]: '',
            [`${WT}/fake/refs/heads/.keep`]: '',
            [`${WT}/fake/config`]: `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = "touch ${marker}; true #"\n`,
        };
    }

    it('파일 kind 로 worktree 의 .git 을 덮어쓰지 못한다', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        for (const [p, c] of Object.entries(plantFakeGitDir())) expect(await run(core, write(p, c))).toEqual({ ok: true });
        const r = await run(core, write(`${WT}/.git`, 'gitdir: ./fake\n'));
        expect(r.ok).toBe(false);
        expect(fs.readFileSync(path.join(repo, WT, '.git'), 'utf8')).toContain('.git/worktrees/');
        expect(await run(core, wt('diff'))).toMatchObject({ ok: true });
        expectNoEscape();
    }, 30000);

    it('가드를 지나 디스크에 만들어 둔 가짜 .git 이면 git 을 띄우지 않고 거절한다', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        for (const [p, c] of Object.entries(plantFakeGitDir())) {
            fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
            fs.writeFileSync(path.join(repo, p), c);
        }
        fs.writeFileSync(path.join(repo, WT, '.git'), 'gitdir: ./fake\n');
        expect(await run(core, wt('diff'))).toEqual({ ok: false, error: MISMATCH });
        expect(await run(core, wt('remove'))).toEqual({ ok: false, error: MISMATCH });
        expectNoEscape();
    }, 30000);
});

sbDescribe('레포에 심어 둔 core.fsmonitor·clean/smudge 필터 — add·diff·remove 가 폴더 밖에 쓰지 못한다', () => {
    it('add·diff·remove', async () => {
        const repo = makeRepo('repo');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=x\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        const m = (n: string): string => path.join(outside, n);
        fs.appendFileSync(path.join(repo, '.git', 'config'), [
            '[core]', `\tfsmonitor = "touch ${m('fsmonitor')}; true #"`,
            '[filter "x"]', `\tclean = "sh -c 'touch ${m('clean')}; cat'"`, `\tsmudge = "sh -c 'touch ${m('smudge')}; cat'"`, '',
        ].join('\n'));
        fs.writeFileSync(path.join(repo, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${m('hook')}\n`, { mode: 0o755 });
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'changed\n');
        const d = await run(core, wt('diff'));
        expect(d).toMatchObject({ ok: true });
        expect(d.stdout).toContain('+changed');
        fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'base\n');
        expect(await run(core, wt('remove'))).toMatchObject({ ok: true, kept: false });
        expectNoEscape();
    }, 30000);
});

sbDescribe('E2 — git 디렉터리 금지 경로', () => {
    it('exec 로 .git 을 옮길 수 없다(옮겼다 되돌려 config 금지를 우회하던 길)', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        const r = await run(core, { kind: 'exec', command: 'mv .git .g2 && echo moved' } as BridgeMsg);
        expect(r.ok).toBe(true);
        expect(r.exitCode).not.toBe(0);
        expect(r.stdout).not.toContain('moved');
        expect(fs.statSync(path.join(repo, '.git')).isDirectory()).toBe(true);
    }, 30000);

    it('파일 kind 로 .git/config·.git/hooks/x 를 쓰거나 .git 을 지울 수 없다', async () => {
        const repo = makeRepo('repo');
        const before = fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8');
        const core = makeCore(repo);
        expect((await run(core, write('.git/config', '[core]\n\tfsmonitor = x\n'))).ok).toBe(false);
        expect((await run(core, write('.git/hooks/x', '#!/bin/sh\n'))).ok).toBe(false);
        expect((await run(core, write('.git', 'gitdir: /x\n'))).ok).toBe(false);
        expect((await run(core, { kind: 'delete', path: '.git' } as BridgeMsg)).ok).toBe(false);
        expect((await run(core, { kind: 'delete', path: '.git/hooks' } as BridgeMsg)).ok).toBe(false);
        expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'x'))).toBe(false);
        expect(fs.existsSync(path.join(repo, '.git', 'hooks'))).toBe(true);
        // 심링크로 돌아가도 실제 경로로 본다.
        fs.symlinkSync('.git/config', path.join(repo, 'cfg-link'));
        expect((await run(core, write('cfg-link', 'x'))).ok).toBe(false);
        expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).toBe(before);
        // 그 밖의 .git 안 파일·일반 파일은 그대로 쓴다.
        expect(await run(core, write('b.txt', 'b'))).toEqual({ ok: true });
    }, 30000);

    it('commondir 를 쓸 수 없다 — exec·파일 kind 둘 다(사용자의 후속 git 이 가짜 common dir 설정을 읽게 하는 길)', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        const r = await run(core, { kind: 'exec', command: 'echo ../evil > .git/commondir && echo wrote' } as BridgeMsg);
        expect(r.exitCode).not.toBe(0);
        expect(r.stdout).not.toContain('wrote');
        expect((await run(core, write('.git/commondir', '../evil\n'))).ok).toBe(false);
        expect(fs.existsSync(path.join(repo, '.git', 'commondir'))).toBe(false);
    }, 30000);

    it('linked worktree 연결: 자기 git dir 의 commondir 도 못 쓰고, worktree add·exec commit 은 그대로 된다', async () => {
        const repo = makeRepo('repo');
        const lw = path.join(tmp, 'lw');
        git(repo, 'worktree', 'add', '-q', lw, '-b', 'lw');
        const own = path.join(repo, '.git', 'worktrees', 'lw', 'commondir');
        const before = fs.readFileSync(own, 'utf8');
        const core = makeCore(lw);
        const e = await run(core, { kind: 'exec', command: `echo x > ${JSON.stringify(own)} && echo wrote` } as BridgeMsg);
        expect(e.stdout).not.toContain('wrote');
        expect(fs.readFileSync(own, 'utf8')).toBe(before);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        fs.writeFileSync(path.join(lw, 'a.txt'), 'lw change\n');
        const c = await run(core, { kind: 'exec', command: 'git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw2 && echo committed' } as BridgeMsg);
        expect(c).toMatchObject({ ok: true, exitCode: 0, stdout: 'committed\n' });
    }, 30000);

    it('git 이 없는(레포 아님) 폴더도 루트 .git 의 config 는 이름으로 막고 그 밖은 쓴다(리뷰 N1)', async () => {
        const plain = path.join(tmp, 'plain');
        fs.mkdirSync(plain);
        const core = makeCore(plain);
        expect(await run(core, write('.git/config', 'x'))).toMatchObject({ ok: false });
        expect(await run(core, write('.git/HEAD', 'x'))).toEqual({ ok: true });
        expect(await run(core, write('sub/.git/config', 'x'))).toEqual({ ok: true });
    });
});

sbDescribe('D-3 — linked worktree 를 연결해도 git 쓰기가 된다(E5)', () => {
    it('worktree add 성공 + exec git commit 성공', async () => {
        const repo = makeRepo('repo');
        git(repo, 'worktree', 'add', '-q', path.join(tmp, 'lw'), '-b', 'lw');
        const lw = path.join(tmp, 'lw');
        const core = makeCore(lw);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true, worktreeRel: WT });
        fs.writeFileSync(path.join(lw, 'a.txt'), 'lw change\n');
        const c = await run(core, { kind: 'exec', command: 'git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw-commit && echo committed' } as BridgeMsg);
        expect(c).toMatchObject({ ok: true, exitCode: 0 });
        expect(c.stdout).toContain('committed');
        expect(git(lw, 'log', '-1', '--format=%s').trim()).toBe('lw-commit');
        // 공통 git 디렉터리의 config 는 여전히 못 쓴다.
        const e = await run(core, { kind: 'exec', command: `echo x >> ${JSON.stringify(path.join(repo, '.git', 'config'))}` } as BridgeMsg);
        expect(e.exitCode).not.toBe(0);
    }, 30000);
});

sbDescribe('worktree add 실패 뒤 남은 것을 치운다(다음 요청이 "재개"로 오인하지 않게)', () => {
    it('실패하는 필수 필터 — 폴더·메타·브랜치가 남지 않고, 다시 보내도 같은 실패', async () => {
        const repo = makeRepo('repo');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=bad\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        fs.appendFileSync(path.join(repo, '.git', 'config'), '[filter "bad"]\n\tsmudge = false\n\tclean = cat\n\trequired = true\n');
        const core = makeCore(repo);
        const first = await run(core, wt('add'));
        expect(first.ok).toBe(false);
        expect(first.error).toMatch(/^worktree 생성 실패: /);
        expect(fs.existsSync(path.join(repo, WT))).toBe(false);
        expect(git(repo, 'branch', '--list', 'omk-task/*').trim()).toBe('');
        expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
        const second = await run(core, wt('add'));
        expect(second.ok).toBe(false);
        expect(second.error).toMatch(/smudge/);
    }, 30000);

    it('이미 있던 같은 이름 브랜치는 지우지 않는다', async () => {
        const repo = makeRepo('repo');
        git(repo, 'branch', `omk-task/${TASK.slice(0, 8)}`);
        const core = makeCore(repo);
        expect((await run(core, wt('add'))).ok).toBe(false);
        expect(git(repo, 'branch', '--list', 'omk-task/*').trim()).toBe(`omk-task/${TASK.slice(0, 8)}`);
    }, 30000);
});

describe('M3 — info/exclude 가 심링크면 제외 등록을 건너뛴다', () => {
    it('git 디렉터리 안쪽을 가리키는 심링크(→ config)도 따라가지 않는다', async () => {
        const repo = makeRepo('repo');
        fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
        fs.rmSync(path.join(repo, '.git', 'info', 'exclude'), { force: true });
        fs.symlinkSync('../config', path.join(repo, '.git', 'info', 'exclude'));
        const before = fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8');
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).toBe(before);
    }, 30000);

    it('info 폴더가 심링크여도 건너뛴다', async () => {
        const repo = makeRepo('repo');
        fs.rmSync(path.join(repo, '.git', 'info'), { recursive: true, force: true });
        fs.mkdirSync(path.join(repo, '.git', 'i2'));
        fs.symlinkSync('i2', path.join(repo, '.git', 'info'));
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        expect(fs.existsSync(path.join(repo, '.git', 'i2', 'exclude'))).toBe(false);
    }, 30000);
});
