/**
 * skill-usage-log(자동 선택 측정) — load_skill 깔때기(offered/called/miss) 기록·요약, 플래그 보고.
 */
const mockQuery = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
}));

import { recordAutoSelect, getAutoSelectSummary, autoSelectFlags } from '../skill-usage-log';

const flush = () => new Promise((r) => setImmediate(r));

describe('skill-usage-log — 자동 선택 측정', () => {
    const saved = { ...process.env };
    beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });
    afterEach(() => { process.env = { ...saved }; });

    it('recordAutoSelect — 개수만 기록하고 비로그인은 guest', async () => {
        recordAutoSelect({ event: 'called', userId: 'u1', requested: 2, matched: 1 });
        recordAutoSelect({ event: 'offered', catalogSize: 12 });
        await flush();
        expect(mockQuery).toHaveBeenCalledTimes(2);
        expect(String(mockQuery.mock.calls[0][0])).toContain('INSERT INTO skill_auto_select_log');
        expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'called', null, 2, 1]);
        expect(mockQuery.mock.calls[1][1]).toEqual(['guest', 'offered', 12, null, null]);
    });

    it('DB 실패는 삼킨다 (fail-open)', async () => {
        mockQuery.mockRejectedValueOnce(new Error('relation does not exist'));
        expect(() => recordAutoSelect({ event: 'miss', requested: 1, matched: 0 })).not.toThrow();
        await flush();
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('getAutoSelectSummary — 일별·합계·호출률·실패율·평균 카탈로그 크기', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [
            { day: '2026-11-21', event: 'offered', n: '10', avg_catalog: '20' },
            { day: '2026-11-21', event: 'called', n: '3', avg_catalog: null },
            { day: '2026-11-22', event: 'offered', n: '10', avg_catalog: '30' },
            { day: '2026-11-22', event: 'called', n: '2', avg_catalog: null },
            { day: '2026-11-22', event: 'miss', n: '1', avg_catalog: null },
        ] });
        const s = await getAutoSelectSummary(7);
        expect(mockQuery.mock.calls[0][1]).toEqual([7]);
        expect(s).toMatchObject({ offered: 20, called: 5, miss: 1, callRate: 0.3, missRate: 0.167, avgCatalogSize: 25 });
        expect(s.daily).toEqual([
            { day: '2026-11-21', offered: 10, called: 3, miss: 0 },
            { day: '2026-11-22', offered: 10, called: 2, miss: 1 },
        ]);
    });

    it('기록이 없으면 비율은 null', async () => {
        const s = await getAutoSelectSummary(30);
        expect(s).toEqual({ offered: 0, called: 0, miss: 0, callRate: null, missRate: null, avgCatalogSize: null, daily: [] });
    });

    it('autoSelectFlags — 실행 중 프로세스의 값을 그대로 보고한다', () => {
        process.env.SKILL_AUTO_SELECT_ENABLED = 'true';
        process.env.SKILL_AUTO_SELECT_TOP_K = '5';
        delete process.env.SKILL_OVERFLOW_OFFER_ENABLED;
        expect(autoSelectFlags()).toMatchObject({ enabled: true, topK: 5, overflowOffer: true });
        process.env.SKILL_AUTO_SELECT_ENABLED = 'false';
        expect(autoSelectFlags()).toMatchObject({ enabled: false, overflowOffer: false });
    });
});
