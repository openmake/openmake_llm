/**
 * @module services/orchestrator/result-markers
 * @description 최종 본문에서 오케스트레이터 작업 결과 블록의 내부 표식을 결정적으로 정리한다.
 *
 * 모델이 블록 머리글 이름·작업 번호를 인용 표식처럼 옮겨 쓰는 일이 있다(`[오케스트레이터 작업 결과 t1, 결과 6, 8]`).
 * 대괄호(전각 포함) 한 줄 구간만 본다 — 코드펜스·인라인 코드 안은 건드리지 않는다. 기본은 삭제(앞 공백 1개 포함)이고,
 * 인용 꼴(라벨 뒤 숫자, 쉼표로 이어진 숫자)이면서 이 턴 번호표에 있는 번호만 남겨 `[<출처 라벨> n, m]` 로 고쳐 쓴다.
 * 블록 이름 없이 작업 번호만 옮긴 꼴(`[t1 · web.search]`·`[t1 결과 6]`)도 같은 규칙 — 호출부는 블록이 주입된 턴에만 부른다.
 */
import { CAPABILITIES } from '../../config/capabilities';
import { RESULT_BLOCK_LABELS, RESULT_BLOCK_LEGACY_LABELS } from '../../config/orchestrator-result-block';
import { WEB_SEARCH_TEMPLATES } from '../../sockets/ws-chat-locales';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BLOCK_NAME_RE = new RegExp([...Object.values(RESULT_BLOCK_LABELS), ...RESULT_BLOCK_LEGACY_LABELS].map(esc).join('|'), 'giu');
const TASK_ID_RE = /\bt\d+\b/i;
const TASK_HINT_RE = new RegExp(`${CAPABILITIES.map(esc).join('|')}|결과|results?`, 'i');
/** 인용 꼴 — 라벨 뒤 숫자와 그 뒤로 쉼표로 이어진 숫자(`결과 6, 8`·`출처 16, 18`·`Source 3`). 숫자 뒤에 글자가 붙으면(`2건`) 아니다. */
const CITE_LABELS = [...new Set(['결과', '출처', 'results?', 'sources?', ...Object.values(WEB_SEARCH_TEMPLATES).map((t) => esc(t.sourceLabel))])].join('|');
const CITE_RE = new RegExp(`(?:${CITE_LABELS})\\s*#?\\s*(\\d+(?![\\d\\p{L}])(?:\\s*[,，、·]\\s*\\d+(?![\\d\\p{L}]))*)`, 'giu');
const BRACKET_RE = / ?(?:\[[^[\]\n]*\]|【[^【】\n]*】)/g;
const FENCE_RE = /^\s*(```|~~~)/;

function isMarker(inner: string): boolean {
    BLOCK_NAME_RE.lastIndex = 0;
    if (BLOCK_NAME_RE.test(inner)) return true;
    return TASK_ID_RE.test(inner) && TASK_HINT_RE.test(inner);
}

/** 코드펜스 밖·인라인 코드 밖 구간에만 fn 을 적용한다 */
function mapOutsideCode(content: string, fn: (text: string) => string): string {
    let inFence = false;
    return content.split('\n').map((line) => {
        if (FENCE_RE.test(line)) { inFence = !inFence; return line; }
        if (inFence) return line;
        return line.split(/(`[^`\n]*`)/).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
    }).join('\n');
}

export function scrubResultBlockMarkers(
    content: string,
    opts: { sourceLabel: string; validNums: ReadonlySet<string> },
): { content: string; removed: number } {
    let removed = 0;
    const out = mapOutsideCode(content, (text) => text.replace(BRACKET_RE, (match) => {
        const inner = match.trim().slice(1, -1);
        if (!isMarker(inner)) return match;
        removed++;
        const rest = inner.replace(BLOCK_NAME_RE, ' ');
        const nums: string[] = [];
        for (const m of rest.matchAll(CITE_RE)) {
            for (const n of m[1].match(/\d+/g) ?? []) if (opts.validNums.has(n) && !nums.includes(n)) nums.push(n);
        }
        if (nums.length === 0) return '';
        return `${match.startsWith(' ') ? ' ' : ''}[${opts.sourceLabel} ${nums.join(', ')}]`;
    }));
    return { content: out, removed };
}

/** 스트리밍 본문엔 표식이 있었고 최종본엔 없는지 — done.cleanedContent 교체 판정용(같은 탐지 규칙). */
export function resultBlockMarkersWereCleaned(streamed: string, final: string): boolean {
    const count = (s: string) => scrubResultBlockMarkers(s, { sourceLabel: '', validNums: new Set() }).removed;
    return count(streamed) > 0 && count(final) === 0;
}
