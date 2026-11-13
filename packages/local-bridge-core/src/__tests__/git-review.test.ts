/**
 * PR-A 리뷰(REVIEW_A.md) F1~F8 — 실제 sandbox-exec·git. 탐침 `review-probe-a.ts` 의 사례를 옮겼다.
 * 레포·표식은 실제 홈 아래 임시 폴더(프로파일이 늘 여는 임시 경로 밖), 프로파일 폴더는 CLI 와 같은 `os.tmpdir()` 아래다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import { detectGit } from '../git-trust';
import type { BridgeMsg, BridgeResult } from '../types';

// jest 의 process.env 는 사본이라 os.homedir()(libuv 는 실제 환경을 읽는다)가 HOME 을 따라오게 한다(conformance-exec 와 같다).
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const TASK = 'gitrev01-1111-2222-3333-444455556666';
const WT = `.openmake/worktrees/${TASK}`;

let tmp = '';
let outside = '';
let prof = '';

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitrev-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitrev-out-'));
    prof = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gitrev-prof-')));
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
function makeRepo(rel: string, init: string[] = []): string {
    const repo = path.join(tmp, rel);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', ...init);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    return repo;
}
function makeCore(folder: string, approve = false): BridgeCore {
    const core = new BridgeCore({ folder, confirm: async () => (approve ? 'yes' : 'no'), sandboxProfileDir: prof });
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
const exec = (command: string): BridgeMsg => ({ kind: 'exec', command } as BridgeMsg);
const appendConfig = (repo: string, text: string): void => { fs.appendFileSync(path.join(repo, '.git', 'config'), text); };

const sbDescribe = SANDBOX_ENABLED ? describe : describe.skip;

sbDescribe('F1 — 프로파일은 파일로 넘기지 않는다(확인 없는 자식이 덮어쓸 수 없다)', () => {
    it('연결해도 프로파일 폴더에 아무 파일도 쓰지 않는다', () => {
        makeCore(makeRepo('repo'));
        expect(fs.readdirSync(prof)).toEqual([]);
    });

    it('add 의 smudge 가 프로파일 폴더의 파일을 (allow default) 로 덮어써도 다음 diff 의 clean 은 샌드박스 안이다', async () => {
        const repo = makeRepo('repo');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=x\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        // git config 따옴표 값 안 — 큰따옴표는 \" 로(탐침 p1 과 같은 글자).
        const overwrite = `for f in ${prof}/*; do echo \\"(version 1)(allow default)\\" > $f; done; cat`;
        appendConfig(repo, `[filter "x"]\n\tsmudge = "sh -c '${overwrite}'"\n\tclean = "sh -c 'touch ${path.join(outside, 'clean')}; cat'"\n`);
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'changed\n');
        expect(await run(core, wt('diff'))).toMatchObject({ ok: true });
        expect(fs.readdirSync(outside)).toEqual([]);
    }, 30000);

    it('프로파일 텍스트를 만들지 못하면(홈 realpath 실패) 종전과 같은 126 거절', async () => {
        const repo = makeRepo('repo');
        const saved = process.env.HOME;
        process.env.HOME = path.join(tmp, 'no-such-home');
        let core: BridgeCore;
        try { core = makeCore(repo, true); } finally { process.env.HOME = saved; }
        const r = await run(core!, exec('echo ran'));
        expect(r).toMatchObject({ ok: false, exitCode: 126 });
        expect(r.error).toContain('샌드박스 프로파일을 준비하지 못해');
        expect(await run(core!, wt('add'))).toMatchObject({ ok: false, exitCode: 126 });
    }, 30000);

    it('긴 경로(프로파일 수 KB)도 -p 로 넘긴다', async () => {
        // 구성 요소 하나 255바이트·전체 1024바이트(PATH_MAX) 아래에서 길게 — 프로파일에 루트가 여러 번 들어가 수 KB 가 된다.
        const deep = path.join(tmp, ...Array.from({ length: 4 }, (_, i) => `${'긴폴더'.repeat(18)}-${i}`));
        fs.mkdirSync(deep, { recursive: true });
        const repo = makeRepo(path.relative(tmp, path.join(deep, 'repo')));
        const core = makeCore(repo, true);
        expect(await run(core, exec('echo ok > inside.txt && cat inside.txt'))).toMatchObject({ ok: true, exitCode: 0, stdout: 'ok\n' });
        expect((await run(core, exec(`echo x > ${JSON.stringify(path.join(outside, 'x'))}`))).exitCode).not.toBe(0);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
    }, 30000);
});

sbDescribe('F2 — 탐지가 null 이어도 연결 폴더의 .git 디렉터리는 보호한다', () => {
    it('.git/HEAD 를 깨 탐지를 실패시킨 뒤 재연결해도 config·hooks 를 못 쓴다(파일 kind·exec)', async () => {
        const repo = makeRepo('repo');
        const before = fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8');
        expect(await run(makeCore(repo), write('.git/HEAD', 'garbage\n'))).toEqual({ ok: true });
        expect(detectGit(repo)).toBeNull();
        const core = makeCore(repo, true);
        expect((await run(core, write('.git/config', '[core]\n\tfsmonitor = x\n'))).ok).toBe(false);
        expect((await run(core, write('.git/hooks/pre-commit', '#!/bin/sh\n'))).ok).toBe(false);
        expect((await run(core, write('.git/commondir', '../x\n'))).ok).toBe(false);
        expect((await run(core, exec('echo x >> .git/config && echo wrote'))).exitCode).not.toBe(0);
        expect((await run(core, exec('mv .git .g2 && echo moved'))).exitCode).not.toBe(0);
        expect(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8')).toBe(before);
        // 믿지 않으므로 worktree 는 여전히 거절
        expect(await run(core, wt('add'))).toEqual({ ok: false, error: 'git 레포가 아닙니다' });
    }, 30000);
});

describe('F3 — 파일 kind 가드는 대소문자를 접어서 본다', () => {
    it('.git/COMMONDIR·.git/Config.Worktree 쓰기 거절', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        expect((await run(core, write('.git/COMMONDIR', '../x\n'))).ok).toBe(false);
        expect((await run(core, write('.git/Config.Worktree', 'x'))).ok).toBe(false);
        expect(fs.readdirSync(path.join(repo, '.git')).map((n) => n.toLowerCase())).not.toContain('commondir');
    });

    it('hooks 폴더가 없는 레포: .git/HOOKS/pre-commit 쓰기 거절', async () => {
        const repo = makeRepo('repo', ['--template=']);
        expect(fs.existsSync(path.join(repo, '.git', 'hooks'))).toBe(false);
        const core = makeCore(repo);
        expect((await run(core, write('.git/HOOKS/pre-commit', '#!/bin/sh\n'))).ok).toBe(false);
        expect(fs.existsSync(path.join(repo, '.git', 'hooks'))).toBe(false);
    });
});

sbDescribe('F4 — config.worktree, linked 배치의 worktrees 이름 바꾸기', () => {
    it('일반 레포: config.worktree 를 파일 kind·exec 로 못 쓴다', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo, true);
        expect((await run(core, write('.git/config.worktree', '[core]\n\tfsmonitor = x\n'))).ok).toBe(false);
        expect((await run(core, exec('echo x > .git/config.worktree && echo wrote'))).exitCode).not.toBe(0);
        expect(fs.existsSync(path.join(repo, '.git', 'config.worktree'))).toBe(false);
    }, 30000);

    it('linked worktree: worktrees 이름 바꾸기·자기·common 의 config.worktree 막힘, add·commit 은 된다', async () => {
        const repo = makeRepo('repo');
        const lw = path.join(tmp, 'lw');
        git(repo, 'worktree', 'add', '-q', lw, '-b', 'lw');
        const common = path.join(repo, '.git');
        const core = makeCore(lw, true);
        for (const cmd of [
            `mv ${JSON.stringify(path.join(common, 'worktrees'))} ${JSON.stringify(path.join(common, 'w2'))} && echo moved`,
            `echo x > ${JSON.stringify(path.join(common, 'worktrees', 'lw', 'config.worktree'))} && echo wrote`,
            `echo x > ${JSON.stringify(path.join(common, 'config.worktree'))} && echo wrote`,
        ]) expect((await run(core, exec(cmd))).exitCode).not.toBe(0);
        expect(fs.existsSync(path.join(common, 'worktrees', 'lw'))).toBe(true);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        fs.writeFileSync(path.join(lw, 'a.txt'), 'lw\n');
        const c = await run(core, exec('git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw && echo committed'));
        expect(c).toMatchObject({ exitCode: 0, stdout: 'committed\n' });
    }, 30000);
});

sbDescribe('F5 — omk-base 는 심링크를 따라 쓰거나 읽지 않는다', () => {
    it('add 도중 smudge 가 omk-base 를 폴더 밖 파일 심링크로 두어도 밖 파일은 그대로', async () => {
        const repo = makeRepo('repo');
        const victim = path.join(outside, 'victim');
        fs.writeFileSync(victim, 'orig\n');
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=x\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        const meta = path.join(repo, '.git', 'worktrees', TASK);
        appendConfig(repo, `[filter "x"]\n\tsmudge = "sh -c 'ln -sf ${victim} ${meta}/omk-base; cat'"\n\tclean = cat\n`);
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        expect(fs.readFileSync(victim, 'utf8')).toBe('orig\n');
    }, 30000);

    it('omk-base 가 심링크면 읽지 않는다(HEAD 기준으로 떨어진다)', async () => {
        const repo = makeRepo('repo');
        const core = makeCore(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        const victim = path.join(outside, 'sha');
        fs.writeFileSync(victim, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
        const base = path.join(repo, '.git', 'worktrees', TASK, 'omk-base');
        fs.rmSync(base);
        fs.symlinkSync(victim, base);
        fs.writeFileSync(path.join(repo, WT, 'a.txt'), 'changed\n');
        const d = await run(core, wt('diff'));
        expect(d).toMatchObject({ ok: true });
        expect(d.stdout).toContain('+changed');
    }, 30000);
});

describe('F6 — 연결 경로의 대소문자가 디스크와 달라도 git 을 믿고 보호한다', () => {
    /** 홈의 볼륨이 대소문자를 무시하는가(macOS 기본). */
    const caseInsensitive = ((): boolean => {
        const d = fs.mkdtempSync(path.join(fs.realpathSync(os.userInfo().homedir), '.omk-CaseProbe-'));
        try { return fs.existsSync(d.toLowerCase().replace(/^.*\/\.omk-caseprobe-/, `${path.dirname(d)}/.omk-caseprobe-`)); } finally { fs.rmSync(d, { recursive: true, force: true }); }
    })();
    (caseInsensitive ? it : it.skip)('…/Repo 를 …/repo 로 연결', async () => {
        const repo = makeRepo('Repo');
        const lower = path.join(tmp, 'repo');
        const core = makeCore(lower);
        expect(core.folderRoot).toBe(repo);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true });
        expect((await run(core, write('.git/config', 'x'))).ok).toBe(false);
    }, 30000);
});

describe('F8 — 실패 정리는 그 worktree 만 치운다(레포 전체 prune 을 하지 않는다)', () => {
    it('사용자의 다른 끊긴 worktree 등록은 남는다', async () => {
        const repo = makeRepo('repo');
        const away = path.join(tmp, 'away');
        git(repo, 'worktree', 'add', '-q', away, '-b', 'away');
        fs.renameSync(away, path.join(tmp, 'away-moved')); // 분리된 볼륨처럼 폴더가 안 보인다
        fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=bad\n');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'attrs');
        appendConfig(repo, '[filter "bad"]\n\tsmudge = false\n\tclean = cat\n\trequired = true\n');
        const core = makeCore(repo);
        expect((await run(core, wt('add'))).ok).toBe(false);
        expect(fs.existsSync(path.join(repo, '.git', 'worktrees', 'away'))).toBe(true);
        expect(fs.existsSync(path.join(repo, WT))).toBe(false);
        expect(git(repo, 'branch', '--list', 'omk-task/*').trim()).toBe('');
    }, 30000);

    it('이 작업 자리에 폴더 없는 등록이 남아 있어도 정리 뒤 다음 add 가 된다', async () => {
        const repo = makeRepo('repo');
        git(repo, 'worktree', 'add', '-q', path.join(repo, WT), '-b', 'stale');
        fs.rmSync(path.join(repo, WT), { recursive: true, force: true });
        const core = makeCore(repo);
        const first = await run(core, wt('add'));
        expect(first.ok).toBe(false); // git: "missing but already registered worktree"
        expect(first.error).toMatch(/^worktree 생성 실패: /);
        expect(await run(core, wt('add'))).toMatchObject({ ok: true, worktreeRel: WT });
    }, 30000);
});
