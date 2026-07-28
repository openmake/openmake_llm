import { applyReadLimit } from '../filesystem';

describe('applyReadLimit (완전성 고지)', () => {
    it('캡 이하 → 원문 그대로, truncated=false', () => {
        const r = applyReadLimit('hello world', 1000);
        expect(r.truncated).toBe(false);
        expect(r.text).toBe('hello world');
        expect(r.totalBytes).toBe(11);
    });

    it('캡 초과 → 앞부분 + 고지 문구', () => {
        const content = 'a'.repeat(500);
        const r = applyReadLimit(content, 100);
        expect(r.truncated).toBe(true);
        expect(r.shownBytes).toBeLessThanOrEqual(100);
        expect(r.totalBytes).toBe(500);
        expect(r.text).toContain('완전성 고지');
        expect(r.text).toContain('500 bytes');
        expect(r.text.startsWith('a'.repeat(100))).toBe(true);
    });

    it('정확히 캡 크기 → 잘리지 않음', () => {
        const content = 'x'.repeat(100);
        expect(applyReadLimit(content, 100).truncated).toBe(false);
    });

    it('멀티바이트(한글) 경계 안전 — 깨진 치환문자 미포함', () => {
        const content = '가'.repeat(100); // 각 3 bytes = 300 bytes
        const r = applyReadLimit(content, 100); // 100/3 = 33자 경계 부근
        expect(r.truncated).toBe(true);
        expect(r.text).not.toMatch(/�/); // U+FFFD 치환문자 없어야
    });

    it('빈 콘텐츠 → 그대로', () => {
        const r = applyReadLimit('', 100);
        expect(r.truncated).toBe(false);
        expect(r.totalBytes).toBe(0);
    });
});
