/**
 * 도구 호출 한 줄 요약 — "무엇을 했고(명령·경로·질의) 결과가 어땠나(성공/오류·종료 코드)".
 *
 * 접힌 스텁(context-fold)은 종전에 도구 이름·글자 수·앞 240자만 남겨, 접힌 뒤에는 어떤 명령이었고
 * 성공했는지 알 수 없었다. 호출 인자는 앞선 assistant 의 tool_calls 에 남아 있으므로 거기서 읽는다.
 * 규칙은 결정적이다(LLM 없음). 주요 도구(셸·파일 편집/보기·검색·브라우저)만 다루고 나머지는 null.
 *
 * @module services/agent-task/tool-digest
 */
import { TOOL_DIGEST } from '../../config/agent-task-context';
import { TOOL_DIGEST_OUTCOME, getToolDigestLine } from '../../prompts/agent-task-context';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import type { ChatMessage } from '../../llm/types';

type Args = Record<string, unknown>;

/** 셸 결과 끝의 종료 줄 — task-sandbox/tools.ts formatExec 가 만든다. */
const EXIT_LINE = /\[exit=(-?\d+)( TIMEOUT)?[^\]]*\]/g;
/** 오류 결과 머리 — runtime.resultToString·runTool 이 붙인다. 데이터 래퍼(tool-result-wrap) 안쪽일 수도 있다. */
const ERROR_HEAD = /^(?:<tool_output>\n)?Error:\s*/;

function oneLine(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

/** task-steps.isSearchTool 과 같은 판정 — 그 모듈은 DB 를 끌어오므로 여기서는 설정만 읽는다. */
function isSearchTool(name: string): boolean {
    const n = name.toLowerCase();
    return AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS.some((k) => n.includes(k));
}

/** 오류 결과의 첫 줄(머리 제외). */
function errorLine(result: string): string {
    return oneLine(result.replace(ERROR_HEAD, '').split('\n')[0] ?? '', TOOL_DIGEST.ERROR_MAX_CHARS);
}

/** PURE: 오류 결과면 그 첫 줄, 아니면 null. */
export function toolErrorLine(result: string): string | null {
    return ERROR_HEAD.test(result) ? errorLine(result) : null;
}

function genericOutcome(toolName: string, subject: string, result: string): string {
    return ERROR_HEAD.test(result)
        ? getToolDigestLine(toolName, subject, TOOL_DIGEST_OUTCOME.error, errorLine(result))
        : getToolDigestLine(toolName, subject, TOOL_DIGEST_OUTCOME.ok);
}

function digestShell(toolName: string, args: Args, result: string): string | null {
    const subject = toolName === 'bash' ? str(args.command) : (str(args.filename) || str(args.code));
    if (!subject) return null;
    const what = `\`${oneLine(subject, TOOL_DIGEST.SUBJECT_MAX_CHARS)}\``;
    const exits = [...result.matchAll(EXIT_LINE)];
    const last = exits[exits.length - 1];
    if (!last) return genericOutcome(toolName, what, result);
    const code = `exit=${last[1]}`;
    if (last[2]) return getToolDigestLine(toolName, what, TOOL_DIGEST_OUTCOME.timeout, code);
    if (last[1] === '0') return getToolDigestLine(toolName, what, TOOL_DIGEST_OUTCOME.ok, code);
    // 실패 — 종료 줄 바로 앞의 마지막 출력 줄(대개 stderr 끝)이 원인을 담는다.
    const before = result.slice(0, last.index).split('\n').map((l) => l.trim())
        .filter((l) => l.length > 0 && l !== '[stderr]' && l !== '[stdout]');
    const tail = before.length > 0 ? oneLine(before[before.length - 1], TOOL_DIGEST.ERROR_MAX_CHARS) : '';
    return getToolDigestLine(toolName, what, TOOL_DIGEST_OUTCOME.error, tail ? `${code}, ${tail}` : code);
}

function digestFile(toolName: string, args: Args, result: string): string | null {
    const op = str(args.command) || str(args.op);
    if (!op) return null;
    const from = typeof args.start_line === 'number' ? `:${args.start_line}` : '';
    const subject = oneLine(`${op} ${str(args.path)}${from}`, TOOL_DIGEST.SUBJECT_MAX_CHARS);
    return genericOutcome(toolName, subject, result);
}

function digestSearch(toolName: string, args: Args, result: string): string | null {
    const key = TOOL_DIGEST.QUERY_ARG_KEYS.find((k) => args[k] !== undefined && args[k] !== '');
    if (!key) return null;
    const raw = args[key];
    const scope = [str(args.path), str(args.glob)].filter((s) => s.length > 0).join(' ');
    const subject = oneLine(`"${typeof raw === 'string' ? raw : JSON.stringify(raw)}"${scope ? ` ${scope}` : ''}`, TOOL_DIGEST.SUBJECT_MAX_CHARS);
    if (result.startsWith('(일치 없음')) return getToolDigestLine(toolName, subject, TOOL_DIGEST_OUTCOME.noMatch);
    return genericOutcome(toolName, subject, result);
}

function digestBrowser(toolName: string, args: Args, result: string): string | null {
    const actions = Array.isArray(args.actions) ? args.actions : (args.actions && typeof args.actions === 'object' ? [args.actions] : []);
    if (actions.length === 0) return null;
    const parts = actions.slice(0, TOOL_DIGEST.BROWSER_MAX_ACTIONS).map((a) => {
        const act = (a ?? {}) as Args;
        const type = str(act.type);
        return type === 'goto' ? `goto ${str(act.url)}` : type;
    }).filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    const more = actions.length > TOOL_DIGEST.BROWSER_MAX_ACTIONS ? ` … (+${actions.length - TOOL_DIGEST.BROWSER_MAX_ACTIONS})` : '';
    return genericOutcome(toolName, oneLine(parts.join(' · '), TOOL_DIGEST.SUBJECT_MAX_CHARS) + more, result);
}

/**
 * PURE: 도구 호출 하나를 한 줄로 만든다. 다루지 않는 도구이거나 인자를 알 수 없으면 null
 * (호출부가 종전 스텁 문구를 쓴다).
 */
export function digestToolCall(toolName: string | undefined, args: Args | undefined, result: string): string | null {
    if (!TOOL_DIGEST.ENABLED || !toolName || !args) return null;
    if (TOOL_DIGEST.SHELL_TOOLS.includes(toolName)) return digestShell(toolName, args, result);
    if (TOOL_DIGEST.FILE_TOOLS.includes(toolName)) return digestFile(toolName, args, result);
    if (toolName === 'browser') return digestBrowser(toolName, args, result);
    if (toolName === 'grep_code' || isSearchTool(toolName)) return digestSearch(toolName, args, result);
    return null;
}

/** PURE: conversation[toolIndex](tool 메시지)의 호출 인자를 앞선 assistant 의 tool_calls 에서 찾는다. */
export function findToolCallArgs(conversation: ChatMessage[], toolIndex: number): Args | undefined {
    const id = conversation[toolIndex]?.tool_call_id;
    if (!id) return undefined;
    for (let i = toolIndex - 1; i >= 0; i--) {
        const m = conversation[i];
        if (m.role !== 'assistant') continue;
        const call = m.tool_calls?.find((tc) => tc.id === id);
        if (call) return (call.function.arguments ?? {}) as Args;
    }
    return undefined;
}
