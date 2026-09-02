/** CSV 수식 인젝션 무력화 (2026-09-02 보안 리뷰 L2) */
import { csvCell } from '../csv';

describe('csvCell', () => {
    it.each(['=cmd|"/c calc"!A1', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])('수식 접두 %j 는 작은따옴표로 텍스트 고정', (v) => {
        const cell = csvCell(v);
        expect(cell.startsWith(`"'`)).toBe(true);
    });
    it('일반 문자열은 접두 없이 따옴표만', () => {
        expect(csvCell('hello')).toBe('"hello"');
    });
    it('내부 따옴표는 이중화', () => {
        expect(csvCell('a"b')).toBe('"a""b"');
    });
    it('null/undefined 는 빈 셀', () => {
        expect(csvCell(null)).toBe('""');
        expect(csvCell(undefined)).toBe('""');
    });
    it('숫자·불리언·객체는 수식 접두를 붙이지 않는다', () => {
        expect(csvCell(-5)).toBe('"-5"');
        expect(csvCell(true)).toBe('"true"');
        expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    });
    it('Date 는 ISO 문자열', () => {
        expect(csvCell(new Date('2026-09-02T00:00:00Z'))).toBe('"2026-09-02T00:00:00.000Z"');
    });
});
