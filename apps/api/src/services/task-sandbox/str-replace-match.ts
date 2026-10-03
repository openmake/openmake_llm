/**
 * str_replace 단계적 매칭 — 정확 일치가 0건일 때만 쓴다.
 *
 * 모델이 보낸 old_str 가 파일과 공백·따옴표만 다른 경우가 흔하다(줄 끝 공백, 한 단계 얕은 들여쓰기,
 * " 와 '). 종전에는 고정 문구로 거절해 view → 재시도에 턴을 썼다. 여기서는 차이를 좁은 것부터 넓은 순서로
 * 무시해 보고, **한 곳에만 맞을 때** 적용한다. 여러 곳에 맞으면 적용하지 않고 줄 번호를 알린다.
 * 어디에도 맞지 않으면 가장 비슷한 줄을 줄 번호와 함께 보여 준다. 전부 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/task-sandbox/str-replace-match
 */
import { STR_REPLACE_MATCH, QUOTE_EQUIVALENTS } from '../../config/agent-task-tools';
import {
    STR_REPLACE_RELAXED_LABELS,
    getStrReplaceAmbiguousMessage,
    getStrReplaceFuzzyAppliedNote,
    getStrReplaceNotFoundMessage,
} from '../../prompts/agent-task-tools';

type Stage = keyof typeof STR_REPLACE_RELAXED_LABELS;

/** 치환할 구간(글자 위치)과 그 구간이 시작하는 줄(0부터). */
interface Span { start: number; end: number; line: number }

interface MissedReplaceResult {
    /** 적용했으면 새 파일 내용. 없으면 적용하지 않은 것이다. */
    content?: string;
    /** 도구 결과 문구(적용 안내 또는 실패 안내). */
    message: string;
}

const QUOTE_RE = new RegExp(`[${Object.keys(QUOTE_EQUIVALENTS).join('')}]`, 'g');
/** 따옴표를 한 종류로 — 글자 수가 그대로다. */
const unifyQuotes = (s: string): string => s.replace(QUOTE_RE, (c) => QUOTE_EQUIVALENTS[c]);
const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** 줄 단위 비교 — old_str 의 각 줄과 파일의 연속한 줄이 norm 뒤에 같으면 그 구간을 돌려준다. */
function lineWindowSpans(content: string, oldStr: string, norm: (line: string) => string): Span[] {
    const endsWithNewline = oldStr.endsWith('\n');
    const want = (endsWithNewline ? oldStr.slice(0, -1) : oldStr).split('\n').map(norm);
    const lines = content.split('\n');
    const starts: number[] = [];
    let pos = 0;
    for (const l of lines) { starts.push(pos); pos += l.length + 1; }
    const have = lines.map(norm);
    const spans: Span[] = [];
    for (let i = 0; i + want.length <= lines.length; i++) {
        let hit = true;
        for (let j = 0; j < want.length && hit; j++) hit = have[i + j] === want[j];
        if (!hit) continue;
        const last = i + want.length - 1;
        const lineEnd = starts[last] + lines[last].length;
        // old_str 가 줄바꿈으로 끝났으면 그 줄바꿈까지 구간에 넣는다(파일 끝이면 없다).
        spans.push({ start: starts[i], end: endsWithNewline && last < lines.length - 1 ? lineEnd + 1 : lineEnd, line: i });
    }
    return spans;
}

/** 글자 단위 비교 — 따옴표만 통일해 부분 문자열을 찾는다(줄 중간도 맞는다). */
function quoteSpans(content: string, oldStr: string): Span[] {
    const hay = unifyQuotes(content);
    const needle = unifyQuotes(oldStr);
    const spans: Span[] = [];
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
        spans.push({ start: at, end: at + needle.length, line: content.slice(0, at).split('\n').length - 1 });
    }
    return spans;
}

/**
 * 들여쓰기를 무시하고 맞췄으면 new_str 도 파일의 들여쓰기로 옮긴다 — 그대로 넣으면 파이썬은 구문이 깨진다.
 * 첫 비어 있지 않은 줄의 들여쓰기 차이만큼 각 줄에 더하거나 덜어 낸다. 한쪽이 다른 쪽의 접두가 아니면(탭·공백 혼용) 그대로 둔다.
 */
function reindent(newStr: string, oldStr: string, fileRegion: string): string {
    const firstFilled = (s: string): string | undefined => s.split('\n').find((l) => l.trim().length > 0);
    const oldLine = firstFilled(oldStr);
    const fileLine = firstFilled(fileRegion);
    if (oldLine === undefined || fileLine === undefined) return newStr;
    const from = indentOf(oldLine);
    const to = indentOf(fileLine);
    if (from === to) return newStr;
    if (to.endsWith(from)) {
        const add = to.slice(0, to.length - from.length);
        return newStr.split('\n').map((l) => (l.trim() ? add + l : l)).join('\n');
    }
    if (from.endsWith(to)) {
        const drop = from.slice(0, from.length - to.length);
        return newStr.split('\n').map((l) => (l.startsWith(drop) ? l.slice(drop.length) : l)).join('\n');
    }
    return newStr;
}

/** 글자 2-gram 겹침(Dice) — 0~1. */
function similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const grams = new Map<string, number>();
    for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) ?? 0) + 1); }
    let overlap = 0;
    for (let i = 0; i < b.length - 1; i++) {
        const g = b.slice(i, i + 2);
        const n = grams.get(g) ?? 0;
        if (n > 0) { overlap++; grams.set(g, n - 1); }
    }
    return (2 * overlap) / (a.length + b.length - 2);
}

/** old_str 의 첫 비어 있지 않은 줄과 가장 비슷한 파일 줄 — "줄번호| 내용". 파일 순서대로 돌려준다. */
function closestLines(content: string, oldStr: string): string[] {
    const anchor = oldStr.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (!anchor) return [];
    return content.split('\n')
        .map((line, i) => ({ line, i, score: similarity(anchor, line.trim()) }))
        .filter((c) => c.score >= STR_REPLACE_MATCH.CLOSEST_MIN_SIMILARITY)
        .sort((x, y) => y.score - x.score || x.i - y.i)
        .slice(0, STR_REPLACE_MATCH.CLOSEST_MAX_LINES)
        .sort((x, y) => x.i - y.i)
        .map((c) => `${c.i + 1}| ${c.line.length > STR_REPLACE_MATCH.CLOSEST_LINE_MAX_CHARS ? `${c.line.slice(0, STR_REPLACE_MATCH.CLOSEST_LINE_MAX_CHARS)}…` : c.line}`);
}

/**
 * PURE: 정확 일치가 0건인 str_replace 를 다시 시도한다.
 * @param fuzzy false 면 느슨한 매칭 없이 비슷한 줄 안내만 만든다.
 */
export function resolveMissedStrReplace(
    content: string, oldStr: string, newStr: string, path: string,
    fuzzy: boolean = STR_REPLACE_MATCH.FUZZY_ENABLED,
): MissedReplaceResult {
    if (fuzzy && oldStr.trim().length > 0) {
        // 좁은 차이부터. 앞 단계가 0건일 때만 다음으로 간다 — 넓은 단계일수록 엉뚱한 곳에 맞을 수 있다.
        const stages: Array<{ stage: Stage; find: () => Span[]; indent: boolean }> = [
            { stage: 'trailing', indent: false, find: () => lineWindowSpans(content, oldStr, (l) => l.replace(/\s+$/, '')) },
            { stage: 'indent', indent: true, find: () => lineWindowSpans(content, oldStr, (l) => l.trim()) },
            { stage: 'quotes', indent: false, find: () => quoteSpans(content, oldStr) },
            { stage: 'indent+quotes', indent: true, find: () => lineWindowSpans(content, oldStr, (l) => unifyQuotes(l.trim())) },
        ];
        for (const { stage, find, indent } of stages) {
            const spans = find();
            if (spans.length === 0) continue;
            const label = STR_REPLACE_RELAXED_LABELS[stage];
            if (spans.length > 1) {
                const lines = spans.slice(0, STR_REPLACE_MATCH.AMBIGUOUS_MAX_LINES).map((s) => s.line + 1);
                return { message: getStrReplaceAmbiguousMessage(path, label, lines, spans.length) };
            }
            const [s] = spans;
            const replacement = indent ? reindent(newStr, oldStr, content.slice(s.start, s.end)) : newStr;
            return {
                content: content.slice(0, s.start) + replacement + content.slice(s.end),
                message: getStrReplaceFuzzyAppliedNote(path, s.line + 1, label),
            };
        }
    }
    return { message: getStrReplaceNotFoundMessage(path, closestLines(content, oldStr)) };
}
