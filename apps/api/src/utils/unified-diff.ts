/**
 * 두 텍스트 → 통합(unified) diff 문자열 (순수 함수, 외부 의존 없음).
 *
 * 용도: 스킬 재작성 제안을 승인 전에 보여주기 위한 diff. 프론트의 기존 뷰어
 * (`apps/web/components/chat/diff-view.tsx` — `diff --git` 헤더 + `@@` 헝크 전제)가
 * 그대로 렌더할 수 있는 포맷으로 만든다.
 *
 * 알고리즘: 라인 단위 LCS(DP). 스킬 본문은 수백~수천 줄이라 O(n·m) 로 충분하며,
 * 셀 수 상한을 넘으면 전체 교체 diff 로 축약한다(무한 대기 방지).
 *
 * @module utils/unified-diff
 */

/** DP 셀 수 상한 — 초과 시 전체 교체로 표시 */
const MAX_CELLS = 4_000_000;
/** 헝크 앞뒤로 유지할 문맥 줄 수 */
const CONTEXT = 3;

type Op = 'same' | 'add' | 'remove';
interface OpLine { op: Op; text: string }

/** 라인 단위 LCS diff (표시용 중간 표현). */
export function diffLines(before: string, after: string): OpLine[] {
    const a = before.split('\n');
    const b = after.split('\n');

    if (a.length * b.length > MAX_CELLS) {
        return [
            ...a.map((text): OpLine => ({ op: 'remove', text })),
            ...b.map((text): OpLine => ({ op: 'add', text })),
        ];
    }

    // lcs[i][j] = a[i..] 와 b[j..] 의 최장 공통 부분수열 길이
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const out: OpLine[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            out.push({ op: 'same', text: a[i] });
            i++; j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            out.push({ op: 'remove', text: a[i] });
            i++;
        } else {
            out.push({ op: 'add', text: b[j] });
            j++;
        }
    }
    while (i < a.length) out.push({ op: 'remove', text: a[i++] });
    while (j < b.length) out.push({ op: 'add', text: b[j++] });
    return out;
}

/** 변경 줄 수 요약 */
export function diffStats(before: string, after: string): { additions: number; deletions: number } {
    const lines = diffLines(before, after);
    return {
        additions: lines.filter(l => l.op === 'add').length,
        deletions: lines.filter(l => l.op === 'remove').length,
    };
}

const PREFIX: Record<Op, string> = { same: ' ', add: '+', remove: '-' };

/**
 * 통합 diff 문자열 생성.
 *
 * @param path diff 헤더에 쓸 논리 경로 (스킬 이름 등)
 */
export function buildUnifiedDiff(before: string, after: string, path: string): string {
    const lines = diffLines(before, after);
    if (!lines.some(l => l.op !== 'same')) return '';

    // 변경 줄 주변 CONTEXT 만 남겨 헝크로 묶는다
    const keep = new Array<boolean>(lines.length).fill(false);
    lines.forEach((l, idx) => {
        if (l.op === 'same') return;
        for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(lines.length - 1, idx + CONTEXT); k++) keep[k] = true;
    });

    const safePath = path.replace(/[\r\n]/g, ' ').trim() || 'skill';
    const out: string[] = [
        `diff --git a/${safePath} b/${safePath}`,
        `--- a/${safePath}`,
        `+++ b/${safePath}`,
    ];

    let idx = 0;
    // 원본/제안 각각의 현재 줄 번호 (1-based, unified diff 규약)
    let oldLine = 1;
    let newLine = 1;
    while (idx < lines.length) {
        if (!keep[idx]) {
            if (lines[idx].op !== 'add') oldLine++;
            if (lines[idx].op !== 'remove') newLine++;
            idx++;
            continue;
        }
        // 헝크 시작 — 연속된 keep 구간을 모은다
        const hunkStartOld = oldLine;
        const hunkStartNew = newLine;
        const body: string[] = [];
        let oldCount = 0;
        let newCount = 0;
        while (idx < lines.length && keep[idx]) {
            const l = lines[idx];
            body.push(`${PREFIX[l.op]}${l.text}`);
            if (l.op !== 'add') { oldLine++; oldCount++; }
            if (l.op !== 'remove') { newLine++; newCount++; }
            idx++;
        }
        out.push(`@@ -${hunkStartOld},${oldCount} +${hunkStartNew},${newCount} @@`);
        out.push(...body);
    }
    return out.join('\n');
}
