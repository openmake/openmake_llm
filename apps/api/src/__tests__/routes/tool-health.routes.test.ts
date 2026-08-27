/**
 * tool-health.routes — 도구 헬스 관측 API 테스트.
 *
 * 무DB — repository 는 mock, auth 미들웨어는 role 주입 mock 으로 우회.
 * 검증 대상은 라우트가 가진 실제 로직: 파라미터 클램프, 실패율 계산, 도구×카테고리 병합.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

let currentRole: 'admin' | 'user' = 'admin';

jest.mock('../../auth', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'test-admin', userId: 'test-admin', role: currentRole };
        next();
    },
    requireAdmin: (req: Request & { user?: { role?: string } }, res: Response, next: NextFunction) => {
        if (req.user?.role === 'admin') next();
        else res.status(403).json({ success: false, error: 'FORBIDDEN' });
    },
}));

const getToolHealth = jest.fn();
const getErrorCategories = jest.fn();
const getSummary = jest.fn();
jest.mock('../../data/repositories/tool-health-repository', () => ({
    ToolHealthRepository: jest.fn().mockImplementation(() => ({ getToolHealth, getErrorCategories, getSummary })),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { toolHealthRouter } from '../../routes/tool-health.routes';

function makeApp() {
    const app = express();
    app.use('/api/metrics/tools', toolHealthRouter);
    return app;
}

describe('GET /api/metrics/tools/health', () => {
    beforeEach(() => {
        currentRole = 'admin';
        getToolHealth.mockReset().mockResolvedValue([]);
        getErrorCategories.mockReset().mockResolvedValue([]);
        getSummary.mockReset().mockResolvedValue({ calls: '0', errors: '0', distinct_tools: '0', failing_tools: '0' });
    });

    it('비관리자는 403', async () => {
        currentRole = 'user';
        await request(makeApp()).get('/api/metrics/tools/health').expect(403);
    });

    it('실패율을 계산하고 도구별 카테고리를 병합한다', async () => {
        getSummary.mockResolvedValue({ calls: '100', errors: '25', distinct_tools: '9', failing_tools: '4' });
        getToolHealth.mockResolvedValue([
            { tool: 'a::b', server: 'a', calls: '4', errors: '3', last_error_at: new Date('2026-08-20T00:00:00Z'), p50_duration_ms: '12' },
            { tool: 'c', server: 'builtin', calls: '10', errors: '0', last_error_at: null, p50_duration_ms: null },
        ]);
        getErrorCategories.mockResolvedValue([
            { tool: 'a::b', category: 'timeout', count: '2' },
            { tool: 'a::b', category: null, count: '1' },
        ]);

        const res = await request(makeApp()).get('/api/metrics/tools/health').expect(200);
        const data = res.body.data;

        expect(data.summary.errorRate).toBeCloseTo(0.25);
        expect(data.tools[0].errorRate).toBeCloseTo(0.75);
        expect(data.tools[0].p50DurationMs).toBe(12);
        expect(data.tools[0].lastErrorAt).toBe('2026-08-20T00:00:00.000Z');
        // 카테고리 미기록 실패는 'unknown' 으로 묶는다 — 키를 비우면 "원인 없음" 과 구분되지 않는다.
        expect(data.tools[0].byCategory).toEqual({ timeout: 2, unknown: 1 });
        // 실패 0 인 도구는 빈 맵 + null 안전
        expect(data.tools[1].errorRate).toBe(0);
        expect(data.tools[1].byCategory).toEqual({});
        expect(data.tools[1].p50DurationMs).toBeNull();
        expect(data.tools[1].lastErrorAt).toBeNull();
    });

    it('파라미터는 기본값이 아니라 경계로 클램프된다', async () => {
        await request(makeApp()).get('/api/metrics/tools/health?days=99999&minCalls=0&limit=99999').expect(200);
        const [days, minCalls, limit] = getToolHealth.mock.calls[0];
        expect(days).toBe(180);   // MAX_DAYS
        expect(minCalls).toBe(1); // 하한
        expect(limit).toBe(200);  // MAX_LIMIT
    });

    it('숫자가 아닌 파라미터는 기본값', async () => {
        await request(makeApp()).get('/api/metrics/tools/health?days=abc').expect(200);
        expect(getToolHealth.mock.calls[0][0]).toBe(30);
    });

    it('호출 0 이어도 errorRate 는 NaN 이 아닌 0', async () => {
        const res = await request(makeApp()).get('/api/metrics/tools/health').expect(200);
        expect(res.body.data.summary.errorRate).toBe(0);
    });
});
