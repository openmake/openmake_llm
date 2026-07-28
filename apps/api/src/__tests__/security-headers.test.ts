/**
 * security-headers.test.ts
 * setupSecurity 가 모든 응답에 적용하는 보안 헤더 검증.
 *
 * - Permissions-Policy (Stage 2-M5)
 * - Helmet hardening: HSTS·COOP·nosniff·Referrer-Policy (Stage 2-M6)
 *
 * (구 csp-hash-enforcement.test.ts 대체 — 레거시 SPA CSP hash 서빙은
 *  2026-06-24 apps/web 이전과 함께 제거되어 helmet contentSecurityPolicy:false.
 *  CSP hash enforce 테스트는 제거된 기능이라 함께 폐기.)
 */

jest.mock('../config', () => ({
    getConfig: () => ({
        llmBaseUrl: 'http://localhost:11434',
        trustedProxies: []
    })
}));

import express from 'express';
import request from 'supertest';
import { setupSecurity } from '../middlewares/setup';

function createApp(): express.Application {
    const app = express();
    setupSecurity(app);
    app.get('/', (_req, res) => { res.json({ ok: true }); });
    return app;
}

describe('Permissions-Policy header (Stage 2-M5)', () => {
    let headers: Record<string, string>;

    beforeAll(async () => {
        const app = createApp();
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        headers = res.headers as Record<string, string>;
    });

    test('Permissions-Policy header is set', () => {
        expect(headers['permissions-policy']).toBeDefined();
    });

    test('powerful APIs are blocked with ()', () => {
        const pp = headers['permissions-policy'];
        expect(pp).toMatch(/camera=\(\)/);
        expect(pp).toMatch(/microphone=\(\)/);
        expect(pp).toMatch(/geolocation=\(\)/);
        expect(pp).toMatch(/usb=\(\)/);
        expect(pp).toMatch(/payment=\(\)/);
        expect(pp).toMatch(/bluetooth=\(\)/);
        expect(pp).toMatch(/serial=\(\)/);
    });

    test('clipboard-write allowed as (self), clipboard-read blocked', () => {
        const pp = headers['permissions-policy'];
        expect(pp).toMatch(/clipboard-write=\(self\)/);
        expect(pp).toMatch(/clipboard-read=\(\)/);
    });

    test('privacy directives block FLoC/Topics', () => {
        const pp = headers['permissions-policy'];
        expect(pp).toMatch(/interest-cohort=\(\)/);
        expect(pp).toMatch(/browsing-topics=\(\)/);
    });

    test('no wildcard (*) allowlists present', () => {
        const pp = headers['permissions-policy'];
        expect(pp).not.toMatch(/=\*/);
    });
});

describe('Helmet hardening (Stage 2-M6)', () => {
    let headers: Record<string, string>;

    beforeAll(async () => {
        const app = createApp();
        const res = await request(app).get('/');
        headers = res.headers as Record<string, string>;
    });

    test('HSTS max-age is at least 2 years', () => {
        const hsts = headers['strict-transport-security'];
        expect(hsts).toBeDefined();
        const match = hsts.match(/max-age=(\d+)/);
        expect(match).toBeTruthy();
        // 2 years = 63,072,000 seconds
        expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(63_072_000);
    });

    test('HSTS includes subdomains but does NOT declare preload (reversibility)', () => {
        const hsts = headers['strict-transport-security'];
        expect(hsts).toContain('includeSubDomains');
        expect(hsts).not.toContain('preload');
    });

    test('Cross-Origin-Opener-Policy is env-gated via OMK_COOP_ENABLED', () => {
        // 2026-05-08 변경: HTTP/비-localhost origin 에서 브라우저가 COOP 를 무시하면서
        // 매 요청마다 untrustworthy-origin 경고 발생 → OMK_COOP_ENABLED=true 일 때만 송신.
        // 기본은 false (HTTPS 도입 전까지 비활성). HTTPS 환경에서 활성화하면 same-origin.
        const coopHeader = headers['cross-origin-opener-policy'];
        if (process.env.OMK_COOP_ENABLED === 'true') {
            expect(coopHeader).toBe('same-origin');
        } else {
            expect(coopHeader).toBeUndefined();
        }
    });

    test('X-Content-Type-Options: nosniff (helmet default) is present', () => {
        expect(headers['x-content-type-options']).toBe('nosniff');
    });

    test('Referrer-Policy is restrictive (no-referrer or same-origin family)', () => {
        const rp = headers['referrer-policy'];
        expect(rp).toBeDefined();
        expect(rp).toMatch(/no-referrer|same-origin|strict-origin/);
    });

    test('CSP is not emitted by the backend (moved to apps/web; legacy SPA serving removed)', () => {
        expect(headers['content-security-policy']).toBeUndefined();
    });
});
