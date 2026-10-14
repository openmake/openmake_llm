/**
 * /api/v1 은 라우터 안에서 키별 RPM·TPM 리미터(apiKeyRateLimiter·apiKeyTPMLimiter)를 이미 건다.
 * generalLimiter 까지 타면 같은 요청이 이중으로 세어진다 — 전용 리미터 경로로 제외돼야 한다.
 */
const mockGeneralLimiter = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());
jest.mock('../middlewares/index', () => {
    const pass = (_req: unknown, _res: unknown, next: () => void) => next();
    return new Proxy({}, {
        get: (_t, name) => (name === 'generalLimiter' ? mockGeneralLimiter : name === '__esModule' ? false : pass),
    });
});
jest.mock('../config', () => ({ getConfig: () => ({ trustedProxies: [] }) }));

import express from 'express';
import request from 'supertest';
import { setupParsersAndLimiting } from '../middlewares/setup';

function makeApp() {
    const app = express();
    setupParsersAndLimiting(app);
    app.use((_req, res) => res.json({ ok: true }));
    return app;
}

describe('setupParsersAndLimiting — generalLimiter 적용 범위', () => {
    beforeEach(() => mockGeneralLimiter.mockClear());

    test('/api/v1/... 는 generalLimiter 를 타지 않는다(전용 리미터 이중 카운팅 방지)', async () => {
        await request(makeApp()).get('/api/v1/models');
        await request(makeApp()).post('/api/v1/chat/completions').send({});
        expect(mockGeneralLimiter).not.toHaveBeenCalled();
    });

    test('전용 리미터가 없는 경로는 여전히 generalLimiter 를 탄다', async () => {
        await request(makeApp()).get('/api/conversations');
        expect(mockGeneralLimiter).toHaveBeenCalledTimes(1);
    });
});
