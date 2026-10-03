/**
 * 편집 후 문법 검사 — 진단이 없는 실행기(Docker 샌드박스)에서 파일 쓰기 직후 문법만 확인한다.
 *
 * 로컬 실행기는 편집 결과에 컴파일러 진단이 붙지만(diagnostics-attach) 샌드박스에는 없어, 모델이 깨진 파일을
 * 쓰고도 한참 뒤 실행에서야 알았다. 이미지에 이미 있는 인터프리터로 가능한 것만 본다:
 *   - .js/.mjs/.cjs → `node --check`
 *   - .py           → `compile()` (py_compile 과 같은 검사지만 __pycache__ 를 남기지 않는다)
 *   - .json         → 서버에서 JSON.parse (명령을 돌리지 않는다)
 * 코드를 실행하지 않고, 아무것도 설치하지 않는다.
 *
 * **이번 편집이 만든 오류만** 알린다 — 편집 전 내용을 받았고 그것도 같은 검사에서 실패하면 조용히 넘어간다
 * (원래 깨져 있던 파일, node 가 직접 읽지 못하는 문법을 쓰는 파일).
 * 전 구간 fail-open: 인터프리터 없음·시간 초과·예외는 모두 null.
 *
 * @module services/task-sandbox/edit-syntax-check
 */
import { randomUUID } from 'crypto';
import type { TaskExecutor } from './executor';
import { shq } from './tools-code-nav';
import { EDIT_SYNTAX_CHECK, EDIT_SYNTAX_CHECKERS } from '../../config/agent-task-tools';
import { getEditSyntaxErrorNote } from '../../prompts/agent-task-tools';

const PY_COMPILE = `python3 -c 'import sys;compile(open(sys.argv[1],encoding="utf-8").read(),sys.argv[1],"exec")'`;

/** 셸 인자로 쓸 경로 — `-` 로 시작하면 옵션으로 읽히지 않게 ./ 를 붙인다. */
const argPath = (relPath: string): string => shq(relPath.startsWith('-') ? `./${relPath}` : relPath);

const COMMANDS = {
    node: { label: 'node --check', build: (p: string) => `node --check ${argPath(p)}` },
    python: { label: 'python', build: (p: string) => `${PY_COMPILE} ${argPath(p)}` },
} as const;

const tail = (s: string): string => {
    const t = s.trim();
    return t.length > EDIT_SYNTAX_CHECK.REPORT_MAX_CHARS ? `…${t.slice(-EDIT_SYNTAX_CHECK.REPORT_MAX_CHARS)}` : t;
};

function jsonError(content: string): string | null {
    try { JSON.parse(content); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** 명령으로 검사 — 오류 출력, 통과·검사 불가면 null. */
async function runCheck(sandbox: TaskExecutor, kind: keyof typeof COMMANDS, relPath: string): Promise<string | null> {
    const r = await sandbox.exec(COMMANDS[kind].build(relPath));
    if (r.exitCode === 0 || r.timedOut || r.exitCode === EDIT_SYNTAX_CHECK.EXIT_NOT_FOUND) return null;
    return (r.stderr || r.stdout).trim() || null;
}

/** 편집 전 내용도 같은 검사에서 실패하는가 — 같은 폴더의 임시 파일로 확인한다(모듈 종류 판정이 같아야 한다). */
async function wasBrokenBefore(sandbox: TaskExecutor, kind: keyof typeof COMMANDS, relPath: string, before: string): Promise<boolean> {
    const slash = relPath.lastIndexOf('/');
    const ext = relPath.slice(relPath.lastIndexOf('.'));
    const tmp = `${slash >= 0 ? relPath.slice(0, slash + 1) : ''}.syntax-prev-${randomUUID().slice(0, 8)}${ext}`;
    await sandbox.writeFile(tmp, before);
    try {
        return (await runCheck(sandbox, kind, tmp)) !== null;
    } finally {
        await sandbox.deleteFile(tmp).catch(() => { /* best-effort */ });
    }
}

/**
 * @param before 편집 전 내용(부분 편집일 때). 없으면 새로 쓴 파일로 보고 오류를 그대로 알린다.
 * @returns 결과 뒤에 붙일 안내, 없으면 null.
 */
export async function checkEditSyntax(
    sandbox: TaskExecutor, relPath: string, before?: string,
    enabled: boolean = EDIT_SYNTAX_CHECK.ENABLED,
): Promise<string | null> {
    if (!enabled) return null;
    const kind = EDIT_SYNTAX_CHECKERS[relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase()];
    if (!kind) return null;
    try {
        if (kind === 'json') {
            const err = jsonError(await sandbox.readFile(relPath));
            if (err === null || (before !== undefined && jsonError(before) !== null)) return null;
            return getEditSyntaxErrorNote(relPath, 'JSON', tail(err));
        }
        const err = await runCheck(sandbox, kind, relPath);
        if (err === null) return null;
        if (before !== undefined && await wasBrokenBefore(sandbox, kind, relPath, before)) return null;
        return getEditSyntaxErrorNote(relPath, COMMANDS[kind].label, tail(err));
    } catch {
        return null;
    }
}
