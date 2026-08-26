/**
 * 편집 후 진단(LSP diagnostics-first, 1단계) — 디바이스에서 실행한다.
 *
 * 목적: 로컬 작업에서 파일을 고친 직후 컴파일러 진단을 도구 결과에 붙여, 하네스가 **같은 턴에**
 * 고치게 한다. 그전까지 품질 신호는 셸 실행 결과(tsc/테스트 출력)뿐이라 모델이 "고쳤다"고 하고
 * 끝나는 실패가 남았다(plan `2026-08-26-openmake-code-lsp-diagnostics-plan.md`).
 *
 * 1단계는 **언어 서버 없이도 도는 폴백만** 쓴다 — 프로젝트에 이미 있는 도구만 쓰므로 사용자가
 * 무엇도 설치할 필요가 없다:
 *   - TS/JS : 레포의 `node_modules/.bin/tsc --noEmit -p <가장 가까운 tsconfig>`
 *   - Python: `python3 -m py_compile <file>`
 *   - 그 외 : no-op(`serverKind:'none'`) — 조용히 빈 결과
 * 도구가 없으면 실행하지 않는다(설치 시도 금지). 결과는 캡·타임아웃으로 제한하고, 실패는
 * 호출측에서 fail-open 으로 흡수한다.
 *
 * 보안: 실행 파일·인자는 **코어가 고정 조립**한다(모델·서버 입력이 명령줄에 들어가지 않는다).
 * 경로는 호출측이 `safeFromAsync` 로 스코프를 확정한 절대경로만 넘긴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { DIAG_MAX_PER_FILE, DIAG_MAX_TOTAL, DIAG_MSG_MAX, DIAG_TIMEOUT_MS, MAX_BUFFER } from './constants';
import type { BridgeDiagnostic } from './types';

const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = new Set(['.py']);

function run(file: string, args: string[], cwd: string, extraPath?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        execFile(
            file, args,
            {
                cwd,
                timeout: DIAG_TIMEOUT_MS,
                maxBuffer: MAX_BUFFER,
                encoding: 'utf8',
                env: extraPath ? { ...process.env, PATH: extraPath } : process.env,
            },
            (_err, stdout, stderr) => resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
        );
    });
}

/** 파일에서 위로 올라가며 가장 가까운 tsconfig.json — 없으면 null. base 밖으로는 나가지 않는다. */
function nearestTsconfig(fileAbs: string, base: string): string | null {
    let dir = path.dirname(fileAbs);
    for (;;) {
        const candidate = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(candidate)) return candidate;
        if (dir === base || dir === path.dirname(dir)) return null;
        dir = path.dirname(dir);
    }
}

/** 레포에 설치된 tsc — 파일 위치부터 base 까지 node_modules/.bin/tsc 를 찾는다(전역 설치는 쓰지 않는다). */
function findLocalTsc(fileAbs: string, base: string): string | null {
    let dir = path.dirname(fileAbs);
    for (;;) {
        const bin = path.join(dir, 'node_modules', '.bin', 'tsc');
        if (fs.existsSync(bin)) return bin;
        if (dir === base || dir === path.dirname(dir)) return null;
        dir = path.dirname(dir);
    }
}

/** `path/to/a.ts(12,5): error TS2322: msg` (tsc 기본 포맷, --pretty false 로 강제) */
const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+):\s+(.*)$/;

function parseTsc(out: string, base: string, cwd: string): BridgeDiagnostic[] {
    const diags: BridgeDiagnostic[] = [];
    for (const raw of out.split('\n')) {
        const m = TSC_LINE.exec(raw.trim());
        if (!m) continue;
        const abs = path.resolve(cwd, m[1]);
        diags.push({
            path: path.relative(base, abs).split(path.sep).join('/'),
            line: Number(m[2]),
            col: Number(m[3]),
            severity: m[4] === 'warning' ? 'warning' : 'error',
            code: m[5],
            message: m[6].slice(0, DIAG_MSG_MAX),
            source: 'tsc',
        });
    }
    return diags;
}

/** `File "/abs/a.py", line 3` + 마지막 줄이 메시지 (py_compile 표준 오류 포맷) */
function parsePyCompile(out: string, base: string, fileAbs: string): BridgeDiagnostic[] {
    if (!out.trim()) return [];
    const lineM = /line (\d+)/.exec(out);
    const lines = out.trim().split('\n').filter(Boolean);
    const message = (lines[lines.length - 1] ?? out).trim().slice(0, DIAG_MSG_MAX);
    return [{
        path: path.relative(base, fileAbs).split(path.sep).join('/'),
        line: lineM ? Number(lineM[1]) : 1,
        col: 1,
        severity: 'error',
        message,
        source: 'py_compile',
    }];
}

/** 파일당 상한 → 전체 상한 순으로 자른다. 잘렸으면 truncated. */
function capDiagnostics(all: BridgeDiagnostic[]): { diagnostics: BridgeDiagnostic[]; truncated: boolean } {
    const perFile = new Map<string, number>();
    const kept: BridgeDiagnostic[] = [];
    let truncated = false;
    for (const d of all) {
        const n = perFile.get(d.path) ?? 0;
        if (n >= DIAG_MAX_PER_FILE) { truncated = true; continue; }
        if (kept.length >= DIAG_MAX_TOTAL) { truncated = true; break; }
        perFile.set(d.path, n + 1);
        kept.push(d);
    }
    return { diagnostics: kept, truncated };
}

/**
 * 지정한 파일들의 진단을 모은다. 실행할 도구가 없으면 빈 결과 + `serverKind:'none'`.
 * @param base 스코프 루트(연결/선택 폴더의 실경로)
 * @param absPaths 이미 스코프 검증된 절대경로들
 */
export async function collectDiagnostics(
    base: string,
    absPaths: string[],
    execPath?: string,
): Promise<{ diagnostics: BridgeDiagnostic[]; truncated: boolean; serverKind: string }> {
    const ts = absPaths.filter((p) => TS_EXT.has(path.extname(p)));
    const py = absPaths.filter((p) => PY_EXT.has(path.extname(p)));
    const all: BridgeDiagnostic[] = [];
    const kinds: string[] = [];

    // TS/JS — tsconfig 단위로 1회만 실행(같은 프로젝트의 여러 파일을 한 번에 검사).
    if (ts.length > 0) {
        const byProject = new Map<string, string>(); // tsconfig → tsc 실행파일
        for (const f of ts) {
            const cfg = nearestTsconfig(f, base);
            const tsc = findLocalTsc(f, base);
            if (cfg && tsc && !byProject.has(cfg)) byProject.set(cfg, tsc);
        }
        for (const [cfg, tsc] of byProject) {
            const cwd = path.dirname(cfg);
            const { stdout, stderr } = await run(tsc, ['--noEmit', '--pretty', 'false', '-p', cfg], cwd, execPath);
            all.push(...parseTsc(`${stdout}\n${stderr}`, base, cwd));
            kinds.push('tsc');
        }
    }

    // Python — 파일 단위 문법 검사(py_compile 은 표준 라이브러리라 별도 설치가 없다).
    for (const f of py) {
        const { stdout, stderr } = await run('python3', ['-m', 'py_compile', f], base, execPath);
        const out = `${stdout}\n${stderr}`;
        if (/Error|error/.test(out)) all.push(...parsePyCompile(out, base, f));
        kinds.push('py_compile');
    }

    const { diagnostics, truncated } = capDiagnostics(all);
    return { diagnostics, truncated, serverKind: kinds.length ? [...new Set(kinds)].join('+') : 'none' };
}
