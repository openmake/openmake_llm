/**
 * 적합성 fixture TS 러너 — 읽기 전용 도구 suite(glob·code-nav·diagnostics-parse·test-runner). 같은 fixture 를 Rust 러너
 * (apps/openmake-code/crates/omk-bridge-core/tests/conformance/code_nav.rs·diagnostics.rs·test_runner.rs)도 통과해야 한다.
 * suite 목록·사례 id·알려진 차이 자리는 conformance.test.ts 가 본다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BridgeCore } from '../core';
import { CODE_NAV_EXCLUDED_DIRS, CODE_NAV_EXCLUDED_FILES } from '../constants';
import { globToRegExp, isSecretFile, walkFiles } from '../code-nav';
import { collectDiagnostics } from '../diagnostics';
import { detectTestRunner } from '../test-runner';
import type { BridgeMsg } from '../types';
import { exec, fill, load, makeTmp, nonEmpty, runnerEnv, shape, withEnv } from './conformance-exec-support';
import {
    applyToolSetup, readToolCalls, shapeToolCalls, shapeToolCompare, shapeToolSetup, toolCallsView, toolView,
    type ToolSetup, type WantCall,
} from './conformance-tools-support';

// conformance-exec.test.ts 와 같은 이유 — os.homedir() 가 사례의 가짜 홈을 따라오게 한다.
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

type Req = { msg: BridgeMsg; expect: Record<string, unknown>; compare?: string; divergence?: string; rustExpect?: unknown; toolCalls?: WantCall[] };
type CoreCase = { id: string; setup: ToolSetup[]; root: string; requests: Req[] };
type Direct<I, E> = { id: string; setup: ToolSetup[]; input: I; expect: E; toolCalls?: WantCall[] };

const REQ_OPTIONAL = ['compare', 'divergence', 'rustExpect', 'toolCalls'];

function shapeCoreCases(doc: Record<string, unknown>, suite: string): void {
    for (const c of nonEmpty(doc.cases, `${suite}/cases`)) {
        const at = `${suite}/cases/${String(c.id)}`;
        shape(c, ['id', 'setup', 'root', 'requests'], [], at);
        shapeToolSetup(c.setup, at);
        nonEmpty(c.requests, `${at}/requests`).forEach((r, n) => {
            const rat = `${at}/requests/${n}`;
            shape(r, ['msg', 'expect'], REQ_OPTIONAL, rat);
            shapeToolCompare(r, rat);
            if (r.toolCalls !== undefined) shapeToolCalls(r.toolCalls, rat);
        });
    }
}
function shapeDirect(doc: Record<string, unknown>, suite: string, inputKeys: string[]): void {
    for (const c of nonEmpty(doc.direct, `${suite}/direct`)) {
        const at = `${suite}/direct/${String(c.id)}`;
        shape(c, ['id', 'setup', 'input', 'expect'], ['toolCalls'], at);
        shapeToolSetup(c.setup, at);
        shape(c.input, inputKeys, [], `${at}/input`);
        if (c.toolCalls !== undefined) shapeToolCalls(c.toolCalls, at);
    }
}

describe('fixture 모양 — 묶음 이름·키 허용 목록·빈 목록', () => {
    it('glob', () => {
        const doc = load<Record<string, unknown>>('glob');
        shape(doc, ['suite', 'version', 'cases'], [], 'glob');
        for (const c of nonEmpty(doc.cases, 'glob/cases')) {
            const at = `glob/cases/${String(c.id)}`;
            shape(c, ['id', 'glob', 'basenameOnly', 'tests'], [], at);
            for (const t of nonEmpty(c.tests, `${at}/tests`)) shape(t, ['text', 'expect'], [], `${at}/tests`);
        }
    });
    it('code-nav', () => {
        const doc = load<Record<string, unknown>>('code-nav');
        shape(doc, ['suite', 'version', 'cases', 'walk', 'secretFiles', 'excludedFiles', 'excludedDirs'], [], 'code-nav');
        shapeCoreCases(doc, 'code-nav');
        for (const c of nonEmpty(doc.walk, 'code-nav/walk')) {
            const at = `code-nav/walk/${String(c.id)}`;
            shape(c, ['id', 'setup', 'input', 'expect'], [], at);
            shapeToolSetup(c.setup, at);
            shape(c.input, ['start', 'deadline'], [], `${at}/input`);
            expect(['past', 'far']).toContain((c.input as Record<string, unknown>).deadline);
            shape(c.expect, ['files', 'truncated', 'skipped'], [], `${at}/expect`);
        }
        for (const c of nonEmpty(doc.secretFiles, 'code-nav/secretFiles')) shape(c, ['name', 'expect'], [], 'code-nav/secretFiles');
        nonEmpty((doc.excludedFiles as unknown[]).map((x) => ({ x })), 'code-nav/excludedFiles');
        nonEmpty((doc.excludedDirs as unknown[]).map((x) => ({ x })), 'code-nav/excludedDirs');
    });
    it('diagnostics-parse', () => {
        const doc = load<Record<string, unknown>>('diagnostics-parse');
        shape(doc, ['suite', 'version', 'cases', 'direct'], [], 'diagnostics-parse');
        shapeCoreCases(doc, 'diagnostics-parse');
        shapeDirect(doc, 'diagnostics-parse', ['base', 'paths', 'execPath']);
        for (const c of doc.direct as Record<string, unknown>[]) {
            shape(c.expect, ['diagnostics', 'truncated', 'serverKind'], [], `diagnostics-parse/direct/${String(c.id)}/expect`);
        }
    });
    it('test-runner', () => {
        const doc = load<Record<string, unknown>>('test-runner');
        shape(doc, ['suite', 'version', 'cases', 'direct'], [], 'test-runner');
        shapeCoreCases(doc, 'test-runner');
        shapeDirect(doc, 'test-runner', ['dir', 'execPath']);
        for (const c of doc.direct as Record<string, unknown>[]) expect(['npm', 'pytest', 'go', 'none']).toContain(c.expect);
    });
});

/** 도구 kind 는 묻지 않는다 — 확인 콜백이 불리면 실패한다. */
const noConfirm = (): Promise<'no'> => { throw new Error('읽기 전용 도구가 확인을 물었다'); };

async function runCoreCase(suite: string, kind: string, c: CoreCase): Promise<void> {
    const tmp = makeTmp();
    try {
        applyToolSetup(tmp, c.setup);
        await withEnv(runnerEnv(tmp), async () => {
            const core = new BridgeCore({ folder: path.join(tmp, c.root), confirm: noConfirm, sandboxProfileDir: path.join(tmp, 'prof') });
            core.prepare();
            for (const [n, r] of c.requests.entries()) {
                const at = `${suite}/cases/${c.id}/requests/${n}`;
                expect({ at, kind: r.msg.kind }).toEqual({ at, kind });
                const before = readToolCalls(tmp).length;
                const got = await exec(core, fill(r.msg, tmp));
                const want = fill(r.expect, tmp);
                expect({ at, result: toolView(got, r.compare, want, at) }).toStrictEqual({ at, result: want });
                if (r.toolCalls) {
                    const calls = readToolCalls(tmp).slice(before);
                    const wantCalls = fill(r.toolCalls, tmp);
                    expect({ at, toolCalls: toolCallsView(calls, wantCalls) }).toEqual({ at, toolCalls: wantCalls });
                }
            }
        });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

describe('glob', () => {
    const doc = load<{ cases: { id: string; glob: string; basenameOnly: boolean; tests: { text: string; expect: boolean }[] }[] }>('glob');
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => {
        const g = globToRegExp(c.glob);
        expect({ basenameOnly: g.basenameOnly }).toEqual({ basenameOnly: c.basenameOnly });
        for (const t of c.tests) expect({ text: t.text, match: g.re.test(t.text) }).toEqual({ text: t.text, match: t.expect });
    });
});

describe('code-nav', () => {
    const doc = load<{
        cases: CoreCase[];
        walk: { id: string; setup: ToolSetup[]; input: { start: string; deadline: 'past' | 'far' }; expect: unknown }[];
        secretFiles: { name: string; expect: boolean }[];
        excludedFiles: string[];
        excludedDirs: string[];
    }>('code-nav');

    it('excludedFiles 가 CODE_NAV_EXCLUDED_FILES(@openmake/config SENSITIVE_FILE_PATTERNS)와 순서까지 같다', () => {
        expect(doc.excludedFiles).toEqual([...CODE_NAV_EXCLUDED_FILES]);
    });
    it('excludedDirs 가 CODE_NAV_EXCLUDED_DIRS 와 순서까지 같다', () => {
        expect(doc.excludedDirs).toEqual([...CODE_NAV_EXCLUDED_DIRS]);
    });
    it('secretFiles', () => {
        for (const c of doc.secretFiles) expect({ name: c.name, secret: isSecretFile(c.name) }).toEqual({ name: c.name, secret: c.expect });
    });
    it.each(doc.walk.map((c) => [c.id, c] as const))('walk/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applyToolSetup(tmp, c.setup);
            const base = path.join(tmp, 'root');
            const deadline = c.input.deadline === 'past' ? Date.now() - 1000 : Date.now() + 600_000;
            expect(await walkFiles(base, path.join(base, c.input.start), deadline)).toEqual(c.expect);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => runCoreCase('code-nav', 'code_nav', c), 20000);
});

describe('diagnostics-parse', () => {
    type Input = { base: string; paths: string[]; execPath: string };
    const doc = load<{ cases: CoreCase[]; direct: Direct<Input, unknown>[] }>('diagnostics-parse');

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => runCoreCase('diagnostics-parse', 'lsp_diagnostics', c), 20000);

    it.each(doc.direct.map((c) => [c.id, c] as const))('direct/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applyToolSetup(tmp, c.setup);
            const input = fill(c.input, tmp);
            const got = await withEnv(runnerEnv(tmp), () => collectDiagnostics(input.base, input.paths, input.execPath));
            expect(got).toEqual(fill(c.expect, tmp));
            if (c.toolCalls) {
                const want = fill(c.toolCalls, tmp);
                expect(toolCallsView(readToolCalls(tmp), want)).toEqual(want);
            }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

describe('test-runner', () => {
    type Input = { dir: string; execPath: string };
    const doc = load<{ cases: CoreCase[]; direct: Direct<Input, string>[] }>('test-runner');

    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => runCoreCase('test-runner', 'test_runner', c), 20000);

    it.each(doc.direct.map((c) => [c.id, c] as const))('direct/%s', async (_id, c) => {
        const tmp = makeTmp();
        try {
            applyToolSetup(tmp, c.setup);
            const input = fill(c.input, tmp);
            const got = await withEnv(runnerEnv(tmp), () => detectTestRunner(input.dir, input.execPath));
            expect(got).toBe(c.expect);
            if (c.toolCalls) {
                const want = fill(c.toolCalls, tmp);
                expect(toolCallsView(readToolCalls(tmp), want)).toEqual(want);
            }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});
