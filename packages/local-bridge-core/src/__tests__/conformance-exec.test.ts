/**
 * 적합성 fixture TS 러너 — exec·worktree 계열 suite(exec-gate·exec-path·worktree). 같은 fixture 를 Rust 러너
 * (apps/openmake-code/crates/omk-bridge-core/tests/conformance/exec_*.rs·worktree.rs)도 통과해야 한다.
 * suite 목록·사례 id·알려진 차이 자리는 conformance.test.ts 가 본다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeCore } from '../core';
import { TASK_ID_RE } from '../constants';
import { resolveExecPath } from '../exec-path';
import { detectGit, type GitPaths } from '../git-trust';
import type { BridgeMsg, BridgeResult } from '../types';
import {
    COMPARES, SETUP_KINDS, applyOpStep, applySetup, checkAfter, childEnv, exec, fakeBin, fill, load, makeTmp, nonEmpty,
    runnerEnv, shape, shapeAfter, view, withEnv, withPlatform,
    type After, type OpStep, type Setup,
} from './conformance-exec-support';

// jest 는 테스트 파일마다 process.env 를 사본으로 줘 실제 환경이 바뀌지 않는다 — os.homedir()(libuv 는 실제 환경의
// HOME 을 읽는다)가 사례의 가짜 홈을 따라오게 한다. 헬퍼 프로세스에서 HOME 을 바꾼 것과 같은 결과다.
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

type Answer = 'yes' | 'all' | 'no';
type Asked = { command: string; taskId: unknown; base: string };
type ReqStep = {
    msg: BridgeMsg; confirm?: Answer; asked: boolean; askedWith?: Asked; expect: Record<string, unknown>; compare?: string;
    after?: After[]; autoApproved?: number; divergence?: string; rustExpect?: unknown;
};
type GateStep = ReqStep | { clearAutoApprove: true; autoApproved: number } | { parallel: ReqStep[]; answerOrder: number[]; autoApproved: number };
type GateCase = { id: string; setup: Setup[]; root: string; autoApproveAll?: boolean; steps: GateStep[]; changes: number[] };
type Case<I, E> = { id: string; input: I; expect: E };

const REQ_KEYS = ['msg', 'asked', 'expect'];
const REQ_OPTIONAL = ['confirm', 'askedWith', 'compare', 'after', 'divergence', 'rustExpect'];

function shapeSetup(setup: unknown, at: string): void {
    expect({ at, setupArray: Array.isArray(setup) }).toEqual({ at, setupArray: true });
    for (const s of setup as Record<string, unknown>[]) {
        const kind = SETUP_KINDS.find((k) => k in s);
        expect({ at, setupKind: kind ?? Object.keys(s) }).toEqual({ at, setupKind: kind });
        if (kind === 'dir') shape(s, ['dir'], [], `${at}/setup`);
        if (kind === 'file') shape(s, ['file'], ['content', 'contentB64', 'repeat'], `${at}/setup`);
        if (kind === 'git') shape(s, ['git', 'cwd'], [], `${at}/setup`);
        if (kind === 'symlink') shape(s, ['symlink', 'target'], [], `${at}/setup`);
    }
}
function shapeReq(r: Record<string, unknown>, at: string, withCount: boolean): void {
    shape(r, REQ_KEYS, [...REQ_OPTIONAL, ...(withCount ? ['autoApproved'] : [])], at);
    if (withCount) expect({ at, autoApproved: typeof r.autoApproved }).toEqual({ at, autoApproved: 'number' });
    if (r.compare !== undefined) expect(COMPARES.slice(0, 3)).toContain(r.compare);
    if (r.after !== undefined) shapeAfter(r.after, at);
    if (r.confirm !== undefined) expect(['yes', 'all', 'no']).toContain(r.confirm);
    if (r.askedWith !== undefined) shape(r.askedWith, ['command', 'taskId', 'base'], [], `${at}/askedWith`);
    shapeCompareValues(r, at);
}
/** compare 가 보는 기대값은 비어 있지 않아야 한다 — 빈 목록·빈 글자는 무엇이 와도 통과한다(`stdoutLacks` 의 빈 목록은 정당). */
function shapeCompareValues(r: Record<string, unknown>, at: string): void {
    const nonEmptyStr = (v: unknown): boolean => typeof v === 'string' && v !== '';
    for (const key of ['expect', 'rustExpect']) {
        const w = r[key];
        if (typeof w !== 'object' || w === null || Array.isArray(w)) continue;
        const o = w as Record<string, unknown>;
        for (const k of ['stdoutHas', 'stdoutContains']) {
            if (!(k in o)) continue;
            const v = o[k];
            const ok = Array.isArray(v) && v.length > 0 && v.every(nonEmptyStr);
            expect({ at: `${at}/${key}`, [k]: ok }).toEqual({ at: `${at}/${key}`, [k]: true });
        }
        if ('errorPrefix' in o) expect({ at: `${at}/${key}`, errorPrefix: nonEmptyStr(o.errorPrefix) }).toEqual({ at: `${at}/${key}`, errorPrefix: true });
    }
}
/** answerOrder 는 asked: true 인 번호를 정확히 한 번씩 담는다 — 빠지면 그 물음은 답을 못 받아 러너가 멈춘다. */
function shapeAnswerOrder(s: { parallel: ReqStep[]; answerOrder: unknown }, at: string): void {
    const asked = s.parallel.flatMap((r, i) => (r.asked === true ? [i] : []));
    const order = Array.isArray(s.answerOrder) ? [...(s.answerOrder as unknown[])].sort((a, b) => Number(a) - Number(b)) : s.answerOrder;
    expect({ at, answerOrder: order }).toEqual({ at, answerOrder: asked });
}

describe('fixture 모양 — 묶음 이름·키 허용 목록·빈 목록', () => {
    it('exec-gate', () => {
        const doc = load<Record<string, unknown>>('exec-gate');
        shape(doc, ['suite', 'version', 'cases', 'sandboxEnabled', 'autoApproveEnv', 'failClosed'], [], 'exec-gate');
        for (const c of nonEmpty(doc.cases, 'exec-gate/cases')) {
            const at = `exec-gate/cases/${String(c.id)}`;
            shape(c, ['id', 'setup', 'root', 'steps', 'changes'], ['autoApproveAll'], at);
            shapeSetup(c.setup, at);
            nonEmpty(c.steps, `${at}/steps`).forEach((s, n) => {
                const sat = `${at}/steps/${n}`;
                if ('clearAutoApprove' in s) shape(s, ['clearAutoApprove', 'autoApproved'], [], sat);
                else if ('parallel' in s) {
                    shape(s, ['parallel', 'answerOrder', 'autoApproved'], [], sat);
                    nonEmpty(s.parallel, `${sat}/parallel`).forEach((r, i) => shapeReq(r, `${sat}/parallel/${i}`, false));
                    shapeAnswerOrder(s as { parallel: ReqStep[]; answerOrder: unknown }, sat);
                } else shapeReq(s, sat, true);
            });
        }
        for (const g of ['sandboxEnabled', 'autoApproveEnv', 'failClosed']) {
            for (const c of nonEmpty(doc[g], `exec-gate/${g}`)) shape(c, ['id', 'input', 'expect'], [], `exec-gate/${g}/${String(c.id)}`);
        }
    });
    it('exec-path', () => {
        const doc = load<Record<string, unknown>>('exec-path');
        shape(doc, ['suite', 'version', 'resolve', 'win32'], [], 'exec-path');
        for (const c of nonEmpty(doc.resolve, 'exec-path/resolve')) {
            const at = `exec-path/resolve/${String(c.id)}`;
            shape(c, ['id', 'input', 'expect'], ['shellEnv', 'miseEnv', 'miseCwd'], at);
            shape(c.input, ['shell', 'mise', 'processPath', 'folder'], ['env'], `${at}/input`);
            shape(c.expect, ['path'], [], `${at}/expect`);
            for (const k of ['shellEnv', 'miseEnv']) if (k in c) shape(c[k], ['has', 'lacks'], [], `${at}/${k}`);
            const { shell, mise } = c.input as Record<string, unknown>;
            if (typeof shell === 'object') shape(shell, ['stdout', 'exit'], [], `${at}/input/shell`);
            else expect(['missing']).toContain(shell);
            if (typeof mise === 'object') shape(mise, ['stdout', 'exit'], ['at'], `${at}/input/mise`);
            else expect(['absent']).toContain(mise);
        }
        for (const c of nonEmpty(doc.win32, 'exec-path/win32')) shape(c, ['id', 'input', 'expect'], [], `exec-path/win32/${String(c.id)}`);
    });
    it('worktree', () => {
        const doc = load<Record<string, unknown>>('worktree');
        shape(doc, ['suite', 'version', 'taskIdPattern', 'cases', 'taskId', 'gitDir'], [], 'worktree');
        for (const c of nonEmpty(doc.cases, 'worktree/cases')) {
            const at = `worktree/cases/${String(c.id)}`;
            shape(c, ['id', 'setup', 'root', 'steps'], [], at);
            shapeSetup(c.setup, at);
            nonEmpty(c.steps, `${at}/steps`).forEach((s, n) => {
                const sat = `${at}/steps/${n}`;
                if ('msg' in s) {
                    shape(s, ['msg', 'expect'], ['compare', 'after', 'divergence', 'rustExpect'], sat);
                    if (s.compare !== undefined) expect(['stdout-contains', 'error-prefix']).toContain(s.compare);
                    if (s.after !== undefined) shapeAfter(s.after, sat);
                    shapeCompareValues(s, sat);
                } else if ('git' in s) shape(s, ['git', 'cwd'], ['stdout'], sat);
                else if ('file' in s) shape(s, ['file'], ['content', 'repeat'], sat);
                else if ('symlink' in s) shape(s, ['symlink', 'target'], [], sat);
                else shape(s, ['remove'], [], sat);
            });
        }
        for (const c of nonEmpty(doc.taskId, 'worktree/taskId')) shape(c, ['id', 'input', 'expect'], [], `worktree/taskId/${String(c.id)}`);
        for (const c of nonEmpty(doc.gitDir, 'worktree/gitDir')) shape(c, ['id', 'setup', 'input', 'expect'], [], `worktree/gitDir/${String(c.id)}`);
    });
});

/** 확인 대본 — 물음을 쌓고, 차례 단계는 바로 답하고 parallel 은 모두 모일 때까지 쥔다. */
class Script {
    calls: Asked[] = [];
    answer: Answer | undefined;
    hold = false;
    held: { command: string; resolve: (a: Answer) => void }[] = [];
    readonly confirm = (command: string, taskId: string | undefined, base: string): Promise<Answer> => {
        this.calls.push({ command, taskId: taskId ?? null, base });
        if (this.hold) return new Promise((resolve) => { this.held.push({ command, resolve }); });
        return Promise.resolve(this.answer ?? 'no');
    };
}

const stepView = (r: ReqStep, got: BridgeResult, tmp: string): Record<string, unknown> => view(got, r.compare, fill(r.expect, tmp), '');

async function runGateCase(c: GateCase): Promise<void> {
    const tmp = makeTmp();
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-'));
    try {
        applySetup(tmp, c.setup);
        await withEnv(runnerEnv(tmp), async () => {
            const script = new Script();
            const changes: number[] = [];
            const core: BridgeCore = new BridgeCore({
                folder: path.join(tmp, c.root), confirm: script.confirm, sandboxProfileDir: prof,
                onAutoApproveChange: () => { changes.push(core.autoApprovedCount()); }, autoApproveAll: c.autoApproveAll,
            });
            core.prepare();
            for (const [n, s] of c.steps.entries()) {
                const at = `exec-gate/cases/${c.id}/steps/${n}`;
                if ('clearAutoApprove' in s) core.clearAutoApprove();
                else if ('parallel' in s) await runParallel(core, script, s.parallel, s.answerOrder, tmp, at);
                else {
                    script.calls = []; script.answer = s.confirm;
                    const got = await exec(core, fill(s.msg, tmp));
                    expect({ at, asked: script.calls.length, answered: s.confirm !== undefined || script.calls.length === 0 })
                        .toEqual({ at, asked: s.asked ? 1 : 0, answered: true });
                    if (s.askedWith) expect({ at, askedWith: script.calls[0] }).toEqual({ at, askedWith: fill(s.askedWith, tmp) });
                    expect({ at, result: stepView(s, got, tmp) }).toStrictEqual({ at, result: fill(s.expect, tmp) });
                    if (s.after) checkAfter(tmp, s.after, at);
                }
                expect({ at, autoApproved: core.autoApprovedCount() }).toEqual({ at, autoApproved: s.autoApproved });
            }
            expect({ id: c.id, changes }).toEqual({ id: c.id, changes: c.changes });
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(prof, { recursive: true, force: true });
    }
}

/** 요청들을 함께 보내고, 물음이 asked 인 수만큼 모두 모인 뒤 answerOrder 차례로 답한다. 물음은 명령 글자로 짝짓는다. */
async function runParallel(core: BridgeCore, script: Script, items: ReqStep[], order: number[], tmp: string, at: string): Promise<void> {
    const commands = items.map((r) => String(r.msg.command || ''));
    expect({ at, distinctCommands: new Set(commands).size }).toEqual({ at, distinctCommands: items.length });
    script.calls = []; script.hold = true; script.held = [];
    const want = items.filter((r) => r.asked).length;
    const results = items.map((r) => exec(core, fill(r.msg, tmp)));
    const deadline = Date.now() + 5000;
    while (script.held.length < want && Date.now() < deadline) await new Promise((r) => setImmediate(r));
    expect({ at, held: script.held.length }).toEqual({ at, held: want });
    for (const i of order) {
        const h = script.held.find((x) => x.command === commands[i]);
        expect({ at, answer: i, held: h !== undefined }).toEqual({ at, answer: i, held: true });
        h!.resolve(items[i].confirm ?? 'no');
        await new Promise((r) => setImmediate(r));
    }
    script.hold = false;
    const got = await Promise.all(results);
    items.forEach((r, i) => {
        const iat = `${at}/parallel/${i}`;
        const call = script.calls.find((x) => x.command === commands[i]);
        expect({ iat, asked: call !== undefined }).toEqual({ iat, asked: r.asked });
        if (r.askedWith) expect({ iat, askedWith: call }).toEqual({ iat, askedWith: fill(r.askedWith, tmp) });
        expect({ iat, result: stepView(r, got[i], tmp) }).toStrictEqual({ iat, result: fill(r.expect, tmp) });
        if (r.after) checkAfter(tmp, r.after, iat);
    });
}

describe('exec-gate', () => {
    const doc = load<{
        cases: GateCase[];
        sandboxEnabled: Case<{ platform: NodeJS.Platform; env: string | null }, boolean>[];
        autoApproveEnv: Case<{ env: string | null }, boolean>[];
        failClosed: Case<{ prepare: 'none' | 'home-missing' }, BridgeResult>[];
    }>('exec-gate');

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        for (const s of c.steps) for (const r of 'parallel' in s ? s.parallel : 'msg' in s ? [s] : []) {
            expect(['exec', 'task_end']).toContain(r.msg.kind);
        }
        await runGateCase(c);
    }, 20000);

    it.each(doc.sandboxEnabled.map((c) => [c.id, c] as const))('sandboxEnabled/%s', async (_id, c) => {
        const got = await withEnv({ OMK_BRIDGE_SANDBOX: c.input.env }, () => withPlatform(c.input.platform, () => {
            let v: unknown;
            jest.isolateModules(() => { v = (require('../constants') as typeof import('../constants')).SANDBOX_ENABLED; });
            return v;
        }));
        expect(got).toBe(c.expect);
    });

    it.each(doc.autoApproveEnv.map((c) => [c.id, c] as const))('autoApproveEnv/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            await withEnv({ ...runnerEnv(tmp), OMK_BRIDGE_AUTO_APPROVE: c.input.env }, async () => {
                const script = new Script();
                const core = new BridgeCore({ folder: tmp, confirm: script.confirm, sandboxProfileDir: path.join(tmp, 'prof') });
                core.prepare();
                await exec(core, { kind: 'exec', command: 'true' });
                expect(script.calls.length === 0).toBe(c.expect);
            });
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    // 샌드박스가 켜진 코어(플랫폼을 darwin 으로 바꿔 코어를 새로 읽는다 — Linux 에서도 돈다). 거절은 프로세스를 띄우기 전이다.
    it.each(doc.failClosed.map((c) => [c.id, c] as const))('failClosed/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            // home-missing: 홈 realpath 가 실패해 프로파일 텍스트를 만들지 못한다(프로파일은 파일로 쓰지 않는다 — 리뷰 F1).
            const homeMissing = c.input.prepare === 'home-missing';
            await withEnv({ ...runnerEnv(tmp), ...(homeMissing ? { HOME: path.join(tmp, 'no-home') } : {}), OMK_BRIDGE_SANDBOX: null }, () => withPlatform('darwin', async () => {
                let Core!: typeof BridgeCore;
                jest.isolateModules(() => { Core = (require('../core') as typeof import('../core')).BridgeCore; });
                const script = new Script();
                script.answer = 'yes';
                fs.mkdirSync(path.join(tmp, 'root'));
                const core = new Core({ folder: path.join(tmp, 'root'), confirm: script.confirm, sandboxProfileDir: path.join(tmp, 'prof') });
                if (homeMissing) core.prepare();
                expect(await exec(core, { kind: 'exec', command: 'touch ran' })).toStrictEqual(c.expect);
                expect(script.calls.length).toBe(1);
                expect(fs.existsSync(path.join(tmp, 'root', 'ran'))).toBe(false);
            }));
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

describe('exec-path', () => {
    type Prog = { stdout: string; exit: number; at?: string };
    type EnvCheck = { has: Record<string, string>; lacks: string[] };
    const doc = load<{
        resolve: (Case<{ shell: Prog | 'missing'; mise: Prog | 'absent'; processPath: string; folder: 'root' | null; env?: Record<string, string> }, { path: string }>
            & { shellEnv?: EnvCheck; miseEnv?: EnvCheck; miseCwd?: string })[];
        win32: Case<{ env: { PATH?: string; Path?: string } }, string>[];
    }>('exec-path');

    const envView = (env: Record<string, string>, want: EnvCheck): EnvCheck => ({
        has: Object.fromEntries(Object.keys(want.has).map((k) => [k, env[k]])),
        lacks: want.lacks.filter((k) => !(k in env)),
    });

    it.each(doc.resolve.map((c) => [c.id, c] as const))('resolve/%s', async (_id, raw) => {
        const tmp = makeTmp();
        try {
            const c = fill(raw, tmp);
            fs.mkdirSync(path.join(tmp, 'bin'));
            fs.mkdirSync(path.join(tmp, 'root'));
            const shell = c.input.shell === 'missing' ? path.join(tmp, 'bin', 'no-such-shell') : fakeBin(tmp, 'bin', 'loginshell', c.input.shell.stdout, c.input.shell.exit);
            if (c.input.mise !== 'absent') fakeBin(tmp, c.input.mise.at ?? 'bin', 'mise', c.input.mise.stdout, c.input.mise.exit);
            const got = await withEnv({ ...runnerEnv(tmp), ...c.input.env, PATH: c.input.processPath, SHELL: shell }, () =>
                resolveExecPath(c.input.folder === 'root' ? path.join(tmp, 'root') : null));
            expect({ path: got }).toEqual(c.expect);
            if (c.shellEnv) expect(envView(childEnv(tmp, 'loginshell'), c.shellEnv)).toEqual(c.shellEnv);
            if (c.miseEnv) expect(envView(childEnv(tmp, 'mise'), c.miseEnv)).toEqual(c.miseEnv);
            if (c.miseCwd) expect(fs.readFileSync(path.join(tmp, 'mise.cwd'), 'utf8')).toBe(`${c.miseCwd}\n`);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    it.each(doc.win32.map((c) => [c.id, c] as const))('win32/%s', async (_id, c) => {
        const got = await withEnv({ PATH: c.input.env.PATH ?? null, Path: c.input.env.Path ?? null }, () =>
            withPlatform('win32', () => resolveExecPath(null)));
        expect(got).toBe(c.expect);
    });
});

describe('worktree', () => {
    type WtReq = { msg: BridgeMsg; expect: Record<string, unknown>; compare?: string; after?: After[]; divergence?: string; rustExpect?: unknown };
    const doc = load<{
        taskIdPattern: { source: string; flags: string };
        cases: { id: string; setup: Setup[]; root: string; steps: (WtReq | OpStep)[] }[];
        taskId: Case<{ taskId?: unknown }, BridgeResult | 'accepted'>[];
        gitDir: (Case<{ root: string }, { git: GitPaths | null }> & { setup: Setup[] })[];
    }>('worktree');
    /** worktree 는 묻지 않는다 — 확인 콜백이 불리면 실패한다. */
    const noConfirm = (): Promise<'no'> => { throw new Error('worktree 가 확인을 물었다'); };

    it('taskIdPattern 이 TASK_ID_RE 와 같다', () => {
        expect({ source: TASK_ID_RE.source, flags: TASK_ID_RE.flags }).toEqual(doc.taskIdPattern);
    });

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applySetup(tmp, c.setup);
            await withEnv(runnerEnv(tmp), async () => {
                const core = new BridgeCore({ folder: path.join(tmp, c.root), confirm: noConfirm, sandboxProfileDir: path.join(tmp, 'prof') });
                core.prepare(); // 연결 — git 디렉터리 신뢰 판정·도구 프로파일(worktree git 은 그 안에서 돈다)
                for (const [n, s] of c.steps.entries()) {
                    const at = `worktree/cases/${c.id}/steps/${n}`;
                    if (!('msg' in s)) { applyOpStep(tmp, s, at); continue; }
                    // worktree 와 git 금지 경로 가드(D-4)를 함께 보는 파일 kind 쓰기·지우기만 넣는다.
                    expect(['worktree', 'write', 'delete']).toContain(s.msg.kind);
                    const got = await exec(core, fill(s.msg, tmp));
                    expect({ at, result: view(got, s.compare, fill(s.expect, tmp), at) }).toStrictEqual({ at, result: fill(s.expect, tmp) });
                    if (s.after) checkAfter(tmp, s.after, at);
                }
            });
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }, 20000);

    it.each(doc.taskId.map((c) => [c.id, c] as const))('taskId/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            await withEnv(runnerEnv(tmp), async () => {
                const core = new BridgeCore({ folder: tmp, confirm: noConfirm, sandboxProfileDir: path.join(tmp, 'prof') });
                core.prepare();
                const got = await exec(core, { kind: 'worktree', op: 'add', ...c.input } as BridgeMsg);
                expect(got).toStrictEqual(c.expect === 'accepted' ? { ok: false, error: 'git 레포가 아닙니다' } : c.expect);
            });
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    it.each(doc.gitDir.map((c) => [c.id, c] as const))('gitDir/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applySetup(tmp, c.setup);
            const got = await withEnv(runnerEnv(tmp), () => detectGit(fill(c.input.root, tmp)));
            expect({ git: got }).toEqual(fill(c.expect, tmp));
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});
