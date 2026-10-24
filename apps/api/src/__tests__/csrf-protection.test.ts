/**
 * csrf-protection.test.ts
 * Stage 2-H4: CSRF Double-Submit Cookie 미들웨어 + 토큰 엔드포인트 검증
 */

const configState = {
    csrfProtection: 'enforce' as 'off' | 'warn' | 'enforce',
    cookieSecure: false,
};

jest.mock('../config', () => ({
    getConfig: () => configState,
}));
const logAudit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }) }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { csrfProtectionMiddleware, csrfTokenIssuer } from '../middlewares/csrf-protection';

function createApp(): express.Application {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.get('/api/csrf-token', csrfTokenIssuer);
    app.use('/api', csrfProtectionMiddleware);
    app.post('/api/test', (_req, res) => res.json({ ok: true }));
    app.get('/api/test-get', (_req, res) => res.json({ ok: true }));
    app.delete('/api/test', (_req, res) => res.json({ ok: true }));
    app.post('/api/auth/callback/google', (_req, res) => res.json({ ok: true }));
    return app;
}

function tokenFromSetCookie(setCookie: string[] | undefined): string {
    if (!setCookie) throw new Error('no Set-Cookie');
    const csrf = setCookie.find((c) => c.startsWith('csrf_token='));
    if (!csrf) throw new Error('no csrf_token cookie');
    return csrf.split(';')[0].split('=')[1];
}

describe('CSRF — Double-Submit Cookie middleware (Stage 2-H4)', () => {
    let app: express.Application;

    beforeEach(() => {
        app = createApp();
        configState.csrfProtection = 'enforce';
    });

    test('GET /api/csrf-token issues non-HttpOnly csrf_token cookie', async () => {
        const res = await request(app).get('/api/csrf-token');
        expect(res.status).toBe(200);
        const setCookie = res.headers['set-cookie'] as unknown as string[];
        const csrf = setCookie.find((c) => c.startsWith('csrf_token='));
        expect(csrf).toBeDefined();
        // HttpOnly 없음(=JS 읽기 허용), SameSite=Strict
        expect(csrf!.toLowerCase()).not.toContain('httponly');
        expect(csrf!.toLowerCase()).toContain('samesite=strict');
        expect(res.body.token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test('mode=off: mutating POST without token passes', async () => {
        configState.csrfProtection = 'off';
        const res = await request(app).post('/api/test').send({});
        expect(res.status).toBe(200);
    });

    test('mode=warn: mutating POST without token passes (log-only)', async () => {
        configState.csrfProtection = 'warn';
        const res = await request(app).post('/api/test').send({});
        expect(res.status).toBe(200);
    });

    test('mode=enforce: POST without cookie/header → 403', async () => {
        const res = await request(app).post('/api/test').send({});
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    test('mode=enforce: cookie-only without header → 403', async () => {
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        const res = await request(app)
            .post('/api/test')
            .set('Cookie', `csrf_token=${token}`)
            .send({});
        expect(res.status).toBe(403);
    });

    test('mode=enforce: mismatched header/cookie → 403', async () => {
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        const res = await request(app)
            .post('/api/test')
            .set('Cookie', `csrf_token=${token}`)
            .set('X-CSRF-Token', token + 'x')
            .send({});
        expect(res.status).toBe(403);
    });

    test('mode=enforce: matching header+cookie → 200', async () => {
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        const res = await request(app)
            .post('/api/test')
            .set('Cookie', `csrf_token=${token}`)
            .set('X-CSRF-Token', token)
            .send({});
        expect(res.status).toBe(200);
    });

    test('mode=enforce: GET skipped even without token', async () => {
        const res = await request(app).get('/api/test-get');
        expect(res.status).toBe(200);
    });

    test('mode=enforce: X-API-Key header skipped (non-cookie auth)', async () => {
        const res = await request(app)
            .post('/api/test')
            .set('X-API-Key', 'omk_live_sk_fakekey')
            .send({});
        expect(res.status).toBe(200);
    });

    test('mode=enforce: Bearer Authorization skipped (non-cookie auth)', async () => {
        const res = await request(app)
            .post('/api/test')
            .set('Authorization', 'Bearer eyJfakeJwt')
            .send({});
        expect(res.status).toBe(200);
    });

    test('mode=enforce: OAuth callback path skipped', async () => {
        const res = await request(app).post('/api/auth/callback/google').send({});
        expect(res.status).toBe(200);
    });

    test('mode=enforce: timing-safe comparison rejects equal-length mismatches', async () => {
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        // 같은 길이, 내용만 다른 토큰
        const fake = 'A'.repeat(token.length);
        const res = await request(app)
            .post('/api/test')
            .set('Cookie', `csrf_token=${token}`)
            .set('X-CSRF-Token', fake)
            .send({});
        expect(res.status).toBe(403);
    });

    test('mode=enforce: DELETE also protected', async () => {
        const res = await request(app).delete('/api/test');
        expect(res.status).toBe(403);
    });
});

describe('CSRF 거부 감사(#1475)', () => {
    const app = createApp();
    const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
    beforeEach(() => { logAudit.mockReset().mockImplementation(async () => undefined); configState.csrfProtection = 'enforce'; });

    test('enforce 거부는 응답 그대로 security.authz_denied 를 한 번 남기고 토큰 값은 넣지 않는다', async () => {
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        const fake = 'B'.repeat(token.length);
        const res = await request(app).post('/api/test').set('Cookie', `csrf_token=${token}`).set('X-CSRF-Token', fake).send({});
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'CSRF validation failed', code: 'CSRF_TOKEN_MISMATCH' });
        await flush();
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit.mock.calls[0][0]).toEqual(expect.objectContaining({
            action: 'security.authz_denied', resourceType: 'http', resourceId: 'POST /api/test',
            details: expect.objectContaining({ reason: 'csrf_token_mismatch', status: 403, actorId: 'anonymous' }),
        }));
        const logged = JSON.stringify(logAudit.mock.calls);
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(fake);
    });

    test('warn 모드(통과)와 일치 토큰은 감사하지 않는다', async () => {
        configState.csrfProtection = 'warn';
        await request(app).post('/api/test').send({});
        configState.csrfProtection = 'enforce';
        const tokenRes = await request(app).get('/api/csrf-token');
        const token = tokenFromSetCookie(tokenRes.headers['set-cookie'] as unknown as string[]);
        await request(app).post('/api/test').set('Cookie', `csrf_token=${token}`).set('X-CSRF-Token', token).send({});
        await flush();
        expect(logAudit).not.toHaveBeenCalled();
    });

    test('감사 저장이 실패해도 403 응답은 그대로다', async () => {
        logAudit.mockImplementation(async () => { throw new Error('db down'); });
        const res = await request(app).post('/api/test').send({});
        await flush();
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'CSRF validation failed', code: 'CSRF_TOKEN_MISMATCH' });
    });
});
