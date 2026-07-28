/**
 * api-cache-control.test.ts
 * Stage 2-M1: /api/* 응답이 Cache-Control: no-store 헤더를 일관되게 보내 민감 데이터의
 * 브라우저 disk/BFCache 저장을 차단하는지 검증.
 */

import express from 'express';
import request from 'supertest';
import { setupSecurity } from '../middlewares/setup';

function createApp(): express.Application {
    const app = express();
    setupSecurity(app);
    app.get('/api/test-json', (_req, res) => res.json({ ok: true }));
    app.post('/api/test-post', (_req, res) => res.json({ ok: true }));
    app.get('/public-page', (_req, res) => res.send('<html></html>'));
    return app;
}

describe('API Cache-Control (Stage 2-M1)', () => {
    const app = createApp();

    test('GET /api/* responds with Cache-Control: no-store', async () => {
        const res = await request(app).get('/api/test-json');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('POST /api/* responds with Cache-Control: no-store', async () => {
        const res = await request(app).post('/api/test-post').send({});
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('non-/api routes are NOT forced to no-store (can opt-in)', async () => {
        const res = await request(app).get('/public-page');
        expect(res.status).toBe(200);
        // 정적 페이지는 별도 정책 (express.static에서 no-cache 설정)
        expect(res.headers['cache-control']).not.toBe('no-store');
    });

    test('Content-Type is still application/json for /api', async () => {
        const res = await request(app).get('/api/test-json');
        expect(res.headers['content-type']).toMatch(/application\/json/);
    });
});
