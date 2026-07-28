/**
 * GDPR Phase B Fix 6 (B7) 동의 철회 E2E.
 *
 * 검증:
 *   - GET /api/users/me/consent 응답 (현재 동의 상태)
 *   - POST /api/users/me/consent/withdraw → granted=false 새 row INSERT
 *   - 철회 후 GET 조회 시 latest = granted=false 확인
 */
import { test, expect } from '@playwright/test';
import { signupUser, deleteUser, getConsentLogs } from './helpers/gdpr-fixtures';

test.describe.serial('GDPR consent withdrawal', () => {
    let userId: string | null = null;

    test.afterEach(async () => {
        if (userId) {
            await deleteUser(userId);
            userId = null;
        }
    });

    test('현재 동의 상태 조회 → 철회 → latest granted=false 확인', async ({ request }) => {
        const fixture = await signupUser(request);
        userId = fixture.userId;

        // 1. 현재 상태 조회 (privacy + terms 둘 다 granted=true)
        const statusRes = await request.get('/api/users/me/consent', {
            headers: { Cookie: fixture.cookies },
        });
        expect(statusRes.ok()).toBeTruthy();
        const status = await statusRes.json();
        expect(status.success).toBeTruthy();
        expect(status.data.consents).toHaveLength(2);
        const privacy = status.data.consents.find((c: { type: string }) => c.type === 'privacy_policy');
        expect(privacy.granted).toBe(true);

        // 2. privacy 철회
        const withdrawRes = await request.post('/api/users/me/consent/withdraw', {
            headers: { Cookie: fixture.cookies, 'Content-Type': 'application/json' },
            data: { type: 'privacy_policy' },
        });
        expect(withdrawRes.ok()).toBeTruthy();
        const withdraw = await withdrawRes.json();
        expect(withdraw.success).toBeTruthy();
        expect(withdraw.data.withdrawn).toBe(true);

        // 3. DB 직접 확인: latest privacy_policy row 의 granted=false
        const allLogs = await getConsentLogs(userId);
        const privacyRows = allLogs.filter(r => r.consent_type === 'privacy_policy');
        expect(privacyRows.length).toBe(2);  // 가입 시 1 + 철회 1
        const latest = privacyRows[privacyRows.length - 1];
        expect(latest.granted).toBe(false);

        // 4. terms 는 영향 없어야 (granted=true 유지)
        const termsRows = allLogs.filter(r => r.consent_type === 'terms_of_service');
        expect(termsRows.length).toBe(1);
        expect(termsRows[0].granted).toBe(true);

        // 5. 다시 GET /consent — 현재 privacy=false, terms=true
        const afterRes = await request.get('/api/users/me/consent', {
            headers: { Cookie: fixture.cookies },
        });
        const after = await afterRes.json();
        const pAfter = after.data.consents.find((c: { type: string }) => c.type === 'privacy_policy');
        const tAfter = after.data.consents.find((c: { type: string }) => c.type === 'terms_of_service');
        expect(pAfter.granted).toBe(false);
        expect(tAfter.granted).toBe(true);
    });

    test('invalid type → 400 validation fail', async ({ request }) => {
        // rate limit 회피 — sequential 모드에서 이전 test cleanup 후 잠시 대기
        await new Promise(r => setTimeout(r, 2000));
        const fixture = await signupUser(request);
        userId = fixture.userId;

        const res = await request.post('/api/users/me/consent/withdraw', {
            headers: { Cookie: fixture.cookies, 'Content-Type': 'application/json' },
            data: { type: 'invalid_type' },
        });
        expect(res.status()).toBe(400);
    });
});
