import { monthRange, currentMonth, statementToCsv } from '../statement-service';
import { csvCell } from '../../../utils/csv';

describe('statement-service (PURE)', () => {
    test('monthRange: UTC 월 경계, 형식 오류 null', () => {
        const r = monthRange('2026-09')!;
        expect(r.periodStart).toBe('2026-09-01'); expect(r.periodEnd).toBe('2026-10-01');
        expect(monthRange('2026-13')).toBeNull(); expect(monthRange('nope')).toBeNull();
    });
    test('currentMonth', () => { expect(currentMonth(Date.UTC(2026, 8, 17))).toBe('2026-09'); });
    test('statementToCsv: 헤더·라인·합계, 수식 접두 방어', () => {
        const csv = statementToCsv({ subjectType: 'user', subjectId: 'u', periodStart: '2026-09-01', periodEnd: '2026-10-01', totalUsdMicros: 1_500_000, materialized: false,
            lines: [{ kind: 'llm.local', rateKey: '=evil', unit: 'token_in', quantity: 10, usdMicros: 1_500_000 }] }, csvCell);
        expect(csv.split('\n')[0]).toBe('kind,rate_key,unit,quantity,usd');
        expect(csv).toContain("'=evil");
        expect(csv).toContain('TOTAL');
        expect(csv).toContain('1.500000');
    });
});
