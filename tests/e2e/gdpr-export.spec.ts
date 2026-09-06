/**
 * GDPR Phase B Fix 6 (B6) 데이터 export E2E.
 *
 * 시나리오:
 *   1. 신규 가입
 *   2. GET /api/users/me/export → Content-Disposition attachment + JSON body
 *   3. JSON parse → 5 카테고리 (conversationSessions/skillManifests/agentSkills/customAgents/userMemories)
 *      + _meta.counts 검증
 *   4. RL_GDPR_EXPORT: 시간당 free=2 — 3번째 호출 429 확인
 */
import { test, expect } from '@playwright/test';
import { signupUser, deleteUser } from './helpers/gdpr-fixtures';

test.describe('GDPR data export (Article 20)', () => {
    let userId: string | null = null;

    test.afterEach(async () => {
        if (userId) {
            await deleteUser(userId);
            userId = null;
        }
    });

    test('export endpoint → JSON 5 카테고리 + _meta.counts', async ({ request }) => {
        const fixture = await signupUser(request);
        userId = fixture.userId;

        const res = await request.get('/api/users/me/export', {
            headers: { Cookie: fixture.cookies },
        });
        expect(res.ok()).toBeTruthy();

        // Content-Disposition: attachment 헤더
        const disposition = res.headers()['content-disposition'] || '';
        expect(disposition).toContain('attachment');
        expect(disposition).toMatch(/openmake_full_export_/);

        // JSON parse
        const json = await res.json();
        expect(json).toHaveProperty('timestamp');
        expect(json).toHaveProperty('version');
        expect(json).toHaveProperty('user');
        expect(json).toHaveProperty('conversationSessions');
        expect(json).toHaveProperty('skillManifests');
        expect(json).toHaveProperty('agentSkills');
        expect(json).toHaveProperty('customAgents');
        expect(json).toHaveProperty('userMemories');
        expect(json).toHaveProperty('_meta');
        expect(json._meta).toHaveProperty('counts');

        // 5 카테고리 모두 array
        expect(Array.isArray(json.conversationSessions)).toBe(true);
        expect(Array.isArray(json.skillManifests)).toBe(true);
        expect(Array.isArray(json.agentSkills)).toBe(true);
        expect(Array.isArray(json.customAgents)).toBe(true);
        expect(Array.isArray(json.userMemories)).toBe(true);

        // user 정보 정확성
        expect(json.user?.id).toBe(userId);
        expect(json.user?.email).toBe(fixture.email);

        // _meta.counts 일치
        expect(json._meta.counts.conversationSessions).toBe(json.conversationSessions.length);
        expect(json._meta.counts.skillManifests).toBe(json.skillManifests.length);
        expect(json._meta.counts.userMemories).toBe(json.userMemories.length);
        // 조회 실패가 빈 배열로 위장되지 않는지 — 2026-09-07 전까지 user_memories 가 넉 달간 조용히 실패했다.
        expect(json._meta.failedCategories).toEqual([]);
        expect(json._meta.partial).toBe(false);
    });

    test('RL_GDPR_EXPORT free=2 → 3번째 429', async ({ request }) => {
        // dev server 가 RL_EXPORT_FREE 를 1000 같은 큰 값으로 override 한 경우 skip.
        // production 또는 default 2 환경에서만 정확히 검증.
        const limit = parseInt(process.env.RL_EXPORT_FREE_OVERRIDE || '2', 10);
        if (limit > 10) {
            test.skip(true, 'RL_EXPORT_FREE override 환경에서는 검증 skip — production 별도 verify');
            return;
        }
        const fixture = await signupUser(request);
        userId = fixture.userId;

        const res1 = await request.get('/api/users/me/export', { headers: { Cookie: fixture.cookies } });
        expect(res1.ok()).toBeTruthy();
        const res2 = await request.get('/api/users/me/export', { headers: { Cookie: fixture.cookies } });
        expect(res2.ok()).toBeTruthy();
        const res3 = await request.get('/api/users/me/export', { headers: { Cookie: fixture.cookies } });
        expect(res3.status()).toBe(429);
    });
});
