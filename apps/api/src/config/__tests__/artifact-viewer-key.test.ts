/** 아티팩트 뷰어 서명 키 분리 (2026-10-25 보안점검 W9) — 키 미설정 시 JWT_SECRET 을 그대로 쓰지 않고 파생한다. */
const ENV_KEYS = ['ARTIFACT_VIEWER_SIGNING_KEY', 'JWT_SECRET'] as const;
const ORIG: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIG[k] = process.env[k];
afterEach(() => {
    for (const k of ENV_KEYS) { if (ORIG[k] === undefined) delete process.env[k]; else process.env[k] = ORIG[k]; }
});

function loadSigningKey(env: { ARTIFACT_VIEWER_SIGNING_KEY?: string; JWT_SECRET?: string }): string {
    for (const k of ENV_KEYS) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    let key = '';
    jest.isolateModules(() => { key = require('../artifact-viewer').ARTIFACT_VIEWER.signingKey; });
    return key;
}

describe('ARTIFACT_VIEWER.signingKey', () => {
    const secret = 'test-jwt-secret-value-for-derivation-0123456789';

    it('키 미설정 시 JWT_SECRET 과 다른 64자리 hex 키를 쓴다', () => {
        const key = loadSigningKey({ JWT_SECRET: secret });
        expect(key).not.toBe(secret);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('같은 JWT_SECRET 이면 같은 키(재기동·다중 프로세스에서 토큰 검증 유지), 다르면 다른 키', () => {
        const a = loadSigningKey({ JWT_SECRET: secret });
        const b = loadSigningKey({ JWT_SECRET: secret });
        const c = loadSigningKey({ JWT_SECRET: `${secret}-other` });
        expect(a).toBe(b);
        expect(c).not.toBe(a);
    });

    it('ARTIFACT_VIEWER_SIGNING_KEY 가 있으면 그것을 쓴다', () => {
        expect(loadSigningKey({ ARTIFACT_VIEWER_SIGNING_KEY: 'explicit-viewer-key', JWT_SECRET: secret })).toBe('explicit-viewer-key');
    });

    it('둘 다 없으면 빈 키 — 서비스의 fail-closed 가드가 발급·검증을 거부하게 둔다', () => {
        expect(loadSigningKey({})).toBe('');
    });
});
