import { truncateToolResult } from './tool-result-truncate';

describe('truncateToolResult', () => {
    it('상한 이하는 그대로 둔다', () => {
        expect(truncateToolResult('abc', 10, 0.5)).toBe('abc');
        expect(truncateToolResult('a'.repeat(10), 10, 0.5)).toBe('a'.repeat(10));
    });

    it('상한을 넘으면 앞·뒤를 남기고 가운데에 생략 글자 수를 적는다', () => {
        const text = 'H'.repeat(40) + 'M'.repeat(100) + 'T'.repeat(60);
        const out = truncateToolResult(text, 100, 0.4);
        expect(out.startsWith('H'.repeat(40))).toBe(true);
        expect(out.endsWith('T'.repeat(60))).toBe(true);
        expect(out).not.toContain('M');
        expect(out).toContain('가운데 100자 생략');
        expect(out).toContain('전체 200자');
    });

    it('셸 결과의 끝에 있는 종료 코드 줄이 남는다', () => {
        const text = `[stdout]\n${'line\n'.repeat(5000)}[stderr]\nTypeError: boom\n[exit=1 120ms]`;
        const out = truncateToolResult(text, 8000, 0.5);
        expect(out).toContain('TypeError: boom');
        expect(out.endsWith('[exit=1 120ms]')).toBe(true);
        expect(out.startsWith('[stdout]')).toBe(true);
    });

    it('비율 1 은 앞만, 0 은 뒤만 남기되 생략 표시는 붙인다', () => {
        const text = 'A'.repeat(50) + 'B'.repeat(50);
        expect(truncateToolResult(text, 20, 1)).toMatch(/^A{20}\n\.\.\.\[가운데 80자 생략/);
        expect(truncateToolResult(text, 20, 0)).toMatch(/생략 — 전체 100자\]\.\.\.\nB{20}$/);
    });

    it('범위를 벗어난 비율은 0~1 로 맞춘다', () => {
        const text = 'A'.repeat(50) + 'B'.repeat(50);
        expect(truncateToolResult(text, 20, 7)).toBe(truncateToolResult(text, 20, 1));
        expect(truncateToolResult(text, 20, -3)).toBe(truncateToolResult(text, 20, 0));
    });
});
