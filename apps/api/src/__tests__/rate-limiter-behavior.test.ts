/**
 * rate-limiter-behavior.test.ts
 * Stage 2-H3 Phase 2: rate-limiters.ts KeyValueStore 이전의 behavior-preserving
 * 검증. 이 스위트는 refactor 전후 모두 GREEN이어야 한다.
 */

jest.mock('../config', () => ({
    getConfig: () => ({
        storageBackend: 'memory',
        redisUrl: '',
        trustedProxies: [],
    }),
}));

import express from 'express';
import request from 'supertest';
import { resetKeyValueStoreForTests } from '../storage';
import { RL_CHAT } from '../config/rate-limits';

// import 후에 limiter를 생성 (Map 또는 Store가 같은 config 경로를 사용하도록)
 
const { chatLimiter } = require('../middlewares/rate-limiters');

function makeApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/chat', chatLimiter);
    app.post('/api/chat', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('rate-limiter behavior (Stage 2-H3 Phase 2 baseline)', () => {
    beforeEach(() => {
        resetKeyValueStoreForTests();
        // Sync in-memory Map: 테스트 격리를 위해 Jest module cache 초기화
        jest.isolateModules(() => { /* no-op — Map은 모듈 상수 */ });
    });

    test('requests within ipLimit pass (RL_CHAT.ipLimit = 30)', async () => {
        const app = makeApp();
        const ip = '203.0.113.100';
        // ipLimit 이하 요청은 모두 통과해야 함
        for (let i = 0; i < RL_CHAT.ipLimit - 1; i++) {
            const res = await request(app).post('/api/chat').set('X-Forwarded-For', ip).send({});
            expect(res.status).toBe(200);
        }
    });

    test('requests exceeding ipLimit trigger 429 with rate-limit headers', async () => {
        const app = makeApp();
        const ip = '203.0.113.101';
        // 한도 끝까지 채운 뒤 +1 요청
        for (let i = 0; i < RL_CHAT.ipLimit; i++) {
            await request(app).post('/api/chat').set('X-Forwarded-For', ip).send({});
        }
        const over = await request(app).post('/api/chat').set('X-Forwarded-For', ip).send({});
        expect(over.status).toBe(429);
        expect(over.headers['retry-after']).toBeDefined();
        expect(over.headers['x-ratelimit-limit']).toBeDefined();
        expect(over.headers['x-ratelimit-remaining']).toBe('0');
    });

    test('different IPs have independent counters', async () => {
        const app = makeApp();
        const ipA = '203.0.113.102';
        const ipB = '203.0.113.103';
        // ipA에서 한도 꽉 채움
        for (let i = 0; i < RL_CHAT.ipLimit; i++) {
            await request(app).post('/api/chat').set('X-Forwarded-For', ipA).send({});
        }
        const overA = await request(app).post('/api/chat').set('X-Forwarded-For', ipA).send({});
        expect(overA.status).toBe(429);

        // ipB는 영향 없이 통과
        const freshB = await request(app).post('/api/chat').set('X-Forwarded-For', ipB).send({});
        expect(freshB.status).toBe(200);
    });

    test('successful response carries X-RateLimit-* headers', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/chat').set('X-Forwarded-For', '203.0.113.104').send({});
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-reset']).toBeDefined();
        const remaining = Number(res.headers['x-ratelimit-remaining']);
        expect(remaining).toBeGreaterThanOrEqual(0);
        expect(remaining).toBeLessThanOrEqual(RL_CHAT.ipLimit);
    });
});
