/**
 * 승인 요청 시점 "실행 전 미리보기" (F18 PR-2, 138) — 파일 쓰기 도구의 인자와 현재 파일 내용으로 unified diff 를 만든다.
 * 대상: str_replace_editor(create|str_replace|insert) · file_ops(write|delete). 그 외는 null(카드는 종전 인자 요약).
 * 전부 fail-open: 파일을 못 읽거나 old_str 이 없으면 null — 승인 흐름에 영향 없음. 크기 캡(입력 64KB·diff 32KB).
 * 외부 diff 패키지 없이 LCS 라인 diff (파일이 작고 승인 카드 표시 목적이라 O(n·m) 로 충분).
 *
 * @module services/task-sandbox/approval-preview
 */
import { APPROVAL_PREVIEW } from '../../config/task-sandbox';

function str(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v); }

/** PURE: 두 텍스트의 unified diff(헤더 포함). 동일하면 ''. */
export function unifiedDiff(path: string, before: string, after: string): string {
    if (before === after) return '';
    const a = before.split('\n'); const b = after.split('\n');
    const n = a.length; const m = b.length;
    // LCS 테이블(뒤에서 앞으로)
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops: Array<{ t: ' ' | '-' | '+'; s: string }> = [];
    let i = 0; let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', s: a[i] }); i++; }
        else { ops.push({ t: '+', s: b[j] }); j++; }
    }
    while (i < n) { ops.push({ t: '-', s: a[i++] }); }
    while (j < m) { ops.push({ t: '+', s: b[j++] }); }
    // 헝크: 변경 주변 3줄 컨텍스트
    const ctx = 3; const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
    let k = 0;
    while (k < ops.length) {
        if (ops[k].t === ' ') { k++; continue; }
        const start = Math.max(0, k - ctx); let end = k;
        while (end < ops.length) { if (ops[end].t !== ' ') { end++; continue; } let run = 0; while (end + run < ops.length && ops[end + run].t === ' ') run++; if (run > ctx * 2 && end + run < ops.length) { end += ctx; break; } if (end + run >= ops.length) { end = Math.min(ops.length, end + ctx); break; } end += run; }
        const slice = ops.slice(start, end);
        let oldStart = 1; let newStart = 1;
        for (let q = 0; q < start; q++) { if (ops[q].t !== '+') oldStart++; if (ops[q].t !== '-') newStart++; }
        const oldLen = slice.filter((o) => o.t !== '+').length; const newLen = slice.filter((o) => o.t !== '-').length;
        lines.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
        for (const o of slice) lines.push(o.t + o.s);
        k = end;
    }
    return lines.join('\n');
}

/** PURE-ish: 도구 인자 + 현재 파일 → diff. readFile 이 실패하면 새 파일로 간주(create/write)하거나 null(str_replace/insert). */
export async function buildApprovalPreview(
    toolName: string,
    args: Record<string, unknown>,
    readFile: (path: string) => Promise<string>,
): Promise<string | null> {
    const path = str(args.path);
    if (!path) return null;
    const read = async (): Promise<string | null> => {
        try { const c = await readFile(path); return c.length > APPROVAL_PREVIEW.FILE_MAX_CHARS ? null : c; } catch { return null; }
    };
    let before: string | null = null; let after: string | null = null;
    if (toolName === 'str_replace_editor') {
        const command = str(args.command);
        if (command === 'create') { before = (await read()) ?? ''; after = str(args.file_text); }
        else if (command === 'str_replace') {
            before = await read(); if (before === null) return null;
            const oldStr = str(args.old_str); if (!oldStr || before.split(oldStr).length - 1 !== 1) return null;
            after = before.replace(oldStr, str(args.new_str));
        } else if (command === 'insert') {
            before = await read(); if (before === null) return null;
            const lines = before.split('\n'); const at = Math.max(0, Math.min(lines.length, Number(args.insert_line) || 0));
            lines.splice(at, 0, str(args.new_str)); after = lines.join('\n');
        } else return null;
    } else if (toolName === 'file_ops') {
        const op = str(args.op);
        if (op === 'write') { before = (await read()) ?? ''; after = str(args.content); }
        else if (op === 'delete') { before = await read(); if (before === null) return null; after = ''; }
        else return null;
    } else return null;
    if (before === null || after === null) return null;
    if (before.length > APPROVAL_PREVIEW.FILE_MAX_CHARS || after.length > APPROVAL_PREVIEW.FILE_MAX_CHARS) return null;
    const d = unifiedDiff(path, before, after);
    if (!d) return null;
    return d.length > APPROVAL_PREVIEW.DIFF_MAX_CHARS ? d.slice(0, APPROVAL_PREVIEW.DIFF_MAX_CHARS) + '\n… (truncated)' : d;
}
