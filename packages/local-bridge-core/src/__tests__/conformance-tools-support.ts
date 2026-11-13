/**
 * conformance-tools.test.ts 의 도우미 — 테스트 파일이 아니다(jest testMatch 밖, 패키지 빌드에서도 빠진다).
 * 공통 도우미는 conformance-exec-support.ts 의 것을 가져다 쓰기만 한다(그 파일은 병행 PR 이 고친다).
 * 이 suite 들만 쓰는 setup 종류(`many`·`symlink`·`fakeTool`)를 먼저 처리하고 나머지(`dir`·`file`)는 기존 applySetup 에 넘긴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { applySetup, fill, shape, type Setup } from './conformance-exec-support';

export type ManySpec = { dir: string; count: number; prefix: string; kind: 'file' | 'dir'; content?: string };
export type FakeTool = { fakeTool: string; stdout: string; stderr: string; exit: number; record: string };
export type ToolSetup = Setup | { symlink: string; target: string } | { many: ManySpec } | FakeTool;

export const TOOL_SETUP_KINDS = ['dir', 'file', 'symlink', 'many', 'fakeTool'];

/** 가짜 도구 스크립트 — 셸 내장 명령과 절대경로만 쓴다(PATH 가 `{{BIN}}` 하나여도 돈다). 불릴 때마다 `{{TMP}}/calls/<n>` 에
 *  기록 이름·인자 수·인자(한 줄에 하나)·cwd·환경을 남긴다. 번호는 도구를 가리지 않고 이어진다(부른 순서를 본다). */
function fakeToolScript(tmp: string, t: FakeTool): string {
    const out = path.join(tmp, 'tools', `${t.record}.stdout`);
    const err = path.join(tmp, 'tools', `${t.record}.stderr`);
    return [
        '#!/bin/sh',
        `d="${tmp}/calls"`,
        'n=0',
        'while [ -e "$d/$n" ]; do n=$((n+1)); done',
        `{ printf '%s\\n' "${t.record}" "$#"; for a in "$@"; do printf '%s\\n' "$a"; done; pwd -P; /usr/bin/env; } > "$d/$n"`,
        `/bin/cat "${out}"`,
        `/bin/cat "${err}" >&2`,
        `exit ${t.exit}`,
        '',
    ].join('\n');
}

export function applyToolSetup(tmp: string, setup: ToolSetup[]): void {
    for (const s of setup) {
        if ('symlink' in s) fs.symlinkSync(fill(s.target, tmp), path.join(tmp, s.symlink));
        else if ('many' in s) {
            const m = s.many;
            fs.mkdirSync(path.join(tmp, m.dir), { recursive: true });
            for (let i = 0; i < m.count; i++) {
                const p = path.join(tmp, m.dir, `${m.prefix}${i}`);
                if (m.kind === 'dir') fs.mkdirSync(p); else fs.writeFileSync(p, m.content ?? '');
            }
        } else if ('fakeTool' in s) {
            fs.mkdirSync(path.join(tmp, 'tools'), { recursive: true });
            fs.mkdirSync(path.join(tmp, 'calls'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'tools', `${s.record}.stdout`), fill(s.stdout, tmp));
            fs.writeFileSync(path.join(tmp, 'tools', `${s.record}.stderr`), fill(s.stderr, tmp));
            const p = path.join(tmp, s.fakeTool);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, fakeToolScript(tmp, s));
            fs.chmodSync(p, 0o755);
        } else applySetup(tmp, [s]);
    }
}

export function shapeToolSetup(setup: unknown, at: string): void {
    expect({ at, setupArray: Array.isArray(setup) }).toEqual({ at, setupArray: true });
    for (const s of setup as Record<string, unknown>[]) {
        const kind = TOOL_SETUP_KINDS.find((k) => k in s);
        const sat = `${at}/setup`;
        expect({ at: sat, setupKind: kind ?? Object.keys(s) }).toEqual({ at: sat, setupKind: kind });
        if (kind === 'dir') shape(s, ['dir'], [], sat);
        if (kind === 'file') shape(s, ['file'], ['content', 'contentB64', 'repeat'], sat);
        if (kind === 'symlink') shape(s, ['symlink', 'target'], [], sat);
        if (kind === 'many') shape(s.many, ['dir', 'count', 'prefix', 'kind'], ['content'], `${sat}/many`);
        if (kind === 'fakeTool') shape(s, ['fakeTool', 'stdout', 'stderr', 'exit', 'record'], [], sat);
    }
}

export type ToolCall = { tool: string; args: string[]; cwd: string; env: Record<string, string> };

/** 가짜 도구가 남긴 기록을 부른 순서대로 읽는다. 폴더가 없으면 빈 목록. */
export function readToolCalls(tmp: string): ToolCall[] {
    const dir = path.join(tmp, 'calls');
    const out: ToolCall[] = [];
    for (let n = 0; fs.existsSync(path.join(dir, String(n))); n++) {
        const lines = fs.readFileSync(path.join(dir, String(n)), 'utf8').split('\n');
        const argc = Number(lines[1]);
        const env: Record<string, string> = {};
        for (const line of lines.slice(3 + argc)) {
            const i = line.indexOf('=');
            if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
        }
        out.push({ tool: lines[0], args: lines.slice(2, 2 + argc), cwd: lines[2 + argc], env });
    }
    return out;
}

export type WantCall = { tool: string; args: string[]; cwd: string; envHas: string[]; envLacks: string[] };

/** 기록을 기대값 모양으로 — envHas 는 있는 키만, envLacks 는 없는 키만 남긴다(맞으면 기대값과 같다). */
export function toolCallsView(calls: ToolCall[], want: WantCall[]): WantCall[] {
    return calls.map((c, i) => ({
        tool: c.tool, args: c.args, cwd: c.cwd,
        envHas: (want[i]?.envHas ?? []).filter((k) => k in c.env),
        envLacks: (want[i]?.envLacks ?? []).filter((k) => !(k in c.env)),
    }));
}

export function shapeToolCalls(v: unknown, at: string): void {
    expect({ at, toolCallsArray: Array.isArray(v) }).toEqual({ at, toolCallsArray: true });
    for (const c of v as unknown[]) shape(c, ['tool', 'args', 'cwd', 'envHas', 'envLacks'], [], `${at}/toolCalls`);
}

/**
 * code-nav 결과 비교 모양 — counts: codeNav 의 matches·files 대신 개수(캡에 걸린 부분집합은 OS 열거 순서에 달렸다, D-67).
 * error-prefix: error 가 그 글자로 시작하는지.
 */
export const TOOL_COMPARES = ['counts', 'error-prefix'];
export function toolView(result: object, compare: string | undefined, want: Record<string, unknown>, at: string): Record<string, unknown> {
    const got = result as Record<string, unknown>;
    switch (compare) {
        case undefined: return got;
        case 'counts': {
            const nav = { ...(got.codeNav as Record<string, unknown> | undefined) };
            const wantNav = (want.codeNav ?? {}) as Record<string, unknown>;
            if ('matchesCount' in wantNav) { nav.matchesCount = (nav.matches as unknown[] | undefined)?.length; delete nav.matches; }
            if ('filesCount' in wantNav) { nav.filesCount = (nav.files as unknown[] | undefined)?.length; delete nav.files; }
            return { ...got, codeNav: nav };
        }
        case 'error-prefix': {
            const { error, ...rest } = got;
            const prefix = String(want.errorPrefix);
            return { ...rest, errorPrefix: typeof error === 'string' && error.startsWith(prefix) ? prefix : error };
        }
        default: throw new Error(`${at}: 모르는 compare ${compare}`);
    }
}

/** compare 별 기대값 모양 — counts 는 개수 키가 정확히 하나, error-prefix 는 비어 있지 않은 글자. */
export function shapeToolCompare(r: Record<string, unknown>, at: string): void {
    if (r.compare === undefined) return;
    expect(TOOL_COMPARES).toContain(r.compare);
    for (const key of ['expect', 'rustExpect']) {
        const w = r[key] as Record<string, unknown> | undefined;
        if (!w || typeof w !== 'object') continue;
        if (r.compare === 'counts') {
            const nav = (w.codeNav ?? {}) as Record<string, unknown>;
            const n = ['matchesCount', 'filesCount'].filter((k) => k in nav).length;
            expect({ at: `${at}/${key}`, countKeys: n }).toEqual({ at: `${at}/${key}`, countKeys: 1 });
        }
        if (r.compare === 'error-prefix' && key === 'expect') {
            const ok = typeof w.errorPrefix === 'string' && w.errorPrefix !== '';
            expect({ at: `${at}/${key}`, errorPrefix: ok }).toEqual({ at: `${at}/${key}`, errorPrefix: true });
        }
    }
}
