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
import * as constants from '../constants';

const DIR = path.join(__dirname, '..', '..', 'conformance');
const KNOWN_SUITES = ['constants', 'denylist', 'exec-env', 'platform', 'sandbox-profile'];
/** Rust(regress)만 다른 판정을 내도 되는 차이 — conformance/README.md "알려진 차이". */
const KNOWN_DIVERGENCES = ['regress-nonunicode-i-fold'];

type Platform = 'darwin' | 'linux' | 'win32';
interface Case<I, E> { id: string; input: I; expect: E; rustExpect?: unknown; divergence?: string }

function load<T>(suite: string): T {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8')) as T;
}

describe('conformance fixture 목록', () => {
    it('suite 파일은 이 러너가 아는 것뿐이고, 파일 이름과 suite 이름이 같다', () => {
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
        expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(KNOWN_SUITES);
        for (const f of files) {
            const doc = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as { suite: string; version: number };
            expect(`${doc.suite}.json`).toBe(f);
            expect(doc.version).toBe(1);
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
            expect(KNOWN_DIVERGENCES).toContain(c.divergence);
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
    const doc = load<{ cases: Case<{ root: string; gitDir: string | null }, { profile: string }>[] }>('sandbox-profile');
    let dir = '';
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-')); });
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it.each(doc.cases.map((c, i) => [c.id, c, i] as const))('%s — 프로파일 전체 텍스트가 같다', (_id, c, i) => {
        const out = path.join(dir, `p${i}.sb`);
        expect(writeSandboxProfile(c.input.root, c.input.gitDir, out)).toBe(out);
        const home = fs.realpathSync(os.homedir());
        expect(fs.readFileSync(out, 'utf8')).toBe(c.expect.profile.split('{{HOME}}').join(home));
    });
});
