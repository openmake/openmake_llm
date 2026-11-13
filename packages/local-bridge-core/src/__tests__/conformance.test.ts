/**
 * 적합성 fixture(conformance/*.json) TS 러너 — 같은 fixture 를 Rust 코어(apps/openmake-code)도 통과해야 한다.
 * 기준은 TS 의 현재 동작이다. 모르는 suite 가 있으면 실패해 한쪽 러너만 늘어나는 것을 막는다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXEC_DENYLIST, matchDenylist, normalizeForDenylist } from '../denylist';
import { buildExecEnv } from '../exec-env';
import { bulkApprovalAllowed, folderNameOf, pathListSeparator, shellInvocation } from '../platform';
import { writeSandboxProfile } from '../sandbox';
import { safeFrom, safeFromAsync } from '../scope';
import { RequestGuard } from '../request-guard';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';
import * as constants from '../constants';

const DIR = path.join(__dirname, '..', '..', 'conformance');
const KNOWN_SUITES = ['code-nav', 'constants', 'denylist', 'diagnostics-parse', 'exec-env', 'exec-gate', 'exec-path', 'file-kinds', 'glob', 'platform', 'request-guard', 'sandbox-profile', 'scope', 'test-runner', 'worktree'];
/** Rust 만 다른 판정을 내도 되는 차이 — conformance/README.md "알려진 차이". 자리(suite/묶음)마다 쓸 수 있는 이름이 하나다. */
const KNOWN_DIVERGENCES: Record<string, string> = {
    'denylist/cases': 'regress-nonunicode-i-fold',
    'file-kinds/cases/requests': 'non-string-field',
    'exec-gate/cases/steps': 'non-string-field',
    'worktree/cases/steps': 'non-string-field',
    'code-nav/cases/requests': 'non-string-field',
    'diagnostics-parse/cases/requests': 'non-string-field',
};

type Platform = 'darwin' | 'linux' | 'win32';
interface Case<I, E> { id: string; input: I; expect: E; rustExpect?: unknown; divergence?: string }

function load<T>(suite: string): T {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8')) as T;
}

describe('conformance fixture 목록', () => {
    it('suite 파일은 이 러너가 아는 것뿐이고, 파일 이름과 suite 이름이 같다', () => {
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('conn-')).sort(); // conn-* 는 conformance-conn.test.ts 몫
        expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(KNOWN_SUITES);
        for (const f of files) {
            const doc = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as { suite: string; version: number };
            expect(`${doc.suite}.json`).toBe(f);
            expect(doc.version).toBe(1);
        }
    });

    // 사례 id 는 묶음 안에서 겹치지 않는다. divergence·rustExpect 는 정해진 자리에만 쓸 수 있다.
    it.each(KNOWN_SUITES)('%s — 사례 id 중복 없음, 알려진 차이는 정해진 자리에만', (suite) => {
        const walk = (v: unknown, at: string): void => {
            if (Array.isArray(v)) {
                const ids = v.flatMap((x) => (x && typeof x === 'object' && 'id' in x ? [(x as { id: unknown }).id] : []));
                expect({ at, duplicated: ids.filter((id, i) => ids.indexOf(id) !== i) }).toEqual({ at, duplicated: [] });
                v.forEach((x) => walk(x, at));
            } else if (v && typeof v === 'object') {
                const o = v as Record<string, unknown>;
                if ('divergence' in o || 'rustExpect' in o) {
                    expect(at in KNOWN_DIVERGENCES ? at : `알 수 없는 자리 ${at}`).toBe(at);
                    // 이 자리의 이름이어야 하고, rustExpect 와 짝으로만 쓴다(남용 방지).
                    expect({ at, divergence: o.divergence, rustExpect: 'rustExpect' in o }).toEqual({ at, divergence: KNOWN_DIVERGENCES[at], rustExpect: true });
                }
                for (const [k, x] of Object.entries(o)) walk(x, Array.isArray(x) ? `${at}/${k}` : at);
            }
        };
        walk(load(suite), suite);
    });
});

// 키 오타(`after`→`After` 등)로 확인이 조용히 빠지지 않게, 묶음 이름·사례 키·빈 목록을 본다(Rust 러너 fixture_shapes 와 같은 규칙).
/** required 는 모두 있어야 하고, 그 밖의 키는 optional 만 쓸 수 있다. */
function shape(o: unknown, required: string[], optional: string[], at: string): void {
    const keys = o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null;
    expect({ at, object: keys !== null }).toEqual({ at, object: true });
    expect({ at, missing: required.filter((k) => !keys!.includes(k)), unknown: keys!.filter((k) => !required.includes(k) && !optional.includes(k)) })
        .toEqual({ at, missing: [], unknown: [] });
}
/** 사례·요청·단계 목록 — 0개면 실패한다. */
function nonEmpty(v: unknown, at: string): Record<string, unknown>[] {
    expect({ at, nonEmptyArray: Array.isArray(v) && v.length > 0 }).toEqual({ at, nonEmptyArray: true });
    return v as Record<string, unknown>[];
}
const CASE_KEYS = ['id', 'input', 'expect'];

describe('fixture 모양 — 묶음 이름·키 허용 목록·빈 목록', () => {
    it('scope', () => {
        const doc = load<Record<string, Record<string, unknown>>>('scope');
        shape(doc, ['suite', 'version', 'nodePath', 'lexical', 'fs'], [], 'scope');
        shape(doc.nodePath, ['resolve', 'dirname', 'relative'], [], 'scope/nodePath');
        for (const g of ['resolve', 'dirname', 'relative']) {
            for (const c of nonEmpty(doc.nodePath[g], `scope/nodePath/${g}`)) shape(c, CASE_KEYS, [], `scope/nodePath/${g}/${String(c.id)}`);
        }
        for (const c of nonEmpty(doc.lexical, 'scope/lexical')) shape(c, CASE_KEYS, [], `scope/lexical/${String(c.id)}`);
        for (const c of nonEmpty(doc.fs, 'scope/fs')) shape(c, [...CASE_KEYS, 'setup'], [], `scope/fs/${String(c.id)}`);
    });
    it('file-kinds', () => {
        const doc = load<Record<string, unknown>>('file-kinds');
        shape(doc, ['suite', 'version', 'cases', 'timeout', 'fsTimeoutEnv'], [], 'file-kinds');
        for (const c of nonEmpty(doc.cases, 'file-kinds/cases')) {
            const at = `file-kinds/cases/${String(c.id)}`;
            shape(c, ['id', 'setup', 'root', 'requests'], [], at);
            nonEmpty(c.requests, `${at}/requests`).forEach((r, n) => {
                shape(r, ['msg', 'expect'], ['compare', 'after', 'divergence', 'rustExpect'], `${at}/requests/${n}`);
                for (const a of (r.after ?? []) as Record<string, unknown>[]) {
                    if ('absent' in a) shape(a, ['absent'], [], `${at}/requests/${n}/after`);
                    else shape(a, ['exists'], ['content', 'contentB64'], `${at}/requests/${n}/after`);
                }
            });
        }
        for (const g of ['timeout', 'fsTimeoutEnv']) {
            for (const c of nonEmpty(doc[g], `file-kinds/${g}`)) shape(c, CASE_KEYS, [], `file-kinds/${g}/${String(c.id)}`);
        }
    });
    it('request-guard', () => {
        const doc = load<Record<string, unknown>>('request-guard');
        shape(doc, ['suite', 'version', 'cases'], [], 'request-guard');
        for (const c of nonEmpty(doc.cases, 'request-guard/cases')) {
            const at = `request-guard/cases/${String(c.id)}`;
            shape(c, ['id', 'steps'], [], at);
            nonEmpty(c.steps, `${at}/steps`).forEach((s, n) => {
                shape(s, 'fill' in s ? ['fill', 'now'] : ['input', 'now', 'expect'], [], `${at}/steps/${n}`);
            });
        }
    });
});

describe('constants', () => {
    const doc = load<{ values: Record<string, unknown> }>('constants');
    it.each(Object.entries(doc.values))('%s 가 TS export 와 같다', (name, value) => {
        expect((constants as Record<string, unknown>)[name]).toEqual(value);
    });
});

describe('denylist', () => {
    const doc = load<{
        rules: { source: string; flags: string; why: string }[];
        normalize: { id: string; input: string; expect: string }[];
        cases: Case<{ command: string }, { why: string | null }>[];
    }>('denylist');

    it('규칙 표(source·flags·why)가 EXEC_DENYLIST 와 글자 단위로 같다', () => {
        expect(doc.rules).toEqual(EXEC_DENYLIST.map((d) => ({ source: d.re.source, flags: d.re.flags, why: d.why })));
    });
    it.each(doc.normalize.map((c) => [c.id, c] as const))('normalize/%s', (_id, c) => {
        expect(normalizeForDenylist(c.input)).toBe(c.expect);
    });
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => {
        // 알려진 차이는 정해진 이름일 때만, rustExpect 와 짝으로만 허용한다(남용 방지).
        if (c.divergence !== undefined || c.rustExpect !== undefined) {
            expect(c.divergence).toBe(KNOWN_DIVERGENCES['denylist/cases']);
            expect(c.rustExpect).toBeDefined();
        }
        expect(matchDenylist(c.input.command)).toBe(c.expect.why);
    });
});

describe('exec-env', () => {
    const doc = load<{ cases: Case<{ source: Record<string, string>; execPath: string; platform: Platform; extraPosixKeys: string[] }, { env: Record<string, string> }>[] }>('exec-env');
    it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
        expect(buildExecEnv(c.input.source, c.input.execPath, c.input.platform, c.input.extraPosixKeys)).toEqual(c.expect.env);
    });
});

describe('platform', () => {
    const doc = load<{
        shellInvocation: Case<{ command: string; platform: Platform; comSpec: string | null }, { file: string; args: string[] }>[];
        pathListSeparator: Case<{ platform: Platform }, string>[];
        folderNameOf: Case<{ root: string }, string>[];
        bulkApprovalAllowed: Case<{ platform: Platform }, boolean>[];
    }>('platform');

    // comSpec 인자가 없으면 TS 는 process.env.ComSpec 를 쓴다 — fixture 의 null 은 "환경에도 없음"이다.
    let savedComSpec: string | undefined;
    beforeAll(() => { savedComSpec = process.env.ComSpec; delete process.env.ComSpec; });
    afterAll(() => { if (savedComSpec !== undefined) process.env.ComSpec = savedComSpec; });

    it.each(doc.shellInvocation.map((c) => [c.id, c] as const))('shellInvocation/%s', (_id, c) => {
        expect(shellInvocation(c.input.command, c.input.platform, c.input.comSpec ?? undefined)).toEqual(c.expect);
    });
    it.each(doc.pathListSeparator.map((c) => [c.id, c] as const))('pathListSeparator/%s', (_id, c) => {
        expect(pathListSeparator(c.input.platform)).toBe(c.expect);
    });
    it.each(doc.folderNameOf.map((c) => [c.id, c] as const))('folderNameOf/%s', (_id, c) => {
        expect(folderNameOf(c.input.root)).toBe(c.expect);
    });
    it.each(doc.bulkApprovalAllowed.map((c) => [c.id, c] as const))('bulkApprovalAllowed/%s', (_id, c) => {
        expect(bulkApprovalAllowed(c.input.platform)).toBe(c.expect);
    });
});

describe('sandbox-profile', () => {
    const doc = load<{ cases: Case<{ root: string; gitDir: string | null; commonDir?: string; tool?: boolean }, { profile: string }>[] }>('sandbox-profile');
    let dir = '';
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-')); });
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it.each(doc.cases.map((c, i) => [c.id, c, i] as const))('%s — 프로파일 전체 텍스트가 같다', (_id, c, i) => {
        const out = path.join(dir, `p${i}.sb`);
        const { root, gitDir, commonDir, tool } = c.input;
        // commonDir 를 적지 않으면 git dir 와 같다(일반 레포). 빈 gitDir 은 git 없음(종전 규칙).
        expect(writeSandboxProfile(root, gitDir ? { gitDir, commonDir: commonDir ?? gitDir } : null, out, tool === true)).toBe(out);
        const home = fs.realpathSync(os.homedir());
        expect(fs.readFileSync(out, 'utf8')).toBe(c.expect.profile.split('{{HOME}}').join(home));
    });
});

// ── 파일 시스템을 만지는 suite 공통 ── `{{TMP}}` 는 사례마다 새로 만든 임시 폴더의 realpath 다.
type Setup = { dir: string } | { file: string; content?: string; contentB64?: string } | { symlink: string; target: string }
    | { many: { dir: string; count: number; prefix: string; kind: 'file' | 'dir' } };

function mapStrings(v: unknown, f: (s: string) => string): unknown {
    if (typeof v === 'string') return f(v);
    if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
    return v;
}
function fillTmp<T>(v: T, tmp: string): T { return mapStrings(v, (s) => s.split('{{TMP}}').join(tmp)) as T; }
function makeTmp(): string { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-'))); }

function applySetup(tmp: string, setup: Setup[]): void {
    for (const s of setup) {
        if ('dir' in s) fs.mkdirSync(path.join(tmp, s.dir), { recursive: true });
        else if ('file' in s) {
            const p = path.join(tmp, s.file);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, s.contentB64 !== undefined ? Buffer.from(s.contentB64, 'base64') : (s.content ?? ''));
        } else if ('symlink' in s) fs.symlinkSync(fillTmp(s.target, tmp), path.join(tmp, s.symlink));
        else if ('many' in s) {
            fs.mkdirSync(path.join(tmp, s.many.dir), { recursive: true });
            for (let i = 0; i < s.many.count; i++) {
                const p = path.join(tmp, s.many.dir, `${s.many.prefix}${i}`);
                if (s.many.kind === 'dir') fs.mkdirSync(p); else fs.writeFileSync(p, '');
            }
        } else throw new Error(`모르는 setup: ${JSON.stringify(s)}`);
    }
}

/** 통과면 {abs}, 거부면 {error} — fixture 의 기대값 모양. */
async function settle(fn: () => Promise<string> | string): Promise<{ abs: string } | { error: string }> {
    try { return { abs: await fn() }; } catch (e) { return { error: (e as Error).message }; }
}

describe('scope', () => {
    type ScopeCase = { id: string; input: { base: string; rel?: string }; expect: { abs: string } | { error: string } };
    const doc = load<{
        nodePath: {
            resolve: Case<{ base: string; rel: string }, string>[];
            dirname: Case<string, string>[];
            relative: Case<{ from: string; to: string }, string>[];
        };
        lexical: ScopeCase[];
        fs: (ScopeCase & { setup: Setup[] })[];
    }>('scope');

    it.each(doc.nodePath.resolve.map((c) => [c.id, c] as const))('nodePath/resolve/%s', (_id, c) => {
        expect(path.posix.resolve(c.input.base, c.input.rel)).toBe(c.expect);
    });
    it.each(doc.nodePath.dirname.map((c) => [c.id, c] as const))('nodePath/dirname/%s', (_id, c) => {
        expect(path.posix.dirname(c.input)).toBe(c.expect);
    });
    it.each(doc.nodePath.relative.map((c) => [c.id, c] as const))('nodePath/relative/%s', (_id, c) => {
        expect(path.posix.relative(c.input.from, c.input.to)).toBe(c.expect);
    });

    describe('lexical — 파일 시스템을 항등(모두 존재·realpath 는 입력 그대로)으로 바꾼 safeFromAsync', () => {
        const nodeFs = require('fs') as typeof import('fs');
        beforeEach(() => {
            jest.spyOn(nodeFs.promises, 'lstat').mockImplementation((async () => ({})) as never);
            jest.spyOn(nodeFs.promises, 'realpath').mockImplementation((async (p: string) => p) as never);
            jest.spyOn(nodeFs, 'lstatSync').mockImplementation((() => ({})) as never);
            jest.spyOn(nodeFs, 'realpathSync').mockImplementation(((p: string) => p) as never);
        });
        afterEach(() => { jest.restoreAllMocks(); });
        it.each(doc.lexical.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
            expect(await settle(() => safeFromAsync(c.input.base, c.input.rel))).toStrictEqual(c.expect);
            expect(await settle(() => safeFrom(c.input.base, c.input.rel))).toStrictEqual(c.expect);
        });
    });

    it.each(doc.fs.map((c) => [c.id, c] as const))('fs/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applySetup(tmp, c.setup);
            const input = fillTmp(c.input, tmp);
            const got = await settle(() => safeFromAsync(input.base, input.rel));
            expect(got).toStrictEqual(fillTmp(c.expect, tmp));
            // 동기 판은 통과·거부와 통과 값만 같아야 한다(거부 문구는 Node 판마다 다를 수 있다).
            const sync = await settle(() => safeFrom(input.base, input.rel));
            expect('abs' in sync ? sync : 'rejected').toStrictEqual('abs' in got ? got : 'rejected');
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

describe('file-kinds', () => {
    type After = { exists: string; content?: string; contentB64?: string } | { absent: string };
    type Req = { msg: BridgeMsg; expect: Record<string, unknown>; compare?: 'sorted-entries' | 'capped'; after?: After[]; divergence?: string; rustExpect?: unknown };
    const doc = load<{
        cases: { id: string; setup: Setup[]; root: string; requests: Req[] }[];
        timeout: Case<{ kind: string; timeoutMs: number }, { error: string }>[];
        fsTimeoutEnv: Case<{ env: string | null }, { ms: number }>[];
    }>('file-kinds');
    /** TS 는 실제로 실행하고 Rust 는 아직 거절하는 종류 — fixture 로 맞출 수 없어 넣지 못하게 막는다. */
    const NOT_PORTED = ['browser'];

    /** 연결부(connection.ts)와 같이 예외를 {ok:false, error} 로 바꾼다 — 프로토콜에서는 구분이 없다. */
    function exec(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
        return new Promise((resolve) => {
            core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
        });
    }
    const exists = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', async (_id, c) => {
        const tmp = makeTmp();
        const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-'));
        try {
            applySetup(tmp, c.setup);
            const many = new Set(c.setup.flatMap((s) => ('many' in s
                ? Array.from({ length: s.many.count }, (_, i) => path.posix.join(s.many.dir, `${s.many.prefix}${i}`)) : [])));
            const core = new BridgeCore({ folder: path.join(tmp, c.root), confirm: async () => 'no', sandboxProfileDir: prof });
            for (const [n, r] of c.requests.entries()) {
                expect(NOT_PORTED).not.toContain(r.msg.kind);
                const got = await exec(core, fillTmp(r.msg, tmp)) as BridgeResult & Record<string, unknown>;
                let view: Record<string, unknown> = got;
                if (r.compare === 'sorted-entries') view = { ...got, entries: [...(got.entries ?? [])].sort() };
                if (r.compare === 'capped') {
                    const { entries, ...rest } = got;
                    view = { ...rest, entriesCount: entries?.length };
                    for (const e of entries ?? []) expect(many).toContain(path.posix.join(c.root, e));
                }
                expect({ request: n, result: view }).toStrictEqual({ request: n, result: fillTmp(r.expect, tmp) });
                for (const a of r.after ?? []) {
                    if ('absent' in a) { expect({ request: n, absent: a.absent, exists: exists(path.join(tmp, a.absent)) }).toEqual({ request: n, absent: a.absent, exists: false }); continue; }
                    const p = path.join(tmp, a.exists);
                    expect({ request: n, exists: a.exists, found: exists(p) }).toEqual({ request: n, exists: a.exists, found: true });
                    if (a.content !== undefined) expect(fs.readFileSync(p, 'utf8')).toBe(a.content);
                    if (a.contentB64 !== undefined) expect(fs.readFileSync(p).toString('base64')).toBe(Buffer.from(a.contentB64, 'base64').toString('base64'));
                }
            }
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
            fs.rmSync(prof, { recursive: true, force: true });
        }
    });

    describe('시간 제한 (OMK_BRIDGE_FS_TIMEOUT_MS 를 바꿔 코어를 새로 읽는다)', () => {
        const nodeFs = require('fs') as typeof import('fs');
        const saved = process.env.OMK_BRIDGE_FS_TIMEOUT_MS;
        function withEnv<T>(value: string | null, load: () => T): T {
            if (value === null) delete process.env.OMK_BRIDGE_FS_TIMEOUT_MS; else process.env.OMK_BRIDGE_FS_TIMEOUT_MS = value;
            try {
                let out!: T;
                jest.isolateModules(() => { out = load(); });
                return out;
            } finally {
                if (saved === undefined) delete process.env.OMK_BRIDGE_FS_TIMEOUT_MS; else process.env.OMK_BRIDGE_FS_TIMEOUT_MS = saved;
            }
        }
        afterEach(() => { jest.restoreAllMocks(); });

        it.each(doc.timeout.map((c) => [c.id, c] as const))('timeout/%s', async (_id, c) => {
            const Core = withEnv(String(c.input.timeoutMs), () => (require('../core') as typeof import('../core')).BridgeCore);
            const tmp = makeTmp();
            try {
                fs.writeFileSync(path.join(tmp, 'hello.txt'), 'world');
                // 블록된 FS 호출 — 끝나지 않는 약속으로 바꾼다(fs-timeout.test.ts 와 같은 방식).
                jest.spyOn(nodeFs.promises, c.input.kind === 'read' ? 'readFile' : 'readdir').mockImplementation((() => new Promise(() => { /* never */ })) as never);
                const core = new Core({ folder: tmp, confirm: async () => 'no', sandboxProfileDir: tmp });
                const m: BridgeMsg = c.input.kind === 'read' ? { kind: 'read', path: 'hello.txt' } : { kind: c.input.kind };
                expect(await exec(core, m)).toStrictEqual({ ok: false, error: c.expect.error });
            } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
        });

        it.each(doc.fsTimeoutEnv.map((c) => [c.id, c] as const))('fsTimeoutEnv/%s', (_id, c) => {
            expect(withEnv(c.input.env, () => (require('../constants') as typeof import('../constants')).FS_OP_TIMEOUT_MS)).toBe(c.expect.ms);
        });
    });
});

describe('request-guard', () => {
    type Step = { input: { reqId?: string; expiresAt?: number }; now: number; expect: BridgeResult | null }
        | { fill: { prefix: string; from: number; count: number }; now: number };
    const doc = load<{ cases: { id: string; steps: Step[] }[] }>('request-guard');
    it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
        const g = new RequestGuard();
        c.steps.forEach((s, n) => {
            if ('fill' in s) {
                for (let i = s.fill.from; i < s.fill.from + s.fill.count; i++) expect(g.check({ reqId: `${s.fill.prefix}${i}` }, s.now)).toBeNull();
                return;
            }
            expect({ step: n, result: g.check(s.input, s.now) }).toStrictEqual({ step: n, result: s.expect });
        });
    });
});
