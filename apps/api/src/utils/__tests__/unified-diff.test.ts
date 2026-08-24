import { diffLines, diffStats, buildUnifiedDiff } from '../unified-diff';

describe('unified-diff', () => {
    describe('diffLines', () => {
        it('동일 텍스트는 전부 same', () => {
            expect(diffLines('a\nb', 'a\nb').every(l => l.op === 'same')).toBe(true);
        });

        it('한 줄 교체는 remove + add', () => {
            const r = diffLines('a\nb\nc', 'a\nX\nc');
            expect(r.map(l => l.op)).toEqual(['same', 'remove', 'add', 'same']);
        });

        it('추가만 있는 경우', () => {
            expect(diffLines('a', 'a\nb').filter(l => l.op === 'add').map(l => l.text)).toEqual(['b']);
        });
    });

    describe('diffStats', () => {
        it('추가/삭제 줄 수', () => {
            expect(diffStats('a\nb\nc', 'a\nX\nY\nc')).toEqual({ additions: 2, deletions: 1 });
        });
    });

    describe('buildUnifiedDiff', () => {
        it('변경 없으면 빈 문자열', () => {
            expect(buildUnifiedDiff('same\ntext', 'same\ntext', 'skill')).toBe('');
        });

        it('git 헤더 + 헝크 헤더 + 접두어 라인 (프론트 DiffView 전제 포맷)', () => {
            const diff = buildUnifiedDiff('line1\nold\nline3', 'line1\nnew\nline3', 'my-skill');
            const lines = diff.split('\n');
            expect(lines[0]).toBe('diff --git a/my-skill b/my-skill');
            expect(lines[1]).toBe('--- a/my-skill');
            expect(lines[2]).toBe('+++ b/my-skill');
            expect(lines[3]).toMatch(/^@@ -1,3 \+1,3 @@$/);
            expect(diff).toContain('-old');
            expect(diff).toContain('+new');
            expect(diff).toContain(' line1');
        });

        it('멀리 떨어진 변경은 헝크 2개로 분리 (문맥 3줄)', () => {
            const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n');
            const after = ['A', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'L'].join('\n');
            const diff = buildUnifiedDiff(before, after, 's');
            const hunks = diff.split('\n').filter(l => l.startsWith('@@'));
            expect(hunks).toHaveLength(2);
        });

        it('헝크 라인 수가 실제 내용과 일치', () => {
            const diff = buildUnifiedDiff('x\nold\ny', 'x\nnew\nz', 's');
            const hunk = diff.split('\n').find(l => l.startsWith('@@'))!;
            const m = hunk.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/)!;
            const body = diff.split('\n').slice(4);
            const oldLines = body.filter(l => l.startsWith(' ') || l.startsWith('-')).length;
            const newLines = body.filter(l => l.startsWith(' ') || l.startsWith('+')).length;
            expect(Number(m[2])).toBe(oldLines);
            expect(Number(m[4])).toBe(newLines);
        });

        it('경로의 개행은 제거 (헤더 오염 방지)', () => {
            const diff = buildUnifiedDiff('a', 'b', 'bad\nname');
            expect(diff.split('\n')[0]).toBe('diff --git a/bad name b/bad name');
        });
    });
});
