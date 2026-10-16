/**
 * routes-setup.test.ts
 * P1-4: API 라우트 마운트 통합 테스트
 *
 * supertest를 사용하지 않고 Express 앱을 직접 테스트합니다.
 * 실제 DB/클러스터 없이 mock으로 격리합니다.
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
    // api-key-limiter.ts 가 모듈 로드 시점에 windowMs 를 읽는다 — 누락 시 suite 로드 실패
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
        getStats: jest.fn(() => ({
            onlineNodes: 1,
            totalNodes: 1,
            uniqueModels: ['llama3.2']
        })),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn()
    }))
}));

jest.mock('../bootstrap', () => ({
    bootstrapServices: jest.fn().mockResolvedValue(undefined)
}));

// auth 미들웨어 mock (JWT 검증 우회) — 실제 시그니처(`(req, res, next)` 미들웨어)와 같은 모양이어야 한다.
// 종전엔 팩토리(`() => middleware`)로 잘못 mock 돼 있어, 미들웨어로 직접 불리면 next 가 호출되지 않았다
// (add-on 라우트 게이트가 optionalAuth 를 직접 부르면서 /api/agents 요청이 멈춰 드러남, 2026-09-20).
jest.mock('../auth/middleware', () => ({
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
    optionalAuth: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next()
}));

// /api/health 는 DB 를 건드리지 않는다 — 블랙리스트 조회가 불리면 영원히 멈추게 해 둔다(멈춘 풀 흉내)
jest.mock('../data/models/token-blacklist', () => ({
    getTokenBlacklist: jest.fn(() => ({ has: () => new Promise<boolean>(() => { /* 대기 */ }) })),
}));

import express from 'express';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { getConfig } from '../config/env';
import { optionalAuth } from '../auth/middleware';
import { getTokenBlacklist } from '../data/models/token-blacklist';
import { setupApiRoutes } from '../routes/setup';
import { registerHealthSection } from '../runtime-ports/health-sections';

// ── 테스트용 Express 앱 생성 ──
function createTestApp() {
    const app = express();
    app.use(express.json());

    const mockCluster = {
        getStats: jest.fn(() => ({
            onlineNodes: 1,
            totalNodes: 1,
            uniqueModels: ['llama3.2']
        }))
    } as unknown as import('../cluster/manager').ClusterManager;

    const mockBroadcast = jest.fn();

    setupApiRoutes(app, mockCluster, mockBroadcast);
    return app;
}

describe('라우트 설정 — 기본 엔드포인트', () => {
    let app: express.Application;

    beforeAll(() => {
        app = createTestApp();
    });

    test('GET /favicon.ico → 204', async () => {
        const res = await request(app).get('/favicon.ico');
        expect(res.status).toBe(204);
    });

    test('GET /robots.txt → 200, text/plain', async () => {
        const res = await request(app).get('/robots.txt');
        expect(res.status).toBe(200);
        expect(res.text).toContain('User-agent: *');
        expect(res.text).toContain('Disallow: /api/');
    });

    test('GET /api/health → 200, status ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.timestamp).toBeDefined();
        expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });

    test('GET /api/health → services 구조 포함', async () => {
        const res = await request(app).get('/api/health');
        expect(res.body.services).toBeDefined();
        expect(res.body.services.database).toBeDefined();
        expect(res.body.services.llm).toBeDefined();
        expect(res.body.services.memory).toBeDefined();
    });

    test('GET /api/health → add-on 이 등록한 절이 최상위 키로 붙는다', async () => {
        const off = registerHealthSection('sample', async () => ({ mode: 'inprocess', generation: 3 }));
        try {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.sample).toEqual({ mode: 'inprocess', generation: 3 });
        } finally {
            off();
        }
    });

    test('GET /api/health → 절 하나가 실패해도 200 이고 그 절만 error', async () => {
        const off = registerHealthSection('broken', async () => { throw new Error('db down'); });
        try {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.broken).toEqual({ error: 'db down' });
        } finally {
            off();
        }
    });

    describe('GET /api/health → 관리자 process 필드는 서명된 JWT 만으로 판단한다(DB 조회 없음)', () => {
        const bearer = (role: string): string => `Bearer ${jwt.sign(
            { userId: `u-${role}`, email: `${role}@example.test`, role, type: 'access' },
            getConfig().jwtSecret, { expiresIn: '5m', jwtid: `jti-${role}` })}`;
        beforeEach(() => {
            (optionalAuth as jest.Mock).mockClear();
            (getTokenBlacklist as jest.Mock).mockClear();
        });
        afterEach(() => {
            expect(optionalAuth).not.toHaveBeenCalled();
            expect(getTokenBlacklist).not.toHaveBeenCalled();
        });

        test('토큰 없음 → 200, process 없음', async () => {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.process).toBeUndefined();
        });

        test('잘못된 토큰 → 200 게스트, process 없음', async () => {
            const res = await request(app).get('/api/health').set('Authorization', 'Bearer a.b.c');
            expect(res.status).toBe(200);
            expect(res.body.process).toBeUndefined();
        });

        test('일반 사용자 토큰 → 200, process 없음', async () => {
            const res = await request(app).get('/api/health').set('Authorization', bearer('user'));
            expect(res.status).toBe(200);
            expect(res.body.process).toBeUndefined();
        });

        test('관리자 토큰 → 200, process{pid,rss,heapUsed,uptimeSec}', async () => {
            const res = await request(app).get('/api/health').set('Authorization', bearer('admin'));
            expect(res.status).toBe(200);
            expect(res.body.process).toEqual({ pid: process.pid, rss: expect.any(Number), heapUsed: expect.any(Number), uptimeSec: expect.any(Number) });
        });
    });

    test('GET /ready → 200', async () => {
        const res = await request(app).get('/ready');
        expect(res.status).toBe(200);
    });

    test('존재하지 않는 API 경로 → 404', async () => {
        const res = await request(app).get('/api/nonexistent-route-xyz');
        expect(res.status).toBe(404);
    });

    test('GET /api/agents → 200 또는 인증 오류', async () => {
        const res = await request(app).get('/api/agents');
        expect([200, 401, 403]).toContain(res.status);
    });

    test('GET /api/model → 200 또는 인증 오류', async () => {
        const res = await request(app).get('/api/model');
        expect([200, 401, 403]).toContain(res.status);
    });

    test('GET /apple-touch-icon.png → 204', async () => {
        const res = await request(app).get('/apple-touch-icon.png');
        expect(res.status).toBe(204);
    });
});
