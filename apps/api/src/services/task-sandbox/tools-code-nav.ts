/**
 * Task 샌드박스 코드 탐색 도구 — grep_code · repo_map (2026-09-06).
 *
 * 30일 실측: bash 호출 444건 중 34% 가 grep/find/ls/cat 류 탐색이고 결과가 통째로 대화에 들어갔다.
 * 전용 읽기 도구는 ① 결과를 파일:줄 형태로 캡을 걸어 돌려주고 ② 승인 정책(high-risk=bash) 대상이
 * 아니라 승인 창 없이 돌며 ③ 이름에 'search' 가 없어 웹검색 상한(SEARCH_TOOL_KEYWORDS)에 안 잡힌다.
 *
 * 백엔드는 둘이다:
 *  ① 실행기가 `codeNav` 를 구현하면(로컬 브리지) 그 경로 — 디바이스가 셸 없이 파일을 훑는다.
 *     exec 로 내보내면 읽기 전용인데도 confirmExec 승인 창이 매 호출 떠서 실사용이 불가능했다.
 *  ② 아니면 sandbox.exec 위의 얇은 셸 래퍼(docker 샌드박스) — 컨테이너(ripgrep 포함)와 rg 없는
 *     환경 양쪽에서 돌도록 rg → grep 폴백을 두고 GNU 전용 옵션(find -printf·xargs -d)은 안 쓴다.
 * ①이 실패하거나 구 디바이스라 미지원이면 null 이 와서 ②로 폴백한다(fail-open).
 *
 * @module services/task-sandbox/tools-code-nav
 */
import type { MCPToolDefinition, MCPToolResult } from '../../mcp/types';
import type { TaskExecutor, ExecResult, CodeNavSpec } from './executor';
import { TASK_CODE_NAV } from '../../config/runtime-limits';

const PATTERN_MAX_CHARS = 500;
const EXIT_NOT_FOUND = 127;

/** 심볼 선언 줄 — TS/JS·Python·Go·Rust·Java/Kotlin 의 최상위 선언을 한 정규식으로. */
const SYMBOL_REGEX = String.raw`^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\s+\w+|^\s*(def|class)\s+\w+|^\s*(pub(\(crate\))?\s+)?(fn|struct|enum|trait|impl)\s+\w+|^func\s+(\([^)]*\)\s*)?\w+|^\s*(public|private|protected)\s+(static\s+)?(class|interface|\w+\s+\w+\s*\()`;

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

/** POSIX 셸 단일 인용 — 인용 안의 ' 만 닫고-이스케이프-열기. */
export function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 상대 경로만 허용(빈 값·"." 은 workspace 루트). 절대 경로·상위 탈출은 거절 — bash 와 달리 승인 없이 도는 도구라 범위를 좁힌다. */
export function normalizeRelPath(p: string): string | null {
    const t = p.trim();
    if (!t || t === '.') return '.';
    if (t.startsWith('/') || t.split(/[\\/]/).includes('..')) return null;
    return t.replace(/^\.\//, '');
}

function excludeGlobsRg(): string {
    return TASK_CODE_NAV.EXCLUDED_DIRS.map((d) => `-g ${shq(`!${d}/**`)}`).join(' ');
}
function excludeDirsGrep(): string {
    return TASK_CODE_NAV.EXCLUDED_DIRS.map((d) => `--exclude-dir=${shq(d)}`).join(' ');
}
function pruneFind(): string {
    // find <path> \( -name a -o -name b \) -prune -o -type f -print
    return `\\( ${TASK_CODE_NAV.EXCLUDED_DIRS.map((d) => `-name ${shq(d)}`).join(' -o ')} \\) -prune -o -type f -print`;
}

function clipLines(out: string, maxLines: number, maxChars: number): { lines: string[]; overflow: boolean } {
    const all = out.split('\n').filter((l) => l.length > 0);
    const lines = all.slice(0, maxLines).map((l) => l.replace(/^\.\//, '')).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars)}…` : l));
    return { lines, overflow: all.length > maxLines };
}

/** rg 로 먼저 시도하고, 실행 파일이 없으면(127) grep 으로 재시도한다. */
async function execWithGrepFallback(sandbox: TaskExecutor, rgCmd: string, grepCmd: string): Promise<{ r: ExecResult; via: 'rg' | 'grep' }> {
    const r = await sandbox.exec(rgCmd);
    if (r.exitCode !== EXIT_NOT_FOUND) return { r, via: 'rg' };
    return { r: await sandbox.exec(grepCmd), via: 'grep' };
}

/** 실행기 네이티브 탐색 시도 — 미구현·미지원·오류는 전부 null(호출측이 셸로 폴백). */
async function tryNative(sandbox: TaskExecutor, spec: CodeNavSpec): ReturnType<NonNullable<TaskExecutor['codeNav']>> {
    if (!sandbox.codeNav) return null;
    try { return await sandbox.codeNav(spec); } catch { return null; }
}

interface GrepOutcome {
    /** 매치 줄("파일:줄:내용"). 빈 배열 = 일치 없음. */
    lines: string[];
    overflow: boolean;
    /** 어느 백엔드가 돌았는지 — 사용자 안내(rg 부재)용. */
    via: 'native' | 'rg' | 'grep';
    /** 실행 실패(오류 문구). 있으면 lines 는 무의미. */
    error?: string;
}

/** grep 한 번 — 네이티브 우선, 아니면 셸(rg→grep). 캡·줄 절단은 이 함수가 단일 적용한다. */
async function runGrep(sandbox: TaskExecutor, o: {
    pattern: string; rel: string; glob?: string; ignoreCase?: boolean; max: number;
}): Promise<GrepOutcome> {
    const native = await tryNative(sandbox, {
        op: 'grep', path: o.rel, pattern: o.pattern, maxResults: o.max,
        ...(o.glob ? { glob: o.glob } : {}), ...(o.ignoreCase ? { ignoreCase: true } : {}),
    });
    if (native?.matches) {
        const { lines, overflow } = clipLines(native.matches.join('\n'), o.max, TASK_CODE_NAV.GREP_LINE_MAX_CHARS);
        return { lines, overflow: overflow || native.truncated === true, via: 'native' };
    }
    const head = `head -n ${o.max + 1}`;
    const ic = o.ignoreCase === true;
    const rgCmd = `rg -n --no-heading --color never --no-messages -m ${TASK_CODE_NAV.GREP_PER_FILE_MAX}`
        + `${ic ? ' -i' : ''} ${excludeGlobsRg()}${o.glob ? ` -g ${shq(o.glob)}` : ''} -e ${shq(o.pattern)} -- ${shq(o.rel)} | ${head}`;
    const grepCmd = `grep -rnI -E${ic ? 'i' : ''} ${excludeDirsGrep()}${o.glob ? ` --include=${shq(o.glob.replace(/^.*\//, ''))}` : ''}`
        + ` -e ${shq(o.pattern)} -- ${shq(o.rel)} | ${head}`;
    const { r, via } = await execWithGrepFallback(sandbox, rgCmd, grepCmd);
    if (r.timedOut) return { lines: [], overflow: false, via, error: '검색 시간 초과 — path/glob 으로 범위를 좁히세요.' };
    // 파이프 종료 코드는 head 의 것이라 rg/grep 의 1(무일치)·2(오류)를 못 본다 → 출력으로 판정.
    if (!r.stdout.trim()) {
        const err = r.stderr.trim();
        return { lines: [], overflow: false, via, ...(err ? { error: `검색 실패: ${err.slice(0, 500)}` } : {}) };
    }
    const { lines, overflow } = clipLines(r.stdout, o.max, TASK_CODE_NAV.GREP_LINE_MAX_CHARS);
    return { lines, overflow, via };
}

export function createCodeNavTools(sandbox: TaskExecutor): MCPToolDefinition[] {
    const grepCode: MCPToolDefinition = {
        tool: {
            name: 'grep_code',
            description: 'workspace 코드를 정규식으로 검색해 "파일:줄번호:내용" 목록을 돌려줍니다(ripgrep, 읽기 전용, '
                + `최대 ${TASK_CODE_NAV.GREP_MAX_RESULTS}줄). 심볼 정의·사용처·문자열을 찾을 때 bash grep 대신 쓰세요 — `
                + '결과가 캡으로 잘려 컨텍스트를 아낍니다. node_modules/.git/dist 는 자동 제외.',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: '정규식(rg 문법). 예: "function\\s+render", "TODO"' },
                    path: { type: 'string', description: 'workspace 상대 경로(파일 또는 디렉토리, 기본 ".")' },
                    glob: { type: 'string', description: '파일 글롭 필터. 예: "*.ts", "src/**/*.py"' },
                    ignore_case: { type: 'boolean', description: '대소문자 무시(기본 false)' },
                    max_results: { type: 'number', description: `최대 결과 줄 수(기본 ${TASK_CODE_NAV.GREP_MAX_RESULTS})` },
                },
                required: ['pattern'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const pattern = str(args.pattern);
            if (!pattern.trim()) return textResult('pattern 이 필요합니다.', true);
            if (pattern.length > PATTERN_MAX_CHARS) return textResult(`pattern 은 ${PATTERN_MAX_CHARS}자 이하여야 합니다.`, true);
            const rel = normalizeRelPath(str(args.path));
            if (rel === null) return textResult('path 는 workspace 상대 경로만 허용됩니다(절대 경로·.. 불가).', true);
            const glob = str(args.glob).trim();
            const ic = args.ignore_case === true;
            const max = Math.max(1, Math.min(
                Number.isFinite(Number(args.max_results)) && Number(args.max_results) > 0 ? Number(args.max_results) : TASK_CODE_NAV.GREP_MAX_RESULTS,
                TASK_CODE_NAV.GREP_MAX_RESULTS * 4,
            ));
            const out = await runGrep(sandbox, { pattern, rel, max, ...(glob ? { glob } : {}), ...(ic ? { ignoreCase: true } : {}) });
            if (out.error) return textResult(out.error, true);
            if (out.lines.length === 0) return textResult(`(일치 없음: ${pattern})`);
            const note = out.overflow ? `\n… ${max}줄에서 잘림 — pattern/path/glob 으로 좁히세요.` : '';
            return textResult(`${out.lines.join('\n')}${note}${out.via === 'grep' ? '\n(rg 미설치 — grep 사용)' : ''}`);
        },
    };

    const repoMap: MCPToolDefinition = {
        tool: {
            name: 'repo_map',
            description: 'workspace 코드 구조 개요를 돌려줍니다: 디렉토리별 파일 수·줄 수와 파일 목록(줄 수 포함), '
                + '선택적으로 최상위 심볼(function/class/def) 선언 위치. 코드 작업을 시작할 때 1회 호출해 '
                + '어디를 봐야 하는지 파악한 뒤 grep_code·file_ops read 로 좁혀 들어가세요(읽기 전용).',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'workspace 상대 경로(기본 ".")' },
                    symbols: { type: 'boolean', description: '심볼 선언 개요 포함(기본 true)' },
                },
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const rel = normalizeRelPath(str(args.path));
            if (rel === null) return textResult('path 는 workspace 상대 경로만 허용됩니다(절대 경로·.. 불가).', true);
            const withSymbols = args.symbols !== false;
            const maxFiles = TASK_CODE_NAV.MAP_MAX_FILES;
            const native = await tryNative(sandbox, { op: 'files', path: rel });
            let rows: { lines: number; path: string }[];
            let nativeTruncated = false;
            if (native?.files) {
                rows = native.files.map((f) => ({ lines: f.lines, path: f.path.replace(/^\.\//, '') }));
                nativeTruncated = native.truncated === true;
            } else {
                // 파일별 줄 수 — GNU 전용 옵션 없이(find -printf·xargs -d 는 macOS 로컬 브리지에 없다).
                const listCmd = `find ${shq(rel)} ${pruneFind()} | head -n ${maxFiles + 1} | while IFS= read -r f; do `
                    + `printf '%s\\t%s\\n' "$(wc -l < "$f" 2>/dev/null | tr -d ' ')" "$f"; done`;
                const list = await sandbox.exec(listCmd);
                if (list.timedOut) return textResult('구조 수집 시간 초과 — path 로 범위를 좁히세요.', true);
                rows = list.stdout.split('\n').filter((l) => l.includes('\t')).map((l) => {
                    const [n, ...rest] = l.split('\t');
                    return { lines: parseInt(n, 10) || 0, path: rest.join('\t').replace(/^\.\//, '') };
                });
            }
            if (rows.length === 0) return textResult(`(파일 없음: ${rel})`);
            const overflow = rows.length > maxFiles || nativeTruncated;
            const files = rows.slice(0, maxFiles).sort((a, b) => a.path.localeCompare(b.path));

            const dirs = new Map<string, { files: number; lines: number }>();
            for (const f of files) {
                const top = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) + '/' : '(root)';
                const d = dirs.get(top) ?? { files: 0, lines: 0 };
                d.files++; d.lines += f.lines; dirs.set(top, d);
            }
            const out: string[] = [
                `## 디렉토리 요약 (${files.length}개 파일${overflow ? `, ${maxFiles}개에서 잘림` : ''})`,
                ...[...dirs.entries()].sort((a, b) => b[1].lines - a[1].lines)
                    .map(([d, v]) => `- ${d}  파일 ${v.files} · ${v.lines}줄`),
                '',
                '## 파일 (줄 수)',
                ...files.map((f) => `${f.path} (${f.lines})`),
            ];
            if (withSymbols) {
                const sym = await runGrep(sandbox, { pattern: SYMBOL_REGEX, rel, max: TASK_CODE_NAV.MAP_MAX_SYMBOLS });
                if (!sym.error && sym.lines.length > 0) {
                    out.push('', '## 심볼 선언 (파일:줄)', ...sym.lines);
                    if (sym.overflow) out.push(`… ${TASK_CODE_NAV.MAP_MAX_SYMBOLS}줄에서 잘림 — grep_code 로 좁히세요.`);
                }
            }
            return textResult(out.join('\n'));
        },
    };

    return [grepCode, repoMap];
}
