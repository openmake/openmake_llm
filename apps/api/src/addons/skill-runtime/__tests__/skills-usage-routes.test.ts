/**
 * skills-usage.routes — GET /usage/auto-select 는 관리자만, 플래그 + 깔때기 요약을 돌려준다.
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: { userId: string; role: string } };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };

jest.mock('../../../auth', () => ({
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        const id = req.headers['x-test-user'];
        if (!id) { res.status(401).json({}); return; }
        req.user = { userId: id, role: req.headers['x-test-role'] ?? 'user' };
        next();
    },
    requireAdmin: (req: TestReq, res: TestRes, next: () => void) => {
        if (req.user?.role !== 'admin') { res.status(403).json({}); return; }
        next();
    },
}));
const summaryMock = jest.fn();
jest.mock('../skill-usage-log', () => ({
    getSkillUsageSummary: jest.fn(async () => []),
    autoSelectFlags: () => ({ enabled: true, topK: 3, overflowOffer: true, usageLogEnabled: true }),
    getAutoSelectSummary: (...a: unknown[]) => summaryMock(...a),
}));

import router from '../routes/skills-usage.routes';

const app = express();
app.use('/api/agents/skills', router);
const get = (q = '') => request(app).get(`/api/agents/skills/usage/auto-select${q}`);

beforeEach(() => {
    summaryMock.mockReset();
    summaryMock.mockResolvedValue({ offered: 4, called: 1, miss: 1, callRate: 0.5, missRate: 0.5, avgCatalogSize: 9, daily: [] });
});

describe('GET /usage/auto-select', () => {
    it('비로그인 401, 일반 사용자 403', async () => {
        expect((await get()).status).toBe(401);
        expect((await get().set('x-test-user', '1')).status).toBe(403);
        expect(summaryMock).not.toHaveBeenCalled();
    });

    it('관리자는 플래그와 깔때기 요약을 받는다(기본 30일)', async () => {
        const res = await get().set('x-test-user', '1').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(summaryMock).toHaveBeenCalledWith(30);
        expect(res.body.data).toMatchObject({ days: 30, flags: { enabled: true, topK: 3 }, offered: 4, callRate: 0.5 });
    });

    it('days 범위를 벗어나면 400', async () => {
        const res = await get('?days=0').set('x-test-user', '1').set('x-test-role', 'admin');
        expect(res.status).toBe(400);
    });
});
