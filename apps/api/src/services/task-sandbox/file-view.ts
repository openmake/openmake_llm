/**
 * 파일 보기 창 — 예산(글자 수)을 넘는 파일을 줄 구간으로 나눠 본다.
 *
 * 종전의 view 는 파일 전체를 돌려줘, 도구 결과 상한(8,000자)을 넘는 부분은 파일 도구로 볼 수 없었다.
 * 줄 내용은 원문 그대로 둔다(줄 번호를 붙이지 않는다) — str_replace 의 old_str 로 그대로 복사할 수 있어야 한다.
 * 위치는 첫 줄의 머리말로만 알린다.
 *
 * @module services/task-sandbox/file-view
 */
import { getFileViewHeader, getFileViewOutOfRange, FILE_VIEW_LONG_LINE_NOTE } from '../../prompts/agent-task-prompt';

/** PURE: content 가 maxChars 안에 들고 범위 지정이 없으면 원문, 아니면 머리말 + 들어가는 줄까지. */
export function viewWindow(
    content: string, path: string, range: { startLine?: number; lineCount?: number }, maxChars: number,
): string {
    const ranged = range.startLine !== undefined || range.lineCount !== undefined;
    if (!ranged && content.length <= maxChars) return content;
    const all = content.split('\n');
    const total = all.length;
    const start = Math.max(1, Math.floor(range.startLine ?? 1));
    if (start > total) return getFileViewOutOfRange(path, total, start);
    const wanted = range.lineCount !== undefined ? Math.max(1, Math.floor(range.lineCount)) : total;
    // 머리말 길이는 줄 수 자릿수에 따라 달라진다 — 가장 긴 경우로 예산을 잡는다.
    const budget = maxChars - getFileViewHeader(path, total, total, total, total).length - 1;
    const picked: string[] = [];
    let used = 0;
    for (let i = start - 1; i < total && picked.length < wanted; i++) {
        const cost = all[i].length + 1;
        if (used + cost > budget) break;
        picked.push(all[i]);
        used += cost;
    }
    if (picked.length === 0) {
        // 첫 줄 하나가 예산보다 길다(압축된 한 줄 파일 등) — 그 줄의 앞부분만 보인다.
        const room = Math.max(0, budget - FILE_VIEW_LONG_LINE_NOTE.length - 1);
        return `${getFileViewHeader(path, total, start, start, null)}\n${all[start - 1].slice(0, room)}\n${FILE_VIEW_LONG_LINE_NOTE}`;
    }
    const end = start + picked.length - 1;
    return `${getFileViewHeader(path, total, start, end, end < total ? end + 1 : null)}\n${picked.join('\n')}`;
}
