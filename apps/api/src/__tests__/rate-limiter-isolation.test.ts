/**
 * 레이트리밋 격리 — 2026-08-26 운영 실측으로 드러난 3가지 결함의 회귀 고정.
 *
 * ① 리미터끼리 카운터를 공유해 무관한 트래픽이 남의 예산을 먹었다
 * ② API key 클라이언트(CLI·데스크톱)가 프록시 IP 버킷에 섞여 남의 요청으로 429 를 맞았다
 * ③ 프록시 뒤에서 실 클라이언트 IP 가 사라져 외부 사용자 전원이 한 버킷을 썼다
 */
jest.mock('../config', () => ({
    getConfig: () => ({ storageBackend: 'memory', redisUrl: '', trustedProxies: [] }),
}));

import express from 'express';
import request from 'supertest';
import { resetKeyValueStoreForTests } from '../storage';
import { RL_CHAT, RL_AGENT_TASK } from '../config/rate-limits';

const { chatLimiter, agentTaskLimiter } = require('../middlewares/rate-limiters');

function makeApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/chat', chatLimiter);
    app.use('/api/agent-tasks', agentTaskLimiter);
    app.post('/api/chat', (_req, res) => res.json({ ok: true }));
    app.post('/api/agent-tasks/x/share', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('레이트리밋 격리', () => {
    beforeEach(() => resetKeyValueStoreForTests());

    test('한 리미터를 소진해도 다른 리미터 예산은 남는다', async () => {
        const app = makeApp();
        const ip = '203.0.113.200';
        for (let i = 0; i < RL_CHAT.ipLimit + 2; i++) {
            await request(app).post('/api/chat').set('X-Forwarded-For', ip).send({});
        }
        expect((await request(app).post('/api/chat').set('X-Forwarded-For', ip).send({})).status).toBe(429);

        // 같은 IP·같은 창이지만 에이전트 작업 리미터는 독립 카운터를 써야 한다
        const other = await request(app).post('/api/agent-tasks/x/share').set('X-Forwarded-For', ip).send({});
        expect(other.status).toBe(200);
    });

    test('API key 클라이언트는 IP 버킷과 분리된다', async () => {
        const app = makeApp();
        const proxyIp = '::1'; // 프록시 뒤 — 모든 익명 트래픽이 여기로 모인다
        for (let i = 0; i < RL_AGENT_TASK.ipLimit + 2; i++) {
            await request(app).post('/api/agent-tasks/x/share').set('X-Forwarded-For', proxyIp).send({});
        }
        expect((await request(app).post('/api/agent-tasks/x/share').set('X-Forwarded-For', proxyIp).send({})).status).toBe(429);

        // 같은 경로·같은 IP 라도 API key 는 자기 키 해시로 센다
        const cli = await request(app).post('/api/agent-tasks/x/share')
            .set('X-Forwarded-For', proxyIp).set('X-API-Key', 'omk_live_testkey_a').send({});
        expect(cli.status).toBe(200);
    });

    test('서로 다른 API key 는 서로의 예산을 먹지 않는다', async () => {
        const app = makeApp();
        for (let i = 0; i < RL_AGENT_TASK.ipLimit + 2; i++) {
            await request(app).post('/api/agent-tasks/x/share').set('X-API-Key', 'omk_live_key_one').send({});
        }
        expect((await request(app).post('/api/agent-tasks/x/share').set('X-API-Key', 'omk_live_key_one').send({})).status).toBe(429);
        expect((await request(app).post('/api/agent-tasks/x/share').set('X-API-Key', 'omk_live_key_two').send({})).status).toBe(200);
    });

    test('루프백 peer 에서는 CF-Connecting-IP 로 클라이언트를 구분한다', async () => {
        const app = makeApp();
        // supertest 는 루프백에서 연결한다 — XFF 없이 CF 헤더만 준다
        for (let i = 0; i < RL_CHAT.ipLimit + 2; i++) {
            await request(app).post('/api/chat').set('CF-Connecting-IP', '198.51.100.7').send({});
        }
        expect((await request(app).post('/api/chat').set('CF-Connecting-IP', '198.51.100.7').send({})).status).toBe(429);
        // 다른 방문자는 영향 없다 — 이것이 안 되면 외부 사용자 전원이 한 버킷을 쓴다
        expect((await request(app).post('/api/chat').set('CF-Connecting-IP', '198.51.100.8').send({})).status).toBe(200);
    });

    test('IP 형태가 아닌 CF 헤더는 무시한다(헤더 원문이 키가 되지 않게)', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/chat').set('CF-Connecting-IP', 'not-an-ip; drop table').send({});
        expect(res.status).toBe(200);
    });
});
