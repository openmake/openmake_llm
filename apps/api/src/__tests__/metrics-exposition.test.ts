/**
 * GET /metrics — Prometheus 텍스트 노출(R9-a). 기본 OFF(404), 토큰 또는 관리자 JWT 로만 열린다.
 * mock 목록·createTestApp 은 routes-setup.test.ts 와 같다.
 */

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(() => ({
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    })),
    getUnifiedDatabase: jest.fn(() => ({
        getPool: jest.fn(() => ({
            totalCount: 5,
            idleCount: 3,
            waitingCount: 0,
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        }))
    })),
    API_KEY_LIMITS: {
        rpm: 300,
        tpm: 1_000_000,
        windowMs: 60_000,
        dailyRequests: -1,
        monthlyRequests: -1,
    }
}));

jest.mock('../cluster/manager', () => ({
    getClusterManager: jest.fn(() => ({
        getStats: jest.fn(() => ({ onlineNodes: 1, totalNodes: 1, uniqueModels: ['llama3.2'] })),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn()
    }))
}));

jest.mock('../bootstrap', () => ({
    bootstrapServices: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../auth/middleware', () => ({
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
    optionalAuth: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next()
}));

jest.mock('../data/models/token-blacklist', () => ({
    getTokenBlacklist: jest.fn(() => ({ has: () => new Promise<boolean>(() => { /* 대기 */ }) })),
}));

// 요청 시점에 읽는 설정 — 테스트마다 값을 바꾼다
jest.mock('../config/metrics-exposition', () => ({
    METRICS_EXPOSITION: { ENABLED: false, TOKEN: '' },
}));

import express from 'express';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config/env';
import { METRICS_EXPOSITION } from '../config/metrics-exposition';
import { setupApiRoutes } from '../routes/setup';

const cfg = METRICS_EXPOSITION as { ENABLED: boolean; TOKEN: string };

function createTestApp() {
    const app = express();
    app.use(express.json());
    const mockCluster = {
        getStats: jest.fn(() => ({ onlineNodes: 1, totalNodes: 1, uniqueModels: ['llama3.2', getConfig().llmDefaultModel] }))
    } as unknown as import('../cluster/manager').ClusterManager;
    setupApiRoutes(app, mockCluster, jest.fn());
    return app;
}

const bearerJwt = (role: string): string => `Bearer ${jwt.sign(
    { userId: `u-${role}`, email: `${role}@example.test`, role, type: 'access' },
    getConfig().jwtSecret, { expiresIn: '5m', jwtid: `jti-m-${role}` })}`;

describe('GET /metrics', () => {
    let app: express.Application;
    beforeAll(() => { app = createTestApp(); });
    beforeEach(() => { cfg.ENABLED = false; cfg.TOKEN = ''; });

    test('OFF → 404', async () => {
        const res = await request(app).get('/metrics').set('Authorization', bearerJwt('admin'));
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('NOT_FOUND');
    });

    describe('ON + METRICS_TOKEN=secret', () => {
        beforeEach(() => { cfg.ENABLED = true; cfg.TOKEN = 'secret'; });

        test('헤더 없음 → 401', async () => {
            const res = await request(app).get('/metrics');
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        test('틀린 토큰(같은 길이·다른 길이) → 401', async () => {
            expect((await request(app).get('/metrics').set('Authorization', 'Bearer secreT')).status).toBe(401);
            expect((await request(app).get('/metrics').set('Authorization', 'Bearer secret-longer')).status).toBe(401);
        });

        test('토큰이 설정돼 있으면 관리자 JWT 로는 열리지 않는다 → 401', async () => {
            const res = await request(app).get('/metrics').set('Authorization', bearerJwt('admin'));
            expect(res.status).toBe(401);
        });

        test('맞는 토큰 → 200, text/plain 0.0.4, uptime·큐 게이지 포함', async () => {
            const res = await request(app).get('/metrics').set('Authorization', 'Bearer secret');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/^text\/plain/);
            expect(res.headers['content-type']).toContain('version=0.0.4');
            expect(res.text).toContain('# TYPE process_uptime_seconds gauge\n');
            expect(res.text).toMatch(/\nagent_task_queue_pending \d+\n/);
            expect(res.text).toMatch(/\nagent_task_queue_active \d+\n/);
            expect(res.text).toMatch(/\nagent_task_queue_oldest_wait_ms \d+\n/);
            expect(res.text.endsWith('\n')).toBe(true);
        });
    });

    describe('ON + 토큰 없음(관리자 JWT 만)', () => {
        beforeEach(() => { cfg.ENABLED = true; cfg.TOKEN = ''; });

        test('헤더 없음 → 401', async () => {
            expect((await request(app).get('/metrics')).status).toBe(401);
        });

        test('비관리자 JWT → 401', async () => {
            expect((await request(app).get('/metrics').set('Authorization', bearerJwt('user'))).status).toBe(401);
        });

        test('관리자 JWT → 200', async () => {
            const res = await request(app).get('/metrics').set('Authorization', bearerJwt('admin'));
            expect(res.status).toBe(200);
            expect(res.text).toContain('# TYPE process_uptime_seconds gauge\n');
        });
    });
});
