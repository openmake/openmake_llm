import { parseCron, computeNextRun } from './schedule-cron';

// 로컬 타임존 기준. 테스트는 특정 절대시각 대신 관계(다음 실행이 규칙에 부합)를 검증.
function at(y: number, mo: number, d: number, h: number, mi: number): number {
    return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

describe('parseCron', () => {
    it('유효 표현식', () => {
        expect(parseCron('0 8 * * *')).not.toBeNull();
        expect(parseCron('*/15 * * * *')).not.toBeNull();
        expect(parseCron('0 9-17 * * 1-5')).not.toBeNull();
    });
    it('무효 표현식 → null', () => {
        expect(parseCron('0 8 * *')).toBeNull();       // 4 필드
        expect(parseCron('60 8 * * *')).toBeNull();     // 분 범위 초과
        expect(parseCron('0 24 * * *')).toBeNull();     // 시 범위 초과
        expect(parseCron('abc 8 * * *')).toBeNull();
    });
});

describe('computeNextRun', () => {
    it('interval 은 fromMs + 간격', () => {
        const from = at(2026, 7, 11, 12, 0);
        expect(computeNextRun({ intervalSeconds: 300 }, from)).toBe(from + 300_000);
    });

    it('매일 08:00 — 다음 실행은 08:00 정각', () => {
        const from = at(2026, 7, 11, 12, 0); // 정오 → 다음날 08:00
        const next = computeNextRun({ cron: '0 8 * * *' }, from)!;
        const d = new Date(next);
        expect(d.getHours()).toBe(8);
        expect(d.getMinutes()).toBe(0);
        expect(next).toBeGreaterThan(from);
    });

    it('08:00 이전이면 같은 날 08:00', () => {
        const from = at(2026, 7, 11, 6, 30);
        const next = computeNextRun({ cron: '0 8 * * *' }, from)!;
        const d = new Date(next);
        expect(d.getDate()).toBe(11);
        expect(d.getHours()).toBe(8);
    });

    it('*/15 — 다음 15분 경계', () => {
        const from = at(2026, 7, 11, 12, 7);
        const next = computeNextRun({ cron: '*/15 * * * *' }, from)!;
        expect(new Date(next).getMinutes()).toBe(15);
    });

    it('평일 9시(1-5) — 토요일 시작이면 월요일로', () => {
        // 2026-07-11 은 토요일. 다음 평일 09:00 은 월요일(13일).
        const from = at(2026, 7, 11, 10, 0);
        const next = computeNextRun({ cron: '0 9 * * 1-5' }, from)!;
        const d = new Date(next);
        expect(d.getDay()).toBeGreaterThanOrEqual(1);
        expect(d.getDay()).toBeLessThanOrEqual(5);
        expect(d.getHours()).toBe(9);
    });

    it('무효 표현식/빈 timing → null', () => {
        expect(computeNextRun({ cron: 'nope' }, Date.now())).toBeNull();
        expect(computeNextRun({}, Date.now())).toBeNull();
    });
});
