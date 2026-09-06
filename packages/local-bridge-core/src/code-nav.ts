/**
 * 코드 탐색(code_nav) — grep_code·repo_map 의 디바이스측 구현 (2026-09-06).
 *
 * 왜 별도 kind 인가: 이 두 도구는 읽기 전용인데 `exec` 로 내보내면 셸 명령이라 confirmExec
 * (비우회 승인 창)를 매번 띄우고 EXEC_DENYLIST·sandbox-exec 를 거친다. 탐색 한 번에 승인이
 * 뜨면 실사용이 불가능하다. lsp_diagnostics 와 같은 취지 — **읽기 전용이고 실행 인자를
 * 디바이스가 고정 조립하면 승인 게이트 없이 처리한다**.
 *
 * 구현 원칙:
 *  - 외부 실행 파일을 쓰지 않는다(ripgrep 미설치 Mac 에서도 동일하게 동작). 셸을 거치지 않으므로
 *    명령 주입 표면이 없고, 서버가 보내는 값은 정규식·글롭·경로뿐이다.
 *  - 경로는 호출부(core.ts)가 safeFromAsync 로 스코프를 확정한 뒤 넘긴다. walk 는 심링크를
 *    따라가지 않는다(scope 밖 탈출 차단 — listAll 의 walk 와 같은 규칙).
 *  - 폭주 방지는 전적으로 캡이다(승인 게이트가 없으므로): 파일 수·파일 크기·매치 수·시간 예산.
 *  - ⚠️ 정규식은 모델이 만든 값이라 파국적 백트래킹이 가능하다. 파일 크기 상한과 파일 사이
 *    데드라인 검사로 피해를 한 파일로 묶는다(한 파일 안의 백트래킹은 중단할 수 없다).
 *
 * @module code-nav
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    CODE_NAV_EXCLUDED_DIRS, CODE_NAV_LINE_MAX_CHARS, CODE_NAV_MAX_FILE_BYTES, CODE_NAV_MAX_FILES,
    CODE_NAV_MAX_MATCHES, CODE_NAV_MAX_PER_FILE, CODE_NAV_PATTERN_MAX_CHARS, CODE_NAV_TIMEOUT_MS,
} from './constants';
import type { BridgeCodeNav, BridgeMsg } from './types';

const fsp = fs.promises;

/** 글롭 → 정규식. '/' 가 없으면 파일명에만 적용한다(grep --include·rg -g 관행). */
export function globToRegExp(glob: string): { re: RegExp; basenameOnly: boolean } {
    const basenameOnly = !glob.includes('/');
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; } else out += '[^/]*';
        } else if (c === '?') out += '[^/]';
        else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return { re: new RegExp(`^${out}$`), basenameOnly };
}

/** 바이너리 추정 — 앞부분에 NUL 이 있으면 텍스트가 아니다(grep -I 과 같은 판정). */
function looksBinary(buf: Buffer): boolean {
    return buf.subarray(0, 8192).includes(0);
}

interface WalkResult {
    /** base 기준 상대경로(POSIX 구분자). */
    files: string[];
    truncated: boolean;
}

/**
 * base 아래 파일을 나열한다. 제외 디렉토리·심링크는 건너뛰고, 파일 수 상한에서 자른다.
 * startAbs 가 파일이면 그 파일 하나만 대상이 된다(경로로 한 파일을 지목한 경우).
 */
export async function walkFiles(baseAbs: string, startAbs: string, deadline: number): Promise<WalkResult> {
    const st = await fsp.stat(startAbs).catch(() => null);
    if (!st) return { files: [], truncated: false };
    const rel = (abs: string): string => path.relative(baseAbs, abs).split(path.sep).join('/');
    if (st.isFile()) return { files: [rel(startAbs)], truncated: false };

    const files: string[] = [];
    let truncated = false;
    const stack: string[] = [startAbs];
    while (stack.length > 0) {
        if (files.length >= CODE_NAV_MAX_FILES || Date.now() > deadline) { truncated = true; break; }
        const dir = stack.pop() as string;
        const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
            if (e.isSymbolicLink()) continue;                       // 심링크는 따라가지 않는다(스코프 탈출 차단)
            // 제외 이름은 종류를 가리지 않는다 — git worktree 의 `.git` 은 디렉토리가 아니라
            // gitdir 포인터 **파일**이라, 디렉토리만 걸러내면 목록에 섞여 들어온다(라이브 실측).
            // 셸 폴백의 find -prune 은 이미 이름 기준이라 이렇게 해야 두 백엔드가 같은 결과를 낸다.
            if (CODE_NAV_EXCLUDED_DIRS.includes(e.name)) continue;
            if (e.isDirectory()) {
                stack.push(path.join(dir, e.name));
            } else if (e.isFile()) {
                if (files.length >= CODE_NAV_MAX_FILES) { truncated = true; break; }
                files.push(rel(path.join(dir, e.name)));
            }
        }
    }
    files.sort();
    return { files, truncated };
}

/** grep — 파일을 훑어 "상대경로:줄번호:내용" 목록을 만든다. */
async function grep(baseAbs: string, startAbs: string, m: BridgeMsg, deadline: number): Promise<BridgeCodeNav> {
    const src = String(m.pattern ?? '');
    if (!src.trim()) throw new Error('pattern 이 필요합니다');
    if (src.length > CODE_NAV_PATTERN_MAX_CHARS) throw new Error(`pattern 이 너무 깁니다 (${CODE_NAV_PATTERN_MAX_CHARS}자 이하)`);
    let re: RegExp;
    try { re = new RegExp(src, m.ignoreCase ? 'i' : ''); } catch (e) {
        throw new Error(`정규식이 올바르지 않습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
    const globFilter = m.glob ? globToRegExp(String(m.glob)) : null;
    const cap = Math.min(
        Number.isFinite(Number(m.maxResults)) && Number(m.maxResults) > 0 ? Number(m.maxResults) : CODE_NAV_MAX_MATCHES,
        CODE_NAV_MAX_MATCHES,
    );

    const walked = await walkFiles(baseAbs, startAbs, deadline);
    const matches: string[] = [];
    let truncated = walked.truncated;
    for (const rel of walked.files) {
        if (matches.length >= cap || Date.now() > deadline) { truncated = true; break; }
        if (globFilter && !globFilter.re.test(globFilter.basenameOnly ? path.posix.basename(rel) : rel)) continue;
        const abs = path.join(baseAbs, rel);
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || st.size > CODE_NAV_MAX_FILE_BYTES) continue;
        const buf = await fsp.readFile(abs).catch(() => null);
        if (!buf || looksBinary(buf)) continue;
        const lines = buf.toString('utf8').split('\n');
        let perFile = 0;
        for (let i = 0; i < lines.length; i++) {
            if (perFile >= CODE_NAV_MAX_PER_FILE) { truncated = true; break; }
            if (matches.length >= cap) { truncated = true; break; }
            if (!re.test(lines[i])) continue;
            const text = lines[i].replace(/\r$/, '');
            matches.push(`${rel}:${i + 1}:${text.length > CODE_NAV_LINE_MAX_CHARS ? `${text.slice(0, CODE_NAV_LINE_MAX_CHARS)}…` : text}`);
            perFile++;
        }
    }
    return { matches, truncated };
}

/** files — 파일별 줄 수(구조 개요용). 내용은 돌려주지 않는다. */
async function files(baseAbs: string, startAbs: string, deadline: number): Promise<BridgeCodeNav> {
    const walked = await walkFiles(baseAbs, startAbs, deadline);
    const out: { path: string; lines: number }[] = [];
    let truncated = walked.truncated;
    for (const rel of walked.files) {
        if (Date.now() > deadline) { truncated = true; break; }
        const abs = path.join(baseAbs, rel);
        const st = await fsp.stat(abs).catch(() => null);
        if (!st) continue;
        if (st.size > CODE_NAV_MAX_FILE_BYTES) { out.push({ path: rel, lines: 0 }); continue; }
        const buf = await fsp.readFile(abs).catch(() => null);
        if (!buf || looksBinary(buf)) { out.push({ path: rel, lines: 0 }); continue; }
        const text = buf.toString('utf8');
        out.push({ path: rel, lines: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0) });
    }
    return { files: out, truncated };
}

/**
 * code_nav 진입점. startAbs 는 호출부가 스코프를 확정한 절대경로여야 한다.
 * op 는 'grep' | 'files' 만 허용한다(그 외는 오류 — 임의 연산 금지).
 */
export async function runCodeNav(baseAbs: string, startAbs: string, m: BridgeMsg): Promise<BridgeCodeNav> {
    const deadline = Date.now() + CODE_NAV_TIMEOUT_MS;
    if (m.op === 'grep') return grep(baseAbs, startAbs, m, deadline);
    if (m.op === 'files') return files(baseAbs, startAbs, deadline);
    throw new Error(`지원하지 않는 code_nav op: ${m.op}`);
}
