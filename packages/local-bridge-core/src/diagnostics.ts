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
 *   - Python: `python3 -I -m py_compile <file>`(격리 모드 — cwd 의 `py_compile.py` 를 import 하지 않는다)
 *   - 그 외 : no-op(`serverKind:'none'`) — 조용히 빈 결과
 * 도구가 없으면 실행하지 않는다(설치 시도 금지). 결과는 캡·타임아웃으로 제한하고, 실패는
 * 호출측에서 fail-open 으로 흡수한다.
 *
 * 보안: 실행 파일·인자는 **코어가 고정 조립**한다(모델·서버 입력이 명령줄에 들어가지 않는다).
 * 경로는 호출측이 `safeFromAsync` 로 스코프를 확정한 절대경로만 넘긴다. tsc 는 폴더가 주는 실행 파일이므로
 * 자식은 도구 프로파일(exec 프로파일 + 네트워크 차단) 안에서 띄운다(`wrapInSandbox`, 프로파일이 없으면 띄우지 않고 거절).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { DIAG_MAX_PER_FILE, DIAG_MAX_TOTAL, DIAG_MSG_MAX, DIAG_TIMEOUT_MS, MAX_BUFFER } from './constants';
import { buildExecEnv } from './exec-env';
import { absPathEntries, onPath } from './exec-path';
import { sandboxExecError, sandboxExecFailed, wrapInSandbox } from './sandbox';
import type { BridgeDiagnostic } from './types';

const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = new Set(['.py']);

function run(file: string, args: string[], cwd: string, extraPath: string | undefined, sandbox: string | null | undefined): Promise<{ stdout: string; stderr: string }> {
    const cmd = wrapInSandbox(file, args, sandbox); // 프로파일 없음이면 여기서 throw — 자식을 띄우지 않는다
    const wrapped = typeof sandbox === 'string';
    const envPath = extraPath || absPathEntries(process.env.PATH || process.env.Path || '');
    // 감쌀 때 이름으로 띄우는 실행 파일(python3)은 먼저 찾는다 — 없으면 sandbox-exec 의 execvp 실패(71)가 아니라
    // 종전과 같은 "띄우지 못함"(빈 출력)이다.
    if (wrapped && !file.includes('/') && !onPath(file, envPath)) return Promise.resolve({ stdout: '', stderr: '' });
    return new Promise((resolve, reject) => {
        execFile(
            cmd.file, cmd.args,
            {
                cwd,
                timeout: DIAG_TIMEOUT_MS,
                maxBuffer: MAX_BUFFER,
                encoding: 'utf8',
                // 레포의 tsc·python3 가 도는 자리 — 호스트 env 전체가 아니라 exec 와 같은 allowlist 만 넘긴다.
                env: buildExecEnv(process.env, envPath),
            },
            (err, stdout, stderr) => {
                // sandbox-exec 자체 실패(프로파일 파일 유실 등)는 "진단 없음"으로 삼키지 않고 프로파일 없음과 같이 거절한다.
                if (err && sandboxExecFailed(wrapped, err.code, String(stderr ?? ''))) reject(sandboxExecError(err.code, file));
                else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
            },
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
 * @param sandbox 자식을 감쌀 도구 프로파일 — undefined 면 감싸지 않고, null 이면 자식을 띄워야 할 때 거절한다(`wrapInSandbox`)
 */
export async function collectDiagnostics(
    base: string,
    absPaths: string[],
    execPath?: string,
    sandbox?: string | null,
): Promise<{ diagnostics: BridgeDiagnostic[]; truncated: boolean; serverKind: string }> {
    // base 의 엄격한 하위만 — 대상이 연결 폴더 자신이면(`paths: ['.']`, 이름이 `.ts` 로 끝나는 폴더) 위로 찾기가 폴더 **밖**에서
    // 시작해 조상의 tsconfig·tsc 를 실행했다(설계 D-9). 그 밖은 조용히 건너뛴다(디렉터리는 진단 대상이 아니다).
    const inBase = absPaths.filter((p) => p !== base && p.startsWith(base + path.sep));
    const ts = inBase.filter((p) => TS_EXT.has(path.extname(p)));
    const py = inBase.filter((p) => PY_EXT.has(path.extname(p)));
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
            const { stdout, stderr } = await run(tsc, ['--noEmit', '--pretty', 'false', '-p', cfg], cwd, execPath, sandbox);
            all.push(...parseTsc(`${stdout}\n${stderr}`, base, cwd));
            kinds.push('tsc');
        }
    }

    // Python — 파일 단위 문법 검사(py_compile 은 표준 라이브러리라 별도 설치가 없다).
    for (const f of py) {
        const { stdout, stderr } = await run('python3', ['-I', '-m', 'py_compile', f], base, execPath, sandbox);
        const out = `${stdout}\n${stderr}`;
        if (/Error|error/.test(out)) all.push(...parsePyCompile(out, base, f));
        kinds.push('py_compile');
    }

    const { diagnostics, truncated } = capDiagnostics(all);
    return { diagnostics, truncated, serverKind: kinds.length ? [...new Set(kinds)].join('+') : 'none' };
}
