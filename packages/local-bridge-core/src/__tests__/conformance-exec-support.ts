/**
 * conformance-exec.test.ts 의 도우미 — 테스트 파일이 아니다(jest testMatch 밖, 패키지 빌드에서도 빠진다).
 * conformance.test.ts 의 같은 이름 도우미와 겹치는 부분이 있다. 병행 PR(1.5)이 그 파일을 고치는 동안
 * 한쪽으로 모으지 않는다 — 테스트 파일을 import 하면 그 파일의 테스트가 두 번 등록된다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const DIR = path.join(__dirname, '..', '..', 'conformance');

export function load<T>(suite: string): T {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8')) as T;
}

/** 사례마다 새로 만드는 임시 폴더의 realpath — 가짜 홈(`home`)을 미리 만든다. */
export function makeTmp(): string {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-')));
    fs.mkdirSync(path.join(tmp, 'home'));
    return tmp;
}

function mapStrings(v: unknown, f: (s: string) => string): unknown {
    if (typeof v === 'string') return f(v);
    if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
    return v;
}
/** `{{TMP}}`·`{{HOME}}`(= `{{TMP}}/home`)·`{{BIN}}`(= `{{TMP}}/bin`) 를 채운다. */
export function fill<T>(v: T, tmp: string): T {
    return mapStrings(v, (s) => s.split('{{HOME}}').join(`${tmp}/home`).split('{{BIN}}').join(`${tmp}/bin`).split('{{TMP}}').join(tmp)) as T;
}

/** required 는 모두 있어야 하고, 그 밖의 키는 optional 만 쓸 수 있다. */
export function shape(o: unknown, required: string[], optional: string[], at: string): void {
    const keys = o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null;
    expect({ at, object: keys !== null }).toEqual({ at, object: true });
    expect({ at, missing: required.filter((k) => !keys!.includes(k)), unknown: keys!.filter((k) => !required.includes(k) && !optional.includes(k)) })
        .toEqual({ at, missing: [], unknown: [] });
}
/** 사례·단계 목록 — 0개면 실패한다. */
export function nonEmpty(v: unknown, at: string): Record<string, unknown>[] {
    expect({ at, nonEmptyArray: Array.isArray(v) && v.length > 0 }).toEqual({ at, nonEmptyArray: true });
    return v as Record<string, unknown>[];
}

/** 러너가 사례마다 주는 환경 — 가짜 비밀은 자식에 넘어가지 않는 것만 본다. 자동 승인 훅은 0(꺼짐)으로 심는다. */
export const FAKE_SECRETS: Record<string, string> = {
    OMK_COMPANION_API_KEY: 'omk-conformance-secret-1', GITHUB_TOKEN: 'omk-conformance-secret-2', OMK_BRIDGE_AUTO_APPROVE: '0',
};
export function runnerEnv(tmp: string): Record<string, string | null> {
    return { HOME: `${tmp}/home`, SHELL: '/bin/sh', LANG: 'C', ...FAKE_SECRETS };
}

/** 환경을 바꿔 fn 을 돌리고 되돌린다(null = 지운다). 같은 파일 안의 사례끼리 새지 않게 사례마다 쓴다. */
export async function withEnv<T>(vars: Record<string, string | null>, fn: () => Promise<T> | T): Promise<T> {
    const saved = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(vars)) {
        saved.set(k, process.env[k]);
        if (v === null) delete process.env[k]; else process.env[k] = v;
    }
    try { return await fn(); } finally {
        for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
export async function withPlatform<T>(p: NodeJS.Platform, fn: () => Promise<T> | T): Promise<T> {
    const desc = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...desc, value: p });
    try { return await fn(); } finally { Object.defineProperty(process, 'platform', desc); }
}

/** 사용자 git 설정·시스템 설정·서명이 끼어들지 않는 git — 작성자·날짜도 고정한다. */
export function gitIsolated(tmp: string, args: string[], cwd: string): string {
    const fixed = '2026-01-01T00:00:00+0000';
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            PATH: process.env.PATH ?? '', HOME: `${tmp}/home`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
            GIT_AUTHOR_DATE: fixed, GIT_COMMITTER_DATE: fixed,
        },
    });
}

export type Repeat = { line: string; count: number };
export type FileSpec = { file: string; content?: string; contentB64?: string; repeat?: Repeat };
export type Symlink = { symlink: string; target: string };
export type Setup = { dir: string } | FileSpec | { git: string[]; cwd: string } | Symlink;

function writeFile(tmp: string, s: FileSpec): void {
    const p = path.join(tmp, s.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (s.repeat) fs.writeFileSync(p, `${s.repeat.line}\n`.repeat(s.repeat.count));
    else fs.writeFileSync(p, s.contentB64 !== undefined ? Buffer.from(s.contentB64, 'base64') : (s.content ?? ''));
}

/** `{"symlink", "target"}` — target 은 `{{TMP}}` 를 채워 그대로 링크에 적는다(상대 target 가능). */
function symlink(tmp: string, s: Symlink): void { fs.symlinkSync(fill(s.target, tmp), path.join(tmp, s.symlink)); }

export const SETUP_KINDS = ['dir', 'file', 'git', 'symlink'];
export function applySetup(tmp: string, setup: Setup[]): void {
    for (const s of setup) {
        if ('dir' in s) fs.mkdirSync(path.join(tmp, s.dir), { recursive: true });
        else if ('file' in s) writeFile(tmp, s);
        else if ('git' in s) gitIsolated(tmp, s.git, path.join(tmp, s.cwd));
        else if ('symlink' in s) symlink(tmp, s);
        else throw new Error(`모르는 setup: ${JSON.stringify(s)}`);
    }
}

/** 요청이 아닌 단계 — 에이전트가 worktree 안에서 한 일을 흉내 낸다. git 단계의 stdout 을 적었으면 그 글자와 같아야 한다. */
export type OpStep = { git: string[]; cwd: string; stdout?: string } | FileSpec | { remove: string } | Symlink;
export function applyOpStep(tmp: string, s: OpStep, at: string): void {
    if ('git' in s) {
        const out = gitIsolated(tmp, s.git, path.join(tmp, s.cwd));
        if (s.stdout !== undefined) expect({ at, stdout: out }).toEqual({ at, stdout: s.stdout });
    } else if ('file' in s) writeFile(tmp, s);
    else if ('remove' in s) fs.rmSync(path.join(tmp, s.remove), { recursive: true, force: true });
    else if ('symlink' in s) symlink(tmp, s);
    else throw new Error(`${at}: 모르는 단계 ${JSON.stringify(s)}`);
}

/** 연결부(connection.ts)와 같이 예외를 {ok:false, error} 로 바꾼다(D-19). */
export function exec(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}

export const exists = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };

export type After = { exists: string; content?: string } | { absent: string } | { fileHas: string; line: string; count: number };
export function checkAfter(tmp: string, after: After[], at: string): void {
    for (const a of after) {
        if ('absent' in a) { expect({ at, absent: a.absent, exists: exists(path.join(tmp, a.absent)) }).toEqual({ at, absent: a.absent, exists: false }); continue; }
        if ('fileHas' in a) {
            const lines = fs.readFileSync(path.join(tmp, a.fileHas), 'utf8').split('\n');
            expect({ at, fileHas: a.fileHas, count: lines.filter((l) => l === a.line).length }).toEqual({ at, fileHas: a.fileHas, count: a.count });
            continue;
        }
        const p = path.join(tmp, a.exists);
        expect({ at, exists: a.exists, found: exists(p) }).toEqual({ at, exists: a.exists, found: true });
        if (a.content !== undefined) expect({ at, content: fs.readFileSync(p, 'utf8') }).toEqual({ at, content: a.content });
    }
}

/** after 항목의 키 — 세 suite 공통. */
export function shapeAfter(after: unknown, at: string): void {
    for (const a of nonEmpty(after, `${at}/after`)) {
        if ('absent' in a) shape(a, ['absent'], [], `${at}/after`);
        else if ('fileHas' in a) shape(a, ['fileHas', 'line', 'count'], [], `${at}/after`);
        else shape(a, ['exists'], ['content'], `${at}/after`);
    }
}

/**
 * 결과를 비교할 모양으로 바꾼다 — 기대값이 적은 것만 남긴다. 맞으면 기대값과 같은 객체가 된다.
 * no-stderr: stderr 를 뺀다 · stdout-length: stdout 대신 길이 · stdout-lines: 줄이 그 글자로 시작하는지(포함·불포함)
 * stdout-contains: stdout 이 그 글자를 담는지 · error-prefix: error 가 그 글자로 시작하는지.
 */
export const COMPARES = ['no-stderr', 'stdout-length', 'stdout-lines', 'stdout-contains', 'error-prefix'];
export function view(result: object, compare: string | undefined, want: Record<string, unknown>, at: string): Record<string, unknown> {
    const got = result as Record<string, unknown>;
    const { stdout, stderr, error, ...rest } = got;
    const out = String(stdout ?? '');
    const lines = out.split('\n');
    const keep = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    switch (compare) {
        case undefined: return got;
        case 'no-stderr': return keep({ ...rest, stdout, error });
        case 'stdout-length': return keep({ ...rest, stdoutLength: stdout === undefined ? undefined : out.length, stderr, error });
        case 'stdout-lines': return keep({
            ...rest, stderr, error,
            stdoutHas: (want.stdoutHas as string[]).filter((h) => lines.some((l) => l.startsWith(h))),
            stdoutLacks: (want.stdoutLacks as string[]).filter((h) => !lines.some((l) => l.startsWith(h))),
        });
        case 'stdout-contains': return keep({
            ...rest, stderr, error,
            stdoutContains: (want.stdoutContains as string[]).filter((h) => out.includes(h)),
            stdoutLacks: (want.stdoutLacks as string[]).filter((h) => !out.includes(h)),
        });
        case 'error-prefix': {
            const prefix = String(want.errorPrefix);
            return keep({ ...rest, stdout, stderr, errorPrefix: typeof error === 'string' && error.startsWith(prefix) ? prefix : error });
        }
        default: throw new Error(`${at}: 모르는 compare ${compare}`);
    }
}

/** 자기 환경·cwd 를 `<tmp>/<name>.env`·`.cwd` 에 남기고 `.out` 의 글자를 찍은 뒤 code 로 끝나는 가짜 실행 파일. */
export function fakeBin(tmp: string, dir: string, name: string, stdout: string, code: number): string {
    const p = path.join(tmp, dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(path.join(tmp, `${name}.out`), stdout);
    fs.writeFileSync(p, `#!/bin/sh\n/usr/bin/env > "${tmp}/${name}.env"\npwd -P > "${tmp}/${name}.cwd"\n/bin/cat "${tmp}/${name}.out"\nexit ${code}\n`);
    fs.chmodSync(p, 0o755);
    return p;
}
export function childEnv(tmp: string, name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(tmp, `${name}.env`), 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
}
