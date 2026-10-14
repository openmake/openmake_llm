/**
 * Agent Task(자율 에이전트 작업) API 계약 E2E 테스트
 *
 * 검증 범위 — 모델(LLM)을 부르는 실행(POST /:taskId/execute)은 **포함하지 않는다**
 * (결정론이 아니고 비용이 든다). 생성 직후 상태에서 확인 가능한 계약만 본다.
 *  - 인증 게이트: 게스트는 생성·목록·상세·승인함에서 401/403
 *  - 스키마: 빈/너무 긴 goal, 잘못된 executor, 생성에 실린 approvalPolicy·미선언 키는 400
 *  - 생성 → 상세·스텝·목록, 소유권(다른 사용자 403/404)
 *  - 승인함: pending 목록, 없는 approvalId 승인·거절은 404
 *  - 취소(pending → cancelled)·재취소 400·삭제 뒤 상세 404
 *  - 장기 실행 게이트(AGENT_TASK_LONG_RUNNING): 서버 응답으로 켜짐/꺼짐을 판별해 분기
 *  - 체인 목록 권한(?chain=)
 *  - multipart 첨부 생성 → 상세 input_files 에 이름 노출(본문은 비노출)
 *
 * 실행:
 *   PW_TEST_BASE_URL=http://localhost:52418 npx playwright test tests/e2e/agent-task.spec.ts
 *   (DATABASE_URL 은 루트 .env 또는 환경 변수 — 사용자 정리용)
 *
 * 정리: spec 이 만든 작업·사용자만 **id 로** 지운다(작업은 DELETE API, 남으면 DB id 지정 삭제).
 * CSRF: 서버 기본값(enforce)에서도 돌도록 쿠키 인증 요청에 Double-Submit 토큰을 붙인다(agent-task-fixtures).
 */

import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import { deleteUser, pgConfig } from './helpers/gdpr-fixtures';
import { signupAgentTaskUser, guestCsrfHeaders, type AgentTaskUserFixture } from './helpers/agent-task-fixtures';

const BASE = '/api/agent-tasks';
const GOAL_MAX_CHARS = 20000; // AGENT_TASK_LIMITS.GOAL_MAX_CHARS 기본값(AGENT_TASK_GOAL_MAX_CHARS 미설정 환경)

// spec 이 만든 작업 id — afterAll 에서 이것만 지운다
const createdTaskIds = new Set<string>();

async function createTask(request: APIRequestContext, headers: Record<string, string>, data: Record<string, unknown>) {
    const res = await request.post(BASE, { headers, data });
    if (res.status() === 201 || res.status() === 200) {
        const body = await res.json();
        const id = body?.data?.task?.id;
        if (typeof id === 'string') createdTaskIds.add(id);
    }
    return res;
}

/** 작업 정리 — DELETE API 로 먼저, 실패하면 DB 에서 id 지정 삭제 */
async function cleanupTasks(request: APIRequestContext, headers: Record<string, string> | undefined): Promise<void> {
    const leftovers: string[] = [];
    for (const id of createdTaskIds) {
        const res = headers
            ? await request.delete(`${BASE}/${encodeURIComponent(id)}`, { headers })
            : null;
        // 이미 삭제(404)된 것은 정리 완료로 본다
        if (!res || (!res.ok() && res.status() !== 404)) leftovers.push(id);
    }
    createdTaskIds.clear();
    if (leftovers.length === 0) return;
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        await pg.query('DELETE FROM agent_tasks WHERE id = ANY($1::text[])', [leftovers]);
    } finally {
        await pg.end();
    }
}

// ============================================================
// 인증 게이트 (게스트 차단)
// ============================================================

test.describe('Agent Task API — 인증 게이트', () => {
    const probes: Array<{ method: 'GET' | 'POST'; path: string }> = [
        { method: 'POST', path: BASE },
        { method: 'GET', path: BASE },
        { method: 'GET', path: `${BASE}/00000000-0000-4000-8000-000000000000` },
        { method: 'GET', path: `${BASE}/approvals/pending` },
        { method: 'POST', path: `${BASE}/approvals/00000000-0000-4000-8000-000000000000/approve` },
    ];
    for (const p of probes) {
        test(`${p.method} ${p.path} — 게스트는 401`, async ({ request }, testInfo) => {
            // 유효한 CSRF 토큰을 붙여 CSRF 거절(403)이 아니라 인증 게이트 자체를 본다
            const res = p.method === 'POST'
                ? await request.post(p.path, {
                    headers: await guestCsrfHeaders(testInfo.project.use.baseURL),
                    data: { goal: '게스트 생성 시도' },
                })
                : await request.get(p.path);
            expect(res.status()).toBe(401);
            const body = await res.json();
            expect(body.success).toBe(false);
        });
    }
});

// ============================================================
// 인증 사용자 계약 — 두 사용자 픽스처(소유자·타인)
// ============================================================

test.describe.serial('Agent Task API — 인증 사용자 계약', () => {
    let owner: AgentTaskUserFixture | null = null;
    // 타인 — 소유권 시험 + 스키마 거절 시험. 생성 POST 는 사용자당 15분 10건(RL_AGENT_TASK_CREATE 기본값)이라
    // 400 시험을 소유자와 나눠 센다. 가입도 IP 당 15분 6건(RL_AUTH_REGISTER)이라 사용자는 둘만 만든다.
    let other: AgentTaskUserFixture | null = null;
    let taskId = '';
    const goal = `E2E agent-task 계약 확인용 목표 ${Date.now()}`;

    test.beforeAll(async ({}, testInfo) => {
        const baseURL = testInfo.project.use.baseURL;
        owner = await signupAgentTaskUser(baseURL);
        other = await signupAgentTaskUser(baseURL);
    });

    test.afterAll(async ({}, testInfo) => {
        // 정리 대상 id 를 남긴다 — 삭제 시험에서 이미 지운 작업(taskId)도 함께 표기
        console.log(`[agent-task e2e] 정리: 작업 ${[...createdTaskIds].join(', ') || '없음'} (삭제 시험 ${taskId || '없음'}), 사용자 ${owner?.userId ?? '-'}, ${other?.userId ?? '-'}`);
        const ctx = await pwRequest.newContext({ baseURL: testInfo.project.use.baseURL });
        try {
            await cleanupTasks(ctx, owner?.headers);
        } finally {
            await ctx.dispose();
        }
        if (owner) await deleteUser(owner.userId);
        if (other) await deleteUser(other.userId);
        owner = null;
        other = null;
    });

    // ---------------- 스키마 ----------------

    test('스키마 — 빈 goal 은 400', async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal: '' });
        expect(res.status()).toBe(400);
        expect((await res.json()).success).toBe(false);
    });

    test('스키마 — goal 누락은 400', async ({ request }) => {
        const res = await createTask(request, other!.headers, {});
        expect(res.status()).toBe(400);
    });

    test(`스키마 — ${GOAL_MAX_CHARS}자 초과 goal 은 400`, async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal: 'a'.repeat(GOAL_MAX_CHARS + 1) });
        expect(res.status()).toBe(400);
    });

    test('스키마 — 잘못된 executor 는 400', async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal, executor: 'cloud' });
        expect(res.status()).toBe(400);
    });

    test('스키마 — 생성에 실린 approvalPolicy 는 400(실행 단위 옵션)', async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal, approvalPolicy: 'none' });
        expect(res.status()).toBe(400);
        // 잘못된 enum 값도 같은 이유로 400
        const res2 = await createTask(request, other!.headers, { goal, approvalPolicy: 'bogus' });
        expect(res2.status()).toBe(400);
    });

    test('스키마 — 미선언 키(strict)는 400', async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal, maxTurn: 3 });
        expect(res.status()).toBe(400);
    });

    // ---------------- 생성 → 조회 ----------------

    test('생성 → 201, 응답에 작업 id·goal·status', async ({ request }) => {
        const res = await createTask(request, owner!.headers, { goal });
        expect(res.status()).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        const task = body.data.task;
        expect(typeof task.id).toBe('string');
        expect(task.goal).toBe(goal);
        expect(task.status).toBe('pending');
        expect(String(task.user_id)).toBe(owner!.userId);
        // 내부 운영 컬럼은 응답에서 제외된다
        expect(task).not.toHaveProperty('checkpoint');
        expect(task).not.toHaveProperty('create_idempotency_key');
        expect(Array.isArray(body.data.warnings)).toBe(true);
        taskId = task.id;
    });

    test('상세 — status pending, goal 일치, steps 빈 배열', async ({ request }) => {
        const res = await request.get(`${BASE}/${taskId}`, { headers: owner!.headers });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data.task.id).toBe(taskId);
        expect(body.data.task.status).toBe('pending');
        expect(body.data.task.goal).toBe(goal);
        expect(body.data.task.resumable).toBe(false);
        expect(body.data.steps).toEqual([]);
        // 체인이 아닌 작업은 chain 블록이 없다
        expect(body.data.task).not.toHaveProperty('chain');
    });

    test('스텝 — 빈 목록', async ({ request }) => {
        const res = await request.get(`${BASE}/${taskId}/steps`, { headers: owner!.headers });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data).toEqual({ steps: [], total: 0 });
    });

    test('목록 — 만든 작업이 들어 있다', async ({ request }) => {
        const res = await request.get(BASE, { headers: owner!.headers });
        expect(res.status()).toBe(200);
        const body = await res.json();
        const ids = (body.data.tasks as Array<{ id: string }>).map((t) => t.id);
        expect(ids).toContain(taskId);
        expect(body.data.total).toBe(body.data.tasks.length);
        // status 필터(부가 필터)도 같은 범위에서 동작
        const filtered = await request.get(`${BASE}?status=pending`, { headers: owner!.headers });
        const fIds = ((await filtered.json()).data.tasks as Array<{ id: string }>).map((t) => t.id);
        expect(fIds).toContain(taskId);
    });

    test('없는 작업 id 상세는 404', async ({ request }) => {
        const res = await request.get(`${BASE}/00000000-0000-4000-8000-000000000000`, { headers: owner!.headers });
        expect(res.status()).toBe(404);
    });

    // ---------------- 소유권 ----------------

    test('소유권 — 다른 사용자는 상세·스텝·취소·삭제에서 403/404', async ({ request }) => {
        const h = { headers: other!.headers };
        const detail = await request.get(`${BASE}/${taskId}`, h);
        expect([403, 404]).toContain(detail.status());
        const steps = await request.get(`${BASE}/${taskId}/steps`, h);
        expect([403, 404]).toContain(steps.status());
        const cancel = await request.post(`${BASE}/${taskId}/cancel`, h);
        expect([403, 404]).toContain(cancel.status());
        const del = await request.delete(`${BASE}/${taskId}`, h);
        expect([403, 404]).toContain(del.status());
        // 다른 사용자 목록에는 보이지 않는다
        const list = await request.get(BASE, h);
        const ids = ((await list.json()).data.tasks as Array<{ id: string }>).map((t) => t.id);
        expect(ids).not.toContain(taskId);
        // 소유자 쪽에서는 여전히 pending — 타인의 취소·삭제가 아무것도 바꾸지 않았다
        const still = await request.get(`${BASE}/${taskId}`, { headers: owner!.headers });
        expect((await still.json()).data.task.status).toBe('pending');
    });

    // ---------------- 승인함 ----------------

    test('승인함 — pending 목록에 이 작업의 승인이 없다', async ({ request }) => {
        const res = await request.get(`${BASE}/approvals/pending`, { headers: owner!.headers });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.data.pending)).toBe(true);
        const taskIds = (body.data.pending as Array<{ taskId?: string }>).map((p) => p.taskId);
        expect(taskIds).not.toContain(taskId);
    });

    test('승인함 — recent 는 200 에 decisions 배열', async ({ request }) => {
        const res = await request.get(`${BASE}/approvals/recent?minutes=5`, { headers: owner!.headers });
        expect(res.status()).toBe(200);
        expect(Array.isArray((await res.json()).data.decisions)).toBe(true);
    });

    test('승인함 — 없는 approvalId 승인·거절은 404, 잘못된 decision 은 400', async ({ request }) => {
        const h = { headers: owner!.headers };
        const missing = `e2e-missing-${Date.now()}`;
        const approve = await request.post(`${BASE}/approvals/${missing}/approve`, h);
        expect(approve.status()).toBe(404);
        const reject = await request.post(`${BASE}/approvals/${missing}/reject`, { ...h, data: { reason: 'e2e' } });
        expect(reject.status()).toBe(404);
        const bad = await request.post(`${BASE}/approvals/${missing}/maybe`, h);
        expect(bad.status()).toBe(400);
    });

    // ---------------- 체인 목록 권한 ----------------

    test('체인 목록 — 없는 id 404, 일반 작업 id 는 200·0건, 타인은 403', async ({ request }) => {
        const missing = await request.get(`${BASE}?chain=00000000-0000-4000-8000-000000000000`, { headers: owner!.headers });
        expect(missing.status()).toBe(404);
        expect((await missing.json()).success).toBe(false);

        // 장기 실행이 아닌 작업은 chain_root_task_id 가 없어 체인 세그먼트 목록이 비어 있다(listChain 계약)
        const mine = await request.get(`${BASE}?chain=${taskId}`, { headers: owner!.headers });
        expect(mine.status()).toBe(200);
        const mineBody = await mine.json();
        expect(mineBody.data).toEqual({ tasks: [], total: 0 });

        const others = await request.get(`${BASE}?chain=${taskId}`, { headers: other!.headers });
        expect(others.status()).toBe(403);
    });

    // ---------------- 취소·삭제 ----------------

    test('취소 — 실행 전 pending 작업은 cancelled, 다시 취소하면 400', async ({ request }) => {
        const h = { headers: owner!.headers };
        const res = await request.post(`${BASE}/${taskId}/cancel`, h);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data.taskId).toBe(taskId);

        const detail = await request.get(`${BASE}/${taskId}`, h);
        expect((await detail.json()).data.task.status).toBe('cancelled');

        const again = await request.post(`${BASE}/${taskId}/cancel`, h);
        expect(again.status()).toBe(400);
    });

    test('삭제 — 200 뒤 상세·스텝 404, 재삭제 404', async ({ request }) => {
        const h = { headers: owner!.headers };
        const res = await request.delete(`${BASE}/${taskId}`, h);
        expect(res.status()).toBe(200);
        expect((await res.json()).data.taskId).toBe(taskId);
        createdTaskIds.delete(taskId);

        expect((await request.get(`${BASE}/${taskId}`, h)).status()).toBe(404);
        expect((await request.get(`${BASE}/${taskId}/steps`, h)).status()).toBe(404);
        expect((await request.delete(`${BASE}/${taskId}`, h)).status()).toBe(404);
    });

    // ---------------- 장기 실행 게이트 ----------------

    test('장기 실행 — 게이트 꺼짐이면 400, 켜짐이면 기본 예산·체인 1건', async ({ request }) => {
        const h = { headers: owner!.headers };
        const res = await createTask(request, owner!.headers, { goal: `${goal} (장기 실행)`, longRunning: {} });
        const body = await res.json();

        if (res.status() === 400) {
            // 꺼짐 분기 — ValidationError 문구에 게이트 이름이 드러난다
            test.info().annotations.push({ type: 'long-running-gate', description: 'off' });
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('VALIDATION_ERROR');
            expect(body.error.message).toContain('AGENT_TASK_LONG_RUNNING');
            return;
        }

        // 켜짐 분기 — 루트는 자기 id 를 체인 루트로 갖고, 기본 예산이 상세에 보인다
        test.info().annotations.push({ type: 'long-running-gate', description: 'on' });
        expect(res.status()).toBe(201);
        const lrId: string = body.data.task.id;
        const detail = await (await request.get(`${BASE}/${lrId}`, h)).json();
        const lr = detail.data.task.long_running;
        expect(lr.maxDurationMs).toBeGreaterThan(0);
        expect(lr.maxTotalTokens).toBeGreaterThan(0);
        expect(lr.maxSegments).toBeGreaterThan(0);
        expect(detail.data.task.chain_root_task_id).toBe(lrId);
        expect(detail.data.task.chain.rootId).toBe(lrId);
        expect(detail.data.task.chain.segmentCount).toBe(1);

        const chain = await request.get(`${BASE}?chain=${lrId}`, h);
        expect(chain.status()).toBe(200);
        const chainBody = await chain.json();
        expect(chainBody.data.total).toBe(1);
        expect(chainBody.data.tasks[0].id).toBe(lrId);

        // 절대 상한을 넘는 요청은 켜짐 상태에서도 400
        const over = await createTask(request, owner!.headers, { goal: `${goal} (상한 초과)`, longRunning: { maxSegments: 100_000 } });
        expect(over.status()).toBe(400);
    });

    test('장기 실행 — longRunning 안의 미선언 키는 게이트와 무관하게 400', async ({ request }) => {
        const res = await createTask(request, other!.headers, { goal, longRunning: { forever: true } });
        expect(res.status()).toBe(400);
    });

    // ---------------- multipart 첨부 ----------------

    test('첨부 생성 — 텍스트 파일 1개 multipart → 상세 input_files 에 이름(본문 비노출)', async ({ request }) => {
        const fileName = `e2e-note-${Date.now()}.txt`;
        const res = await request.post(BASE, {
            headers: owner!.headers,
            multipart: {
                payload: JSON.stringify({ goal: `${goal} (첨부)` }),
                files: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from('첨부 본문 — e2e\nline2\n', 'utf8') },
            },
        });
        expect(res.status()).toBe(201);
        const created = await res.json();
        const attachId: string = created.data.task.id;
        createdTaskIds.add(attachId);

        const detail = await (await request.get(`${BASE}/${attachId}`, { headers: owner!.headers })).json();
        const files = detail.data.task.input_files as Array<Record<string, unknown>>;
        expect(files).toHaveLength(1);
        expect(files[0].name).toBe(fileName);
        expect(files[0].size).toBeGreaterThan(0);
        // 메타만 노출 — content/data/storedPath 는 응답에 없다
        expect(Object.keys(files[0]).sort()).toEqual(['name', 'size', 'type']);
    });

    test('첨부 생성 — payload 가 JSON 이 아니면 400', async ({ request }) => {
        const res = await request.post(BASE, {
            headers: owner!.headers,
            multipart: {
                payload: '{not json',
                files: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
            },
        });
        expect(res.status()).toBe(400);
    });
});
