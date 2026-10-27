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
import { getTokenBlacklist } from '../data/models/token-blacklist';
import { getUserManager, type PublicUser } from '../data/user-manager';
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

// 관리자 JWT 판정은 DB 의 현재 role·is_active 로 재확인한다 — 기본은 토큰과 같은 role 의 활성 사용자
const dbUserFor = (id: string): PublicUser => ({ id, email: `${id}@example.test`, role: id === 'u-admin' ? 'admin' : 'user', created_at: '2026-10-25T00:00:00.000Z', is_active: true });

describe('GET /metrics', () => {
    let app: express.Application;
    let lookup: jest.SpyInstance;
    beforeAll(() => { app = createTestApp(); });
    beforeEach(() => {
        cfg.ENABLED = false; cfg.TOKEN = '';
        lookup = jest.spyOn(getUserManager(), 'getUserById').mockImplementation(async (id: string) => dbUserFor(id));
    });
    afterEach(() => { lookup.mockRestore(); });

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

        test('관리자 JWT + DB 에서도 활성 관리자 → 200', async () => {
            const res = await request(app).get('/metrics').set('Authorization', bearerJwt('admin'));
            expect(res.status).toBe(200);
            expect(res.text).toContain('# TYPE process_uptime_seconds gauge\n');
            expect(lookup).toHaveBeenCalledWith('u-admin');
        });

        test('관리자 JWT 지만 DB 의 현재 role 이 user(강등) → 401', async () => {
            lookup.mockResolvedValue({ ...dbUserFor('u-admin'), role: 'user' });
            expect((await request(app).get('/metrics').set('Authorization', bearerJwt('admin'))).status).toBe(401);
        });

        test('관리자 JWT 지만 DB 조회가 던짐 → 401(500 아님)', async () => {
            lookup.mockRejectedValue(new Error('db down'));
            expect((await request(app).get('/metrics').set('Authorization', bearerJwt('admin'))).status).toBe(401);
        });
    });

    // 실제 라우트 조립(setupApiRoutes)으로 검사한다. 테스트마다 다른 CF-Connecting-IP 로 IP 버킷을 나눈다(피어가 루프백일 때만 채택)
    describe('스크레이프 레이트 리밋 — IP 당 분당 기본 60(RL_METRICS_IP)', () => {
        const LIMIT = 60;
        const scrape = (ip: string, auth?: string) => {
            const req = request(app).get('/metrics').set('CF-Connecting-IP', ip);
            return auth ? req.set('Authorization', auth) : req;
        };

        test('맞는 토큰 — 한도까지 200(text/plain 0.0.4), 넘으면 429 + Retry-After', async () => {
            cfg.ENABLED = true; cfg.TOKEN = 'secret';
            for (let i = 0; i < LIMIT; i++) {
                const res = await scrape('203.0.113.10', 'Bearer secret');
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toContain('version=0.0.4');
            }
            const over = await scrape('203.0.113.10', 'Bearer secret');
            expect(over.status).toBe(429);
            expect(over.headers['retry-after']).toBeDefined();
            expect(over.body.error.code).toBe('RATE_LIMITED');
            // 다른 IP 는 영향 없음
            expect((await scrape('203.0.113.20', 'Bearer secret')).status).toBe(200);
        });

        test('인증 실패도 같은 예산 — 401 을 한도만큼 받은 뒤 429', async () => {
            cfg.ENABLED = true; cfg.TOKEN = 'secret';
            for (let i = 0; i < LIMIT; i++) expect((await scrape('203.0.113.11', 'Bearer wrong')).status).toBe(401);
            expect((await scrape('203.0.113.11', 'Bearer wrong')).status).toBe(429);
        });

        test('관리자 JWT 도 IP 로만 센다 — 토큰 블랙리스트(DB) 조회 없음, 관리자 배수 없음', async () => {
            cfg.ENABLED = true; cfg.TOKEN = '';
            const calls = (getTokenBlacklist as jest.Mock).mock.calls.length;
            for (let i = 0; i < LIMIT; i++) expect((await scrape('203.0.113.12', bearerJwt('admin'))).status).toBe(200);
            expect((await scrape('203.0.113.12', bearerJwt('admin'))).status).toBe(429);
            expect((getTokenBlacklist as jest.Mock).mock.calls.length).toBe(calls);
        });

        test('OFF 면 한도를 넘겨도 404 — 리미터가 기본 OFF 응답을 바꾸지 않는다', async () => {
            for (let i = 0; i <= LIMIT; i++) expect((await scrape('203.0.113.13', 'Bearer secret')).status).toBe(404);
        });
    });
});
