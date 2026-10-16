/**
 * GDPR E2E 공통 helper — signup / login / db cleanup.
 *
 * Phase A+B/C 의 4 시나리오 (signup / withdraw / reconsent / export) 가 공유.
 * 패턴: skill-creator.spec.ts 의 createAdminFixture 차용 + consent 필드 추가.
 */
import { type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

export const TEST_PW = 'GdprE2E!2026';

export interface GdprUserFixture {
    userId: string;
    email: string;
    username: string;
    cookies: string;  // 'auth_token=...' header value
}

/**
 * e2e DB 접속 정보 — 자격증명은 **하드코딩하지 않는다**(공개 리포).
 * `TEST_DATABASE_URL`(tests/e2e/.env.e2e 또는 셸)만 쓰고, DB 이름이 `_test` 로 끝나야 한다.
 * 개발 DB(`DATABASE_URL`)로 대체하지 않는다 — 픽스처가 사용자를 만들고 지우므로 격리 DB 에서만 돈다.
 */
export function pgConfig(): { connectionString: string } {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error('TEST_DATABASE_URL 이 없다 — tests/e2e/.env.e2e 에 이름이 _test 로 끝나는 격리 DB 를 지정한다(DATABASE_URL 로 대체하지 않는다)');
    }
    const dbName = new URL(url).pathname.replace(/^\//, '');
    if (!dbName.endsWith('_test')) {
        throw new Error(`TEST_DATABASE_URL 의 DB 이름(${dbName})이 _test 로 끝나지 않는다 — 격리 DB 가 아니면 돌리지 않는다`);
    }
    return { connectionString: url };
}

/**
 * 신규 사용자 가입 — Phase A 의 agreedToTerms/Privacy 필수.
 * unique timestamp + random suffix 로 격리.
 */
export async function signupUser(
    request: APIRequestContext,
    opts: { promoteAdmin?: boolean; birthDate?: string } = {},
): Promise<GdprUserFixture> {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 10000);
    const email = `e2e-gdpr-${ts}-${rand}@local.test`;
    const username = `e2e-gdpr-${ts}-${rand}`;
    // Phase D (PR #80) — birthDate required. Default = 30년 전 (성인 — locale 무관)
    const birthDate = opts.birthDate || (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 30);
        return d.toISOString().slice(0, 10);
    })();

    const reg = await request.post('/api/auth/register', {
        data: {
            username, email, password: TEST_PW,
            agreedToTerms: true,
            agreedToPrivacy: true,
            consentLocale: 'ko',
            birthDate,
        },
    });
    if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
    const regBody = await reg.json();
    const userId = String(regBody.data?.user?.id || regBody.data?.id || '');
    if (!userId) throw new Error('register response missing user.id');

    if (opts.promoteAdmin) {
        const pg = new Client(pgConfig());
        await pg.connect();
        try {
            // users.tier 는 마이그레이션 039 가 지웠다 — 역할만 바꾼다
            await pg.query(`UPDATE users SET role='admin' WHERE id=$1`, [userId]);
        } finally {
            await pg.end();
        }
    }

    const login = await request.post('/api/auth/login', {
        data: { email, password: TEST_PW },
    });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    const setCookieHeader = login.headers()['set-cookie'] || '';
    const authTokenMatch = /auth_token=([^;]+)/.exec(setCookieHeader);
    if (!authTokenMatch) throw new Error('login response missing auth_token cookie');
    const cookies = `auth_token=${authTokenMatch[1]}`;

    return { userId, email, username, cookies };
}

/**
 * 사용자 cleanup — CASCADE 가 consent_logs 등 자동 정리.
 */
export async function deleteUser(userId: string): Promise<void> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        await pg.query('DELETE FROM users WHERE id = $1', [userId]);
    } finally {
        await pg.end();
    }
}

/**
 * consent_logs 직접 조회 — DB 검증용.
 */
export async function getConsentLogs(userId: string): Promise<Array<{
    consent_type: string; consent_version: string; granted: boolean; granted_at: Date;
}>> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        const r = await pg.query(
            `SELECT consent_type, consent_version, granted, granted_at
             FROM consent_logs
             WHERE user_id = $1
             ORDER BY granted_at ASC`,
            [userId],
        );
        return r.rows;
    } finally {
        await pg.end();
    }
}

/**
 * 시나리오 3 (reconsent) 용 — 사용자에 옛 version consent INSERT 직접 (옵션 C).
 */
export async function seedOldConsent(
    userId: string,
    oldVersion: string = '0.9',
): Promise<void> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        // 기존 신규 가입 consent 보다 더 늦은 시점 (NOW) 으로 INSERT — latest 가 됨
        // 단 version 은 옛것이라 needsConsent=true
        await pg.query(
            `INSERT INTO consent_logs (user_id, consent_type, consent_version, consent_locale, granted, ip_address, user_agent)
             VALUES ($1, 'privacy_policy', $2, 'ko', TRUE, '127.0.0.1', 'e2e-seed'),
                    ($1, 'terms_of_service', $2, 'ko', TRUE, '127.0.0.1', 'e2e-seed')`,
            [userId, oldVersion],
        );
        // 위 가입 시점 consent 들의 granted_at 을 더 과거로 옮겨 latest 가 seed row 가 되게
        await pg.query(
            `UPDATE consent_logs SET granted_at = NOW() - INTERVAL '1 minute'
             WHERE user_id = $1 AND user_agent IS DISTINCT FROM 'e2e-seed'`,
            [userId],
        );
    } finally {
        await pg.end();
    }
}
