/**
 * 메모리 주입 순서 — 관련도(목표와의 키워드 겹침) × 신뢰도 × 시간 감쇠.
 */
import { rankMemoriesForGoal, memoryRelevance } from './memory-rank';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-04T00:00:00Z');
const at = (daysAgo: number): string => new Date(now.getTime() - daysAgo * DAY).toISOString();
const cfg = { relevanceFloor: 0.1, halfLifeDays: 180 };
const mem = (id: string, content: string, o: { confidence?: number | null; daysAgo?: number; source?: 'explicit' | 'candidate' | 'batch' } = {}) =>
    ({ id, content, source: o.source ?? 'explicit', confidence: o.confidence === undefined ? 1 : o.confidence, created_at: at(o.daysAgo ?? 0) });

describe('memoryRelevance', () => {
    it('목표와 겹치는 낱말이 없으면 0, 조사가 붙어도 겹침으로 본다', () => {
        expect(memoryRelevance('매출 보고서를 엑셀로 정리', '사용자는 고양이를 키운다')).toBe(0);
        expect(memoryRelevance('매출 보고서를 엑셀로 정리', '보고서 형식은 엑셀 선호')).toBeGreaterThan(0.4);
    });
});

describe('rankMemoriesForGoal', () => {
    it('목표와 관련된 메모리가 더 최신인 무관 메모리보다 앞선다', () => {
        const out = rankMemoriesForGoal('매출 보고서를 엑셀로 정리', [mem('new', '사용자는 고양이를 키운다'), mem('rel', '보고서 형식은 엑셀 선호', { daysAgo: 30 })], now, cfg);
        expect(out.map((m) => m.id)).toEqual(['rel', 'new']);
    });
    it('관련도가 같으면 신뢰도가 높은 쪽이 앞선다(신뢰도가 비면 출처 기본값)', () => {
        const out = rankMemoriesForGoal('여행 계획', [mem('low', '사용자는 고양이를 키운다', { confidence: 0.3 }), mem('high', '사용자는 강아지를 키운다', { confidence: 1 })], now, cfg);
        expect(out.map((m) => m.id)).toEqual(['high', 'low']);
        const bySource = rankMemoriesForGoal('여행 계획', [mem('cand', '가나다', { confidence: null, source: 'candidate' }), mem('expl', '라마바', { confidence: null, source: 'explicit' })], now, cfg);
        expect(bySource.map((m) => m.id)).toEqual(['expl', 'cand']);
    });
    it('나머지가 같으면 오래된 메모리가 뒤로 간다', () => {
        const out = rankMemoriesForGoal('여행 계획', [mem('old', '사용자는 고양이를 키운다', { daysAgo: 400 }), mem('fresh', '사용자는 강아지를 키운다', { daysAgo: 1 })], now, cfg);
        expect(out.map((m) => m.id)).toEqual(['fresh', 'old']);
    });
    it('입력 배열을 바꾸지 않는다', () => {
        const input = [mem('a', '고양이'), mem('b', '여행 계획 선호', { daysAgo: 3 })];
        rankMemoriesForGoal('여행 계획', input, now, cfg);
        expect(input.map((m) => m.id)).toEqual(['a', 'b']);
    });
});
