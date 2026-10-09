/**
 * 로그인 리미터 우회 회귀(2026-10-09 점검 ③) — 검증되지 않은 X-API-Key 헤더가 액터 키가 되어
 * 요청마다 새 버킷이 생기면 loginLimit 이 무효가 된다.
 */
jest.mock('../config', () => ({
    getConfig: () => ({ storageBackend: 'memory', redisUrl: '', trustedProxies: [] }),
}));

import express from 'express';
import request from 'supertest';
import { resetKeyValueStoreForTests } from '../storage';
import { RL_AUTH, RL_AGENT_TASK } from '../config/rate-limits';

const { authLimiter, agentTaskLimiter } = require('../middlewares/rate-limiters');

function makeApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/auth', authLimiter);
    app.use('/api/agent-tasks', agentTaskLimiter);
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
    app.post('/api/agent-tasks/x/share', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('리미터 — X-API-Key 헤더 우회 차단', () => {
    beforeEach(() => resetKeyValueStoreForTests());

    test('로그인은 X-API-Key 를 매번 바꿔도 같은 IP 버킷으로 센다', async () => {
        const app = makeApp();
        const ip = '203.0.113.9';
        for (let i = 0; i < RL_AUTH.loginLimit; i++) {
            const r = await request(app).post('/api/auth/login')
                .set('X-Forwarded-For', ip).set('X-API-Key', `junk-${i}`).send({});
            expect(r.status).toBe(200);
        }
        const blocked = await request(app).post('/api/auth/login')
            .set('X-Forwarded-For', ip).set('X-API-Key', `junk-${RL_AUTH.loginLimit}`).send({});
        expect(blocked.status).toBe(429);
    });

    test('로그인은 유효 형식의 API 키라도 액터를 나누지 않는다', async () => {
        const app = makeApp();
        const ip = '203.0.113.10';
        for (let i = 0; i < RL_AUTH.loginLimit; i++) {
            await request(app).post('/api/auth/login')
                .set('X-Forwarded-For', ip).set('X-API-Key', `omk_live_${i.toString(16).padStart(32, '0')}`).send({});
        }
        const blocked = await request(app).post('/api/auth/login')
            .set('X-Forwarded-For', ip).set('X-API-Key', `omk_live_${'f'.repeat(32)}`).send({});
        expect(blocked.status).toBe(429);
    });

    test('일반 리미터에서 형식이 아닌 X-API-Key 는 IP 버킷으로 센다', async () => {
        const app = makeApp();
        const ip = '203.0.113.11';
        for (let i = 0; i < RL_AGENT_TASK.ipLimit; i++) {
            await request(app).post('/api/agent-tasks/x/share')
                .set('X-Forwarded-For', ip).set('X-API-Key', `not-a-key-${i}`).send({});
        }
        const blocked = await request(app).post('/api/agent-tasks/x/share')
            .set('X-Forwarded-For', ip).set('X-API-Key', 'not-a-key-last').send({});
        expect(blocked.status).toBe(429);
        // 유효 형식 키는 여전히 자기 버킷(기존 CLI 격리 보장)
        const cli = await request(app).post('/api/agent-tasks/x/share')
            .set('X-Forwarded-For', ip).set('X-API-Key', `omk_live_${'a'.repeat(32)}`).send({});
        expect(cli.status).toBe(200);
    });
});
