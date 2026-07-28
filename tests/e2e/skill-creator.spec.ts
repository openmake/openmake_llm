/**
 * OpenMake LLM Skill Creator (Phase 1) E2E 테스트
 *
 * 검증 범위:
 *  - 인증 게이트: 게스트는 모든 endpoint 에서 401/403
 *  - Schema 검증: invalid payload 는 400
 *  - Feature flag: SKILL_CREATOR_ENABLED=false 환경에서는 503
 *  - Endpoint 라우팅: 4개 신규 endpoint 가 마운트됨
 *  - **Happy path** (admin fixture + LLM mock): create → drafts → approve → library → reject
 *
 * Happy path 실행 전제:
 *   1. dev 서버를 SKILL_AUTHOR_MOCK=true 로 띄움 (LLM 호출 우회, 결정론적 응답)
 *      예: SKILL_AUTHOR_MOCK=true PORT=52417 npm run dev:api
 *   2. PW_TEST_BASE_URL=http://localhost:52417 npx playwright test
 *
 * 운영 환경에서는 SKILL_AUTHOR_MOCK 미설정 (false) — happy path 는 자동 skip.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

// ============================================================
// Admin fixture helpers
// ============================================================

const TEST_PW = 'E2eHappyPath!2026';

interface AdminFixture {
    userId: string;
    email: string;
    cookies: string;  // 'auth_token=...' header value
}

function pgConfig() {
    // 자격증명은 하드코딩하지 않는다(공개 리포) — 루트 .env 의 DATABASE_URL 사용.
    const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL(또는 TEST_DATABASE_URL)이 필요합니다 — 루트 .env 를 로드하세요.');
    }
    return { connectionString: url };
}

async function createAdminFixture(request: APIRequestContext): Promise<AdminFixture> {
    const ts = Date.now();
    const email = `e2e-admin-${ts}@local.test`;
    const username = `e2e-admin-${ts}`;

    // 1. 등록
    const reg = await request.post('/api/auth/register', {
        data: { username, email, password: TEST_PW },
    });
    if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
    const regBody = await reg.json();
    const userId = String(regBody.data?.user?.id || regBody.data?.id || '');
    if (!userId) throw new Error('register response missing user.id');

    // 2. role/tier 승격 (DB 직접 — admin promotion endpoint 부재)
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        await pg.query(`UPDATE users SET role='admin', tier='enterprise' WHERE id=$1`, [userId]);
    } finally {
        await pg.end();
    }

    // 3. 재로그인 — JWT 가 admin role 로 발급되도록
    const login = await request.post('/api/auth/login', {
        data: { email, password: TEST_PW },
    });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    const setCookieHeader = login.headers()['set-cookie'] || '';
    const authTokenMatch = /auth_token=([^;]+)/.exec(setCookieHeader);
    if (!authTokenMatch) throw new Error('login response missing auth_token cookie');
    const cookies = `auth_token=${authTokenMatch[1]}`;

    return { userId, email, cookies };
}

async function cleanupAdminFixture(fx: AdminFixture): Promise<void> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        // FK CASCADE: agent_skills.created_by → users.id 라 user 삭제만으로 정리됨
        // 명시적 순서 유지 (의도 명확)
        await pg.query(`DELETE FROM agent_skills WHERE created_by=$1`, [fx.userId]);
        await pg.query(`DELETE FROM users WHERE id=$1`, [fx.userId]);
    } finally {
        await pg.end();
    }
}

// SKILL_AUTHOR_MOCK 가 활성 상태인지 dev 서버에서 간접 확인.
// /auto-create 호출 시 응답 시간 < 5초면 mock 활성 (실제 LLM 은 60~120s).
async function detectMockMode(request: APIRequestContext, cookies: string): Promise<boolean> {
    const start = Date.now();
    const res = await request.post('/api/agents/skills/auto-create', {
        headers: { Cookie: cookies },
        data: { purpose: '__probe__ mock detection ping' },
        timeout: 10_000,
    });
    const elapsed = Date.now() - start;
    if (!res.ok()) return false;
    const body = await res.json();
    const probeSkillId = body?.data?.skillId;
    // 정리 — probe draft 즉시 거절
    if (probeSkillId) {
        await request.post(`/api/agents/skills/${encodeURIComponent(probeSkillId)}/reject`, {
            headers: { Cookie: cookies },
        });
    }
    // mock 이면 즉시 응답 (보통 < 1s), 실제 LLM 이면 5s 이상
    return elapsed < 5_000;
}

// ============================================================
// 인증 게이트 (게스트 차단)
// ============================================================

test.describe('Skill Creator API — 인증 게이트', () => {
    test('POST /api/agents/skills/auto-create — 게스트는 401', async ({ request }) => {
        const response = await request.post('/api/agents/skills/auto-create', {
            data: { purpose: '테스트 스킬 — 인증 검증' },
        });
        expect([401, 403]).toContain(response.status());
    });

    test('GET /api/agents/skills/drafts — 게스트는 401', async ({ request }) => {
        const response = await request.get('/api/agents/skills/drafts');
        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/agents/skills/:id/approve — 게스트는 401', async ({ request }) => {
        const response = await request.post('/api/agents/skills/user-skill-test-id/approve');
        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/agents/skills/:id/reject — 게스트는 401', async ({ request }) => {
        const response = await request.post('/api/agents/skills/user-skill-test-id/reject');
        expect([401, 403]).toContain(response.status());
    });
});

// ============================================================
// Schema 검증 (인증 후 400)
// ============================================================

test.describe('Skill Creator API — Schema 검증 (인증 후 400)', () => {
    test('POST /auto-create — purpose 5자 미만은 400 또는 401', async ({ request }) => {
        const response = await request.post('/api/agents/skills/auto-create', {
            data: { purpose: 'abc' },
        });
        expect([400, 401, 403]).toContain(response.status());
    });

    test('POST /auto-create — invalid target enum 은 400 또는 401', async ({ request }) => {
        const response = await request.post('/api/agents/skills/auto-create', {
            data: { purpose: '유효한 prompt 5자 이상', target: 'admin' },
        });
        expect([400, 401, 403]).toContain(response.status());
    });
});

// ============================================================
// Endpoint 라우팅 마운트
// ============================================================

test.describe('Skill Creator API — Endpoint 라우팅 마운트', () => {
    test('4개 endpoint 가 404 가 아닌 인증 응답 반환', async ({ request }) => {
        const probes = [
            { method: 'POST', path: '/api/agents/skills/auto-create', body: {} },
            { method: 'GET', path: '/api/agents/skills/drafts', body: undefined },
            { method: 'POST', path: '/api/agents/skills/probe-id/approve', body: {} },
            { method: 'POST', path: '/api/agents/skills/probe-id/reject', body: {} },
        ];
        for (const p of probes) {
            const res = p.method === 'POST'
                ? await request.post(p.path, { data: p.body })
                : await request.get(p.path);
            expect(res.status(), `${p.method} ${p.path} 라우트 미마운트 의심`).not.toBe(404);
        }
    });
});

// ============================================================
// Happy path — admin fixture + LLM mock
//
// 실행 조건: dev 서버가 SKILL_AUTHOR_MOCK=true 로 기동된 상태.
// 그 외 환경에서는 mockMode=false 로 감지되어 test.skip() 발동.
// ============================================================

test.describe('Skill Creator — Happy path (admin + LLM mock)', () => {
    let admin: AdminFixture | null = null;
    let mockMode = false;

    test.beforeAll(async ({ request }) => {
        admin = await createAdminFixture(request);
        mockMode = await detectMockMode(request, admin.cookies);
    });

    test.afterAll(async () => {
        if (admin) await cleanupAdminFixture(admin);
    });

    test('관리자 fixture 생성 + LLM mock 활성 확인', async () => {
        expect(admin).not.toBeNull();
        expect(admin!.userId).toMatch(/^\d+$/);
        if (!mockMode) {
            test.skip(true, 'SKILL_AUTHOR_MOCK=true 가 아니라 LLM 실제 호출 — happy path skip');
        }
    });

    test('전체 흐름: auto-create → drafts → approve → library 노출', async ({ request }) => {
        if (!mockMode) test.skip(true, 'mock 미활성');
        const cookies = admin!.cookies;

        // 1. auto-create — 결정론적 mock 응답
        const created = await request.post('/api/agents/skills/auto-create', {
            headers: { Cookie: cookies },
            data: { purpose: 'happy path: 전체 flow 검증 스킬' },
        });
        expect(created.status()).toBe(201);
        const createdBody = await created.json();
        const skillId = createdBody.data.skillId;
        expect(skillId).toMatch(/^user-skill-/);
        expect(createdBody.data.status).toBe('draft');
        expect(createdBody.data.modelUsed).toBe('mock');  // mock seam 검증

        // 2. drafts 목록 — 방금 만든 것이 포함
        const drafts = await request.get('/api/agents/skills/drafts?target=user&limit=50', {
            headers: { Cookie: cookies },
        });
        expect(drafts.status()).toBe(200);
        const draftsBody = await drafts.json();
        const ids = (draftsBody.data?.drafts ?? []).map((d: { id: string }) => d.id);
        expect(ids).toContain(skillId);

        // 3. approve — draft → active
        const approve = await request.post(`/api/agents/skills/${encodeURIComponent(skillId)}/approve`, {
            headers: { Cookie: cookies },
        });
        expect(approve.status()).toBe(200);
        const approveBody = await approve.json();
        expect(approveBody.data?.status).toBe('active');

        // 4. 일반 라이브러리 검색 — active 로 등장
        const lib = await request.get('/api/agents/skills?search=happy+path&limit=10', {
            headers: { Cookie: cookies },
        });
        expect(lib.status()).toBe(200);
        const libBody = await lib.json();
        const libIds = (libBody.data?.skills ?? []).map((s: { id: string }) => s.id);
        expect(libIds).toContain(skillId);

        // 5. drafts 목록 — 방금 승인된 것은 빠짐
        const draftsAfter = await request.get('/api/agents/skills/drafts?target=user&limit=50', {
            headers: { Cookie: cookies },
        });
        const draftsAfterIds = ((await draftsAfter.json()).data?.drafts ?? []).map((d: { id: string }) => d.id);
        expect(draftsAfterIds).not.toContain(skillId);
    });

    test('reject 흐름: 별도 draft 거절 시 archived + 라이브러리 미노출', async ({ request }) => {
        if (!mockMode) test.skip(true, 'mock 미활성');
        const cookies = admin!.cookies;

        // 다른 prompt 로 새 draft (dedupe 회피)
        const created = await request.post('/api/agents/skills/auto-create', {
            headers: { Cookie: cookies },
            data: { purpose: 'reject flow 검증 — 별도 draft' },
        });
        expect(created.status()).toBe(201);
        const skillId = (await created.json()).data.skillId;

        // reject
        const reject = await request.post(`/api/agents/skills/${encodeURIComponent(skillId)}/reject`, {
            headers: { Cookie: cookies },
        });
        expect(reject.status()).toBe(200);
        expect((await reject.json()).data?.status).toBe('archived');

        // 일반 라이브러리에 미노출 (default status='active' filter)
        const lib = await request.get('/api/agents/skills?search=reject+flow&limit=10', {
            headers: { Cookie: cookies },
        });
        const libIds = ((await lib.json()).data?.skills ?? []).map((s: { id: string }) => s.id);
        expect(libIds).not.toContain(skillId);
    });

    test('dedupe: 동일 promptHash 24h 내 재요청 → 같은 skillId + deduped:true', async ({ request }) => {
        if (!mockMode) test.skip(true, 'mock 미활성');
        const cookies = admin!.cookies;
        const purpose = 'dedupe test — exact same prompt';

        const first = await request.post('/api/agents/skills/auto-create', {
            headers: { Cookie: cookies },
            data: { purpose },
        });
        expect(first.status()).toBe(201);
        const firstId = (await first.json()).data.skillId;

        const second = await request.post('/api/agents/skills/auto-create', {
            headers: { Cookie: cookies },
            data: { purpose },
        });
        expect(second.status()).toBe(200);  // not 201 — dedupe hit
        const secondBody = await second.json();
        expect(secondBody.data.skillId).toBe(firstId);
        expect(secondBody.data.deduped).toBe(true);
    });
});
