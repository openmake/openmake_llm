/** 작업 게이트 검토 보고 — 출력 형식과 기준값 후보별 비율 계산을 고정한다 */
import { formatTaskGateReport } from '../report-task-gate';

const histogram = [{ bucket: 0, count: 6 }, { bucket: 5, count: 1 }, { bucket: 7, count: 1 }, { bucket: 9, count: 2 }];

describe('formatTaskGateReport', () => {
    it('건수·실패율·지연·분포·기준값 후보별 제안 비율을 싣는다', () => {
        const out = formatTaskGateReport({
            days: 7,
            summary: { total: 14, rule: 3, jev: 11, failed: 1, p50Ms: 250, p95Ms: 900 },
            histogram,
            top: [{ pTrue: 0.97, createdAt: '2026-10-13T00:00:00Z', question: '보고서 만들어서\n저장해줘' }],
            border: [],
        });
        expect(out).toContain('최근 7일');
        expect(out).toContain('전체 14건 (규칙 3 · 어댑터 11 · 판정 실패 1 = 9.1%)');
        expect(out).toContain('판정 지연 p50 250ms · p95 900ms');
        expect(out).toContain('0.9~1.0  2');
        // 확률을 받은 판정 10건 중 0.5 이상 4건, 0.7 이상 3건, 0.9 이상 2건
        expect(out).toContain('기준 0.5 → 4건 (40.0%)');
        expect(out).toContain('기준 0.7 → 3건 (30.0%)');
        expect(out).toContain('기준 0.9 → 2건 (20.0%)');
        // 본문의 줄바꿈은 한 줄로 편다
        expect(out).toContain('0.970  보고서 만들어서 저장해줘');
    });

    it('기록이 없으면 0건으로 끝내고 나누기 오류가 없다', () => {
        const out = formatTaskGateReport({ days: 3, summary: { total: 0, rule: 0, jev: 0, failed: 0, p50Ms: null, p95Ms: null }, histogram: [], top: [], border: [] });
        expect(out).toContain('전체 0건');
        expect(out).not.toContain('NaN');
        expect(out).toContain('판정 지연 p50 - · p95 -');
    });

    it('본문이 지워진 표본은 (본문 없음)으로 적는다', () => {
        const out = formatTaskGateReport({ days: 7, summary: { total: 1, rule: 0, jev: 1, failed: 0, p50Ms: 1, p95Ms: 1 }, histogram: [{ bucket: 9, count: 1 }], top: [{ pTrue: 0.95, createdAt: 'x', question: null }], border: [] });
        expect(out).toContain('0.950  (본문 없음)');
    });
});
