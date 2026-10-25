/**
 * /api/health 비관리자 응답 축소(W4) — 익명·일반 사용자는 상태 필드와 add-on 절만, 관리자는 종전 전체 응답.
 * add-on 절(knowledge 모드·generation·heartbeat 등)은 운영 모드 표시라 공개다 — 롤백 훈련 스크립트가 익명으로 읽는다.
 * 관리자 여부는 readHealthProcessSection(서명된 JWT 의 role, DB 조회 없음)으로 가른다.
 */
jest.mock('../../data/models/unified-database', () => ({
    getPool: jest.fn(() => ({ totalCount: 5, idleCount: 3, waitingCount: 0, query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
    getUnifiedDatabase: jest.fn(() => ({
        getPool: jest.fn(() => ({ totalCount: 5, idleCount: 3, waitingCount: 0, query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
    })),
    // api-key-limiter.ts 가 모듈 로드 시점에 windowMs 를 읽는다
    API_KEY_LIMITS: { rpm: 300, tpm: 1_000_000, windowMs: 60_000, dailyRequests: -1, monthlyRequests: -1 },
}));
jest.mock('../../bootstrap', () => ({ bootstrapServices: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../auth/middleware', () => ({
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
    optionalAuth: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// /api/health 는 DB 를 건드리지 않는다 — 블랙리스트 조회가 불리면 영원히 멈추게 해 둔다
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: jest.fn(() => ({ has: () => new Promise<boolean>(() => { /* 대기 */ }) })),
}));

import express from 'express';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../../config/env';
import { setupApiRoutes } from '../setup';
import { registerHealthSection } from '../../runtime-ports/health-sections';

function createTestApp(): express.Application {
    const app = express();
    app.use(express.json());
    const cluster = {
        getStats: jest.fn(() => ({ onlineNodes: 1, totalNodes: 2, uniqueModels: ['m-a', 'm-b'] })),
    } as unknown as import('../../cluster/manager').ClusterManager;
    setupApiRoutes(app, cluster, jest.fn());
    return app;
}

const bearer = (role: string): string => `Bearer ${jwt.sign(
    { userId: `u-${role}`, email: `${role}@example.test`, role, type: 'access' },
    getConfig().jwtSecret, { expiresIn: '5m', jwtid: `jti-anon-${role}` })}`;

const ADMIN_ONLY_SERVICE_KEYS = { database: ['total', 'idle', 'waiting'], llm: ['totalNodes', 'onlineNodes', 'models'] } as const;

describe('GET /api/health — 비관리자는 상태 필드와 add-on 절만(W4)', () => {
    let app: express.Application;
    let offSection: () => void;

    beforeAll(() => {
        app = createTestApp();
        offSection = registerHealthSection('sample', async () => ({ mode: 'inprocess', generation: 3 }));
    });
    afterAll(() => offSection());

    test('익명 → status·timestamp·services.{database,llm}.status·add-on 절 (memory·풀 수·노드 수·uptime·process 없음)', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: 'ok',
            timestamp: expect.any(String),
            services: { database: { status: 'connected' }, llm: { status: 'online' } },
            sample: { mode: 'inprocess', generation: 3 },
        });
        expect(res.body).not.toHaveProperty('uptime');
        expect(res.body).not.toHaveProperty('process');
        expect(res.body.services).not.toHaveProperty('memory');
        for (const key of ADMIN_ONLY_SERVICE_KEYS.database) expect(res.body.services.database).not.toHaveProperty(key);
        for (const key of ADMIN_ONLY_SERVICE_KEYS.llm) expect(res.body.services.llm).not.toHaveProperty(key);
    });

    test('잘못된 토큰·일반 사용자 토큰도 익명과 같다', async () => {
        for (const auth of ['Bearer a.b.c', bearer('user')]) {
            const res = await request(app).get('/api/health').set('Authorization', auth);
            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(['sample', 'services', 'status', 'timestamp']);
            expect(res.body.services).toEqual({ database: { status: 'connected' }, llm: { status: 'online' } });
        }
    });

    test('관리자 → 종전 전체 응답(uptime·풀 수·모델 수·memory·add-on 절·process)', async () => {
        const res = await request(app).get('/api/health').set('Authorization', bearer('admin'));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: 'ok',
            timestamp: expect.any(String),
            uptime: expect.any(Number),
            services: {
                database: { status: 'connected', total: 5, idle: 3, waiting: 0 },
                llm: { status: 'online', totalNodes: 2, onlineNodes: 1, models: 2 },
                memory: { heapUsedMB: expect.any(Number), heapTotalMB: expect.any(Number), rssMB: expect.any(Number) },
            },
            sample: { mode: 'inprocess', generation: 3 },
            process: { pid: process.pid, rss: expect.any(Number), heapUsed: expect.any(Number), uptimeSec: expect.any(Number) },
        });
    });
});
