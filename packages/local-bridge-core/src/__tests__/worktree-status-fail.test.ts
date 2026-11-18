/** worktree remove — status 가 실패하면(출력 상한·시간 초과 포함) 지우지 않는다(설계 2026-11-18 ignored-cleanup K4·F2). */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { detectGit } from '../git-trust';
import { buildSandboxProfile } from '../sandbox';
import { handleWorktree } from '../worktree';
import type { BridgeMsg, BridgeResult } from '../types';

// status 호출만 실패시키고 나머지 git 은 그대로 돌린다(내장 모듈 속성은 spyOn 으로 바꿀 수 없다).
const failStatus = { on: false };
jest.mock('child_process', () => {
    const actual = jest.requireActual<typeof import('child_process')>('child_process');
    type Cb = (e: Error | null, o: string | Buffer, e2: string | Buffer) => void;
    const execFile = jest.fn((file: string, args: string[], opts: import('child_process').ExecFileOptions, cb: Cb) => {
        if (failStatus.on && args.includes('status')) {
            setImmediate(() => cb(Object.assign(new Error('maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), '', ''));
            return undefined;
        }
        return actual.execFile(file, args, opts, cb);
    });
    return { ...actual, execFile };
});

const TASK = 'ddddeeee-1111-2222-3333-444455556666';
const git = (args: string[], cwd: string): string => childProcess.execFileSync('git', args, { cwd, encoding: 'utf8' });

function run(m: BridgeMsg, base: string): Promise<BridgeResult> {
    const root = fs.realpathSync.native(base);
    const g = detectGit(root);
    const ctx = { root, git: g, profile: SANDBOX_ENABLED ? buildSandboxProfile(root, g, true) : undefined };
    return new Promise((resolve, reject) => { handleWorktree(m, resolve, base, ctx).catch(reject); });
}

let repo = '';
beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-wtfail-'));
    git(['init', '-q'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    git(['add', '.'], repo);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], repo);
});
afterEach(() => { failStatus.on = false; fs.rmSync(repo, { recursive: true, force: true }); });

it('status 가 실패하면 보존하고 worktree remove 를 부르지 않는다', async () => {
    const add = await run({ kind: 'worktree', op: 'add', taskId: TASK }, repo);
    const wt = path.join(repo, add.worktreeRel!);
    failStatus.on = true;
    (childProcess.execFile as unknown as jest.Mock).mockClear();
    const r = await run({ kind: 'worktree', op: 'remove', taskId: TASK }, repo);
    expect(r).toStrictEqual({ ok: true, kept: true, branch: `omk-task/${TASK.slice(0, 8)}` });
    expect(fs.existsSync(wt)).toBe(true);
    const calls = (childProcess.execFile as unknown as jest.Mock).mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((a) => a.includes('status'))).toBe(true);
    expect(calls.some((a) => a.includes('worktree remove'))).toBe(false);
});
