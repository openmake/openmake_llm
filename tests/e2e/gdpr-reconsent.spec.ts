/**
 * GDPR Phase B Fix 7 재동의 prompt E2E (옵션 C — DB INSERT 직접 조작).
 *
 * 시나리오:
 *   1. 신규 가입 (latest version='1.0' granted=true 2 row)
 *   2. DB 에 옛 version 의 latest row INSERT (seedOldConsent helper) — needsConsent trigger
 *   3. GET /api/users/me/consent/status → needsConsent=true 확인
 *   4. POST /api/users/me/consent (재동의) → latest version='1.0' granted=true 새 row INSERT
 *   5. 재조회: needsConsent=false
 *
 * CURRENT_POLICY_VERSION (config/policy.ts) 자체는 안 건드림 — DB seed 만으로 trigger.
 */
import { test, expect } from '@playwright/test';
import { signupUser, deleteUser, seedOldConsent, getConsentLogs } from './helpers/gdpr-fixtures';

test.describe('GDPR reconsent prompt', () => {
    let userId: string | null = null;

    test.afterEach(async () => {
        if (userId) {
            await deleteUser(userId);
            userId = null;
        }
    });

    test('옛 version → needsConsent=true → 재동의 → needsConsent=false', async ({ request }) => {
        // 1. 신규 가입 (v1.0 consent 2 row)
        const fixture = await signupUser(request);
        userId = fixture.userId;

        // 2. seed: 옛 version '0.9' INSERT, 기존 가입 row 는 더 과거로 옮김
        await seedOldConsent(userId, '0.9');

        // 3. status — needsConsent=true 확인
        const statusRes = await request.get('/api/users/me/consent/status', {
            headers: { Cookie: fixture.cookies },
        });
        expect(statusRes.ok()).toBeTruthy();
        const status = await statusRes.json();
        expect(status.success).toBeTruthy();
        expect(status.data.needsConsent).toBe(true);
        expect(status.data.currentVersion).toBe('1.0');
        expect(status.data.pendingTypes.sort()).toEqual(['privacy_policy', 'terms_of_service']);

        // 4. 재동의 — privacy + terms 각각 POST
        for (const type of ['privacy_policy', 'terms_of_service']) {
            const grantRes = await request.post('/api/users/me/consent', {
                headers: { Cookie: fixture.cookies, 'Content-Type': 'application/json' },
                data: { type, version: '1.0', locale: 'ko' },
            });
            expect(grantRes.ok()).toBeTruthy();
            const grant = await grantRes.json();
            expect(grant.success).toBeTruthy();
            expect(grant.data.granted).toBe(true);
        }

        // 5. status 재조회 — needsConsent=false
        const afterRes = await request.get('/api/users/me/consent/status', {
            headers: { Cookie: fixture.cookies },
        });
        const after = await afterRes.json();
        expect(after.data.needsConsent).toBe(false);
        expect(after.data.pendingTypes).toEqual([]);

        // 6. DB 검증: 각 type 의 최신 row 가 version='1.0' granted=true
        const logs = await getConsentLogs(userId);
        const privacyLatest = logs.filter(l => l.consent_type === 'privacy_policy').pop();
        const termsLatest = logs.filter(l => l.consent_type === 'terms_of_service').pop();
        expect(privacyLatest?.consent_version).toBe('1.0');
        expect(privacyLatest?.granted).toBe(true);
        expect(termsLatest?.consent_version).toBe('1.0');
        expect(termsLatest?.granted).toBe(true);
    });

    test('current version 동의 상태면 needsConsent=false', async ({ request }) => {
        const fixture = await signupUser(request);
        userId = fixture.userId;
        // seed 안 함 — 가입 직후 상태 그대로
        const statusRes = await request.get('/api/users/me/consent/status', {
            headers: { Cookie: fixture.cookies },
        });
        const status = await statusRes.json();
        expect(status.data.needsConsent).toBe(false);
    });
});
