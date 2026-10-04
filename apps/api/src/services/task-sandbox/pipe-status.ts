/**
 * 파이프에 가려진 실패 — 파이프라인의 앞 명령이 실패했는데 마지막 명령이 0 으로 끝나 전체가 성공으로 보이는 경우
 * (`npm test | tail -5`)를 추정이 아니라 사실로 알린다.
 *
 * 샌드박스의 셸은 dash(`sh -c`)라 PIPESTATUS 가 없다. 그래서 마지막 파이프라인의 앞 단계를 하나씩
 * `{ 단계 ; printf 표식:번호:$? >&2; }` 로 감싸 각 단계가 자기 종료 코드를 stderr 에 적게 하고, 실행 뒤 그 줄을 읽어 지운다.
 * 마지막 단계는 건드리지 않으므로 전체 종료 코드는 그대로다. 셸을 bash 로 바꾸지 않는다(echo 의 역슬래시 처리 등이 달라진다).
 *
 * 따옴표 밖의 연산자만 보고 가른다. 여러 줄·here-doc·백그라운드·명령 치환·서브셸·복합 명령(if/for/while)·주석처럼
 * 글자만 보고 안전하게 가를 수 없는 형태는 감싸지 않고 종전대로 실행한다.
 *
 * @module services/task-sandbox/pipe-status
 */
import type { ExecResult } from './executor';
import { PIPE_STATUS_HINT } from '../../config/agent-task-tools';
import { getMaskedPipeFailureNote } from '../../prompts/agent-task-tools';
import { interpretExitCode } from './exit-code';

export interface WrappedPipeline {
    /** 감싼 명령 — 이걸 실행한다. */
    command: string;
    tag: string;
    /** 감싼 단계(마지막 명령 제외)의 원문, 순서대로. */
    stages: string[];
}

/** 표식 앞머리 — 뒤에 실행마다 다른 값을 붙인다. */
export const PIPE_STATUS_TAG_PREFIX = '__omk_ps_';

/** 토막의 첫 낱말이 이것이면 복합 명령이거나 파이프라인 전체에 걸리는 낱말이라 단계를 따로 감쌀 수 없다. */
const UNSPLITTABLE_FIRST_WORDS = new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function',
    'time', 'coproc', 'exec', '!', '{', '}', '[[',
]);

/** PURE: 따옴표 밖의 목록 연산자(&& || ;)와 파이프 위치. 안전하게 가를 수 없으면 null. */
function scanOperators(command: string): { lists: Array<{ at: number; len: number }>; pipes: number[] } | null {
    const lists: Array<{ at: number; len: number }> = [];
    const pipes: number[] = [];
    let quote: '' | "'" | '"' = '';
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        const next = command[i + 1];
        const prev = i > 0 ? command[i - 1] : '';
        if (quote === "'") { if (c === "'") quote = ''; continue; }
        if (quote === '"') {
            if (c === '\\') i++;
            else if (c === '"') quote = '';
            continue;
        }
        if (c === '\\') { if (next === undefined || next === '\n') return null; i++; continue; }
        if (c === "'" || c === '"') { if (c === "'" && prev === '$') return null; quote = c; continue; }
        if (c === '\n' || c === '`' || c === '(' || c === ')') return null;
        if (c === '#' && (prev === '' || /\s|[;|&]/.test(prev))) return null;
        if (c === '<' && next === '<') return null;
        if (c === ';') { if (next === ';') return null; lists.push({ at: i, len: 1 }); continue; }
        if (c === '&') {
            if (next === '&') { lists.push({ at: i, len: 2 }); i++; continue; }
            if (prev === '>' || prev === '<') continue;   // 2>&1, <&3
            return null;                                   // 백그라운드
        }
        if (c === '|') {
            if (next === '|') { lists.push({ at: i, len: 2 }); i++; continue; }
            if (prev === '>' || next === '&') return null; // >| 와 |&
            pipes.push(i);
        }
    }
    return quote === '' ? { lists, pipes } : null;
}

const firstWord = (s: string): string => /^\s*(\S*)/.exec(s)?.[1] ?? '';

/**
 * PURE: 마지막 파이프라인의 앞 단계들이 종료 코드를 적게 감싼 명령. 감쌀 것이 없거나 안전하지 않으면 null(종전대로 실행).
 * tag 는 실행마다 다른 표식이다(출력에 우연히 같은 줄이 있어도 섞이지 않게).
 */
export function wrapPipeline(command: string, tag: string, enabled: boolean = PIPE_STATUS_HINT.ENABLED): WrappedPipeline | null {
    if (!enabled) return null;
    const ops = scanOperators(command);
    if (!ops || ops.pipes.length === 0) return null;

    // 목록 연산자로 가른 토막들 — 끝이 `;` 뿐이면 그 앞 토막이 마지막 명령이다.
    const bounds: Array<{ start: number; end: number }> = [];
    let start = 0;
    for (const op of ops.lists) { bounds.push({ start, end: op.at }); start = op.at + op.len; }
    bounds.push({ start, end: command.length });
    if (bounds.length > 1 && command.slice(bounds[bounds.length - 1].start).trim() === '') {
        if (command[ops.lists[ops.lists.length - 1].at] !== ';') return null;
        bounds.pop();
    }
    if (bounds.some((b) => UNSPLITTABLE_FIRST_WORDS.has(firstWord(command.slice(b.start, b.end))))) return null;

    const last = bounds[bounds.length - 1];
    const pipes = ops.pipes.filter((p) => p >= last.start && p < last.end);
    if (pipes.length === 0) return null;
    const cuts = [last.start, ...pipes.map((p) => p + 1)];
    const ends = [...pipes, last.end];
    const texts = cuts.map((from, i) => command.slice(from, ends[i]));
    if (texts.some((t) => t.trim() === '' || UNSPLITTABLE_FIRST_WORDS.has(firstWord(t)))) return null;

    const stages = texts.slice(0, -1);
    const body = stages.map((t, i) => `{ ${t}; printf '%s\\n' "${tag}:${i + 1}:$?" >&2; }`).join('|');
    return {
        command: `${command.slice(0, last.start)}${body}|${texts[texts.length - 1]}${command.slice(last.end)}`,
        tag,
        stages: stages.map((t) => t.trim()),
    };
}

/** PURE: 실행 결과의 stderr 에서 표식 줄을 지우고 단계별 종료 코드를 싣는다. */
export function readPipeStatus(result: ExecResult, wrapped: WrappedPipeline): ExecResult {
    const pipeStages: NonNullable<ExecResult['pipeStages']> = [];
    const stderr = result.stderr.replace(new RegExp(`${wrapped.tag}:(\\d+):(\\d+)\\n?`, 'g'), (_m, n: string, code: string) => {
        const index = Number(n);
        if (wrapped.stages[index - 1] !== undefined) pipeStages.push({ index, command: wrapped.stages[index - 1], exitCode: Number(code) });
        return '';
    });
    return { ...result, stderr, pipeStages: pipeStages.sort((a, b) => a.index - b.index) };
}

/**
 * PURE: 덧붙일 경고 한 줄. 전체 종료 코드가 0 이고 앞 단계 중 실패가 있을 때만 준다.
 * 실패가 아닌 코드는 뺀다 — 종료 코드 해석 표에 있는 것(grep 1 = 일치 없음)과 뒤 명령이 먼저 닫아 생긴 SIGPIPE.
 */
export function maskedPipeFailureNote(result: ExecResult): string | null {
    if (result.exitCode !== 0 || result.timedOut || !result.pipeStages) return null;
    const failed = result.pipeStages.filter((s) => s.exitCode !== 0
        && !PIPE_STATUS_HINT.IGNORED_EXIT_CODES.includes(s.exitCode)
        && interpretExitCode(s.command, s.exitCode, true) === null);
    if (failed.length === 0) return null;
    const clip = (s: string): string => (s.length > PIPE_STATUS_HINT.COMMAND_MAX_CHARS ? `${s.slice(0, PIPE_STATUS_HINT.COMMAND_MAX_CHARS)}…` : s);
    return getMaskedPipeFailureNote(failed.map((s) => ({ index: s.index, command: clip(s.command.replace(/\s+/g, ' ')), exitCode: s.exitCode })));
}
