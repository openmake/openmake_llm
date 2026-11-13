/**
 * PR-A 5차 리뷰(REVIEW_A_R5.md) T1 + 설계 D-11 규칙 3 개정(파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다) —
 * 실제 git·sandbox-exec. 탐침 `review-probe-a.ts` 의 r5_delete_head_commondir 사례를 옮겼다. 작업 폴더는 실제 홈 아래 임시 폴더다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';
const REF = 'ref: refs/heads/main\n';

let tmp = '';
let outside = '';

beforeEach(() => {
    const home = fs.realpathSync(os.userInfo().homedir);
    tmp = fs.mkdtempSync(path.join(home, '.omk-gitr5-'));
    outside = fs.mkdtempSync(path.join(home, '.omk-gitr5-out-'));
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
const ok = { ok: true };

type Layout = 'bare+sibling-worktree' | 'separate-gitdir+worktree' | 'bare-root+inner-worktree';
/**
 * 연결 폴더 `ws` 안에 "이름이 `.git` 이 아닌 common dir + linked worktree" 를 연결 전에 펴 둔다(탐침 r5_delete_head_commondir).
 * 돌려주는 것: common dir(연결 폴더 기준), 사용자가 git 을 돌리는 linked worktree, fsmonitor 를 심은 common config 내용.
 */
function layout(kind: Layout): { ws: string; common: string; userCwd: string; cfg: string; marker: string } {
    const seed = path.join(outside, 'seed');
    fs.mkdirSync(seed);
    git(seed, 'init', '-q');
    fs.writeFileSync(path.join(seed, 'a.txt'), 'base\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'base');
    const ws = path.join(tmp, 'ws');
    fs.mkdirSync(ws);
    let common = '';
    let userCwd = '';
    if (kind === 'bare+sibling-worktree') {
        git(ws, 'clone', '-q', '--bare', seed, 'repo.git');
        git(path.join(ws, 'repo.git'), 'worktree', 'add', '-q', '../main');
        [common, userCwd] = ['repo.git', 'main'];
    } else if (kind === 'separate-gitdir+worktree') {
        git(ws, 'clone', '-q', `--separate-git-dir=${path.join(ws, 'store.git')}`, seed, 'app');
        git(path.join(ws, 'app'), 'worktree', 'add', '-q', '../wt2');
        [common, userCwd] = ['store.git', 'wt2'];
    } else {
        git(ws, 'clone', '-q', '--bare', seed, '.');
        git(ws, 'worktree', 'add', '-q', 'wt');
        [common, userCwd] = ['.', 'wt'];
    }
    const marker = path.join(outside, 'fsmon');
    const cfg = `${fs.readFileSync(path.join(ws, common, 'config'), 'utf8')}[core]\n\tfsmonitor = "touch ${marker}; true #"\n`;
    return { ws, common, userCwd, cfg, marker };
}
/** 사용자가 linked worktree 에서 돌리는 git status — 심은 fsmonitor 가 돌았는가. */
function statusRan(cwd: string, marker: string): boolean {
    try { git(cwd, 'status', '--short'); } catch { /* 깨진 배치라 실패해도 된다 */ }
    return fs.existsSync(marker);
}

describe('T1 — 파일 kind 는 HEAD 항목의 유무를 바꾸지 못한다(D-11 규칙 3 개정)', () => {
    it.each(['bare+sibling-worktree', 'separate-gitdir+worktree'] as const)('%s: common/HEAD 지우기 거절, 이어서 common/config 거절, linked worktree 의 git status 가 돌지 않는다', async (kind) => {
        const { ws, common, userCwd, cfg, marker } = layout(kind);
        const core = makeCore(ws);
        const rel = (n: string): string => path.join(common, n);
        expect(await run(core, write(rel('config'), cfg))).toEqual(denied(rel('config')));
        expect(await run(core, del(rel('HEAD')))).toEqual(denied(rel('HEAD')));
        expect(fs.existsSync(path.join(ws, common, 'HEAD'))).toBe(true);
        expect(await run(core, write(rel('config'), cfg))).toEqual(denied(rel('config')));
        expect(statusRan(path.join(ws, userCwd), marker)).toBe(false);
    }, 30000);

    it('bare-root+inner-worktree: 연결 폴더 자신의 HEAD 지우기 거절 — 재연결 뒤에도 루트 config 를 쓸 수 없다', async () => {
        const { ws, userCwd, cfg, marker } = layout('bare-root+inner-worktree');
        expect(await run(makeCore(ws), del('HEAD'))).toEqual(denied('HEAD'));
        expect(await run(makeCore(ws), write('config', cfg))).toEqual(denied('config'));
        expect(statusRan(path.join(ws, userCwd), marker)).toBe(false);
    }, 30000);

    it('HEAD 가 있는 폴더: HEAD 내용 쓰기는 되고 HEAD 지우기(대소문자 무관)와 HEAD 를 품은 폴더째 지우기는 거절(6차 U1)', async () => {
        const root = path.join(tmp, 'plain');
        fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(root, 'sub', 'HEAD'), REF);
        const core = makeCore(root);
        expect(await run(core, write('sub/HEAD', 'ref: refs/heads/x\n'))).toEqual(ok);
        for (const p of ['sub/HEAD', 'sub/head']) expect(await run(core, del(p))).toEqual(denied(p));
        expect(fs.existsSync(path.join(root, 'sub', 'HEAD'))).toBe(true);
        expect(await run(core, del('sub'))).toEqual(denied('sub'));
        expect(fs.existsSync(path.join(root, 'sub', 'HEAD'))).toBe(true);
    });
});
