/**
 * CSV 셀 인코딩 (RFC 4180 + 수식 인젝션 무력화)
 *
 * 관리자 export CSV 를 Excel 등에서 열 때 셀 선행 문자 `= + - @ \t \r` 는 수식으로 해석돼
 * 외부 호출·명령 실행이 가능하다(2026-09-02 보안 리뷰 L2). 문자열 값이 그 문자로 시작하면
 * 작은따옴표를 앞에 붙여 텍스트로 고정한다(OWASP CSV Injection 권고). 숫자·불리언 등
 * 비문자열은 원래 수식이 될 수 없으므로 접두만 이스케이프한다.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '""';
    let s: string;
    if (typeof value === 'string') {
        s = FORMULA_PREFIX.test(value) ? `'${value}` : value;
    } else if (value instanceof Date) {
        s = value.toISOString();
    } else if (typeof value === 'object') {
        s = JSON.stringify(value);
    } else {
        s = String(value);
    }
    return `"${s.replace(/"/g, '""')}"`;
}
