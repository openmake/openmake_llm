import { viewWindow } from './file-view';

const lines = (n: number, w = 20) => Array.from({ length: n }, (_, i) => `line ${String(i + 1).padStart(4, '0')} ${'x'.repeat(w)}`).join('\n');

describe('viewWindow — 큰 파일을 줄 구간으로 본다', () => {
    it('예산 안에 드는 파일은 범위를 주지 않으면 원문 그대로다', () => {
        expect(viewWindow('a\nb\nc', 'a.txt', {}, 1000)).toBe('a\nb\nc');
    });

    it('예산을 넘는 파일은 앞에서부터 들어가는 줄까지만 보이고, 이어 볼 줄 번호를 알려 준다', () => {
        const out = viewWindow(lines(500), 'big.ts', {}, 1000);
        const [header, ...body] = out.split('\n');
        expect(header).toMatch(/big\.ts: 전체 500줄 · 1-(\d+)줄 표시/);
        const end = Number(/1-(\d+)줄/.exec(header)![1]);
        expect(header).toContain(`start_line=${end + 1}`);
        expect(body[0]).toBe('line 0001 xxxxxxxxxxxxxxxxxxxx');
        expect(body).toHaveLength(end);
        expect(out.length).toBeLessThanOrEqual(1000);
    });

    it('start_line·line_count 로 가운데 구간을 본다(줄 내용은 원문 그대로 — 편집 때 그대로 복사할 수 있게)', () => {
        const out = viewWindow(lines(500), 'big.ts', { startLine: 201, lineCount: 3 }, 1000);
        expect(out.split('\n')).toEqual([
            expect.stringMatching(/전체 500줄 · 201-203줄 표시/),
            'line 0201 xxxxxxxxxxxxxxxxxxxx', 'line 0202 xxxxxxxxxxxxxxxxxxxx', 'line 0203 xxxxxxxxxxxxxxxxxxxx',
        ]);
    });

    it('마지막 구간에는 이어 볼 안내가 없다', () => {
        const out = viewWindow(lines(500), 'big.ts', { startLine: 498 }, 1000);
        expect(out.split('\n')[0]).toMatch(/498-500줄 표시\]$/);
    });

    it('범위를 벗어난 start_line 은 오류 대신 전체 줄 수를 알려 준다', () => {
        expect(viewWindow(lines(10), 'a.ts', { startLine: 50 }, 1000)).toContain('전체 10줄');
    });

    it('한 줄이 예산보다 길면 그 줄을 잘라 보이고 잘렸음을 알린다', () => {
        const out = viewWindow('x'.repeat(5000), 'min.js', {}, 1000);
        expect(out.length).toBeLessThanOrEqual(1000);
        expect(out).toContain('한 줄이 길어');
    });
});
