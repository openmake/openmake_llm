import { goalSimilarity, renderLesson } from './task-learning';

describe('goalSimilarity', () => {
    it('동일 goal → 1', () => {
        expect(goalSimilarity('파이썬 매출 보고서 작성', '파이썬 매출 보고서 작성')).toBe(1);
    });
    it('부분 겹침 → 0<sim<1', () => {
        const s = goalSimilarity('파이썬 매출 보고서 작성', '파이썬 재고 보고서 작성');
        expect(s).toBeGreaterThan(0.3);
        expect(s).toBeLessThan(1);
    });
    it('무관 goal → 낮음', () => {
        expect(goalSimilarity('파이썬 매출 보고서', '고양이 그림 생성')).toBe(0);
    });
    it('빈 입력 → 0', () => {
        expect(goalSimilarity('', '무엇이든')).toBe(0);
    });
});

describe('renderLesson', () => {
    it('성공 케이스 — 결과·턴·도구 포함', () => {
        const line = renderLesson({ goal: '매출 분석', status: 'completed', current_turn: 3, tools: ['bash', 'python_execute'] });
        expect(line).toContain('[성공]');
        expect(line).toContain('3턴');
        expect(line).toContain('bash, python_execute');
    });
    it('실패 케이스 — 사유 포함', () => {
        const line = renderLesson({ goal: 'x', status: 'failed', error: 'timeout', current_turn: 5, tools: [] });
        expect(line).toContain('실패(timeout)');
    });
    it('긴 goal 은 80자 절단', () => {
        const line = renderLesson({ goal: 'g'.repeat(200), status: 'completed', current_turn: 1, tools: [] });
        expect(line).toContain('g'.repeat(80) + '…');
        expect(line).not.toContain('g'.repeat(81));
    });
});
