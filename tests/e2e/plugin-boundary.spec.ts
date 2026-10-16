/**
 * Add-on 경계 e2e — Knowledge add-on 을 켜고 끄며 실제 HTTP·WS 경로가 같은 판정을 따르는지 본다.
 *
 * 대상: 격리 테스트 DB 에 붙인 e2e 전용 API(runbook 부록 B — :52438,
 *       USER_MEMORY_AUTO_EXTRACT=true, ORG_CONTEXT_CACHE_TTL_MS=1000). 개발 스택을 대상으로 돌리지 않는다
 *       (토글이 개발 DB 의 add-on 의도를 바꾼다).
 *   E2E_BASE_URL=http://localhost:52438 npx playwright test tests/e2e/plugin-boundary.spec.ts --project=chromium
 *
 * 기여 도구 거절 문구 자체는 모델이 그 도구를 부를 때만 나와 e2e 로 결정적으로 만들 수 없다 —
 * 문구는 Jest(services/chat-service/__tests__/orchestration-gate.test.ts)가 고정하고, 여기서는
 * 턴이 시간 안에 끝났는지와, 턴 이벤트에 그 add-on 이름이 나오면 반드시 거절 문구여야 한다는 것을 본다.
 * 끝나면 afterAll 이 Knowledge 를 enabled 로 되돌리고, DB 가 enabled 가 아니면 실패로 던진다.
 */
import { test, expect } from '@playwright/test';
import { deleteUser } from './helpers/gdpr-fixtures';
import {
    KNOWLEDGE_ID, e2eBaseUrl, e2eWsOrigin, signupBoundaryUser, patchKnowledgeState,
    setInstallationStateInDb, readInstallationState, readDesiredState, waitForDocumentReady, countMemoriesContaining,
    createOrgWithAllowlist, deleteOrg, runWsTurn, knowledgeSources, forceEnabledInDb,
    type BoundaryUser, type WsTurnResult,
} from './helpers/plugin-boundary-fixtures';

test.describe.configure({ mode: 'serial' });

const BASE = e2eBaseUrl();
const ORIGIN = e2eWsOrigin();
const MARKER = `PB${Date.now()}`;
const WS_TURN_TIMEOUT_MS = 90_000;
const MEMORY_WAIT_MS = 10_000;
/** DB 를 직접 바꾼 상태가 라우트에 보일 때까지 — 대상 API 의 add-on 상태 캐시(기본 30초)보다 길게 */
const STATE_CACHE_WAIT_MS = 40_000;

/** 토글 응답 data — C1 계약 */
interface ToggleData {
    runtime: 'stopped' | 'resumed' | 'restart_required' | 'unchanged' | 'not_loaded';
    restartRequired: boolean;
}

let admin: BoundaryUser | undefined;
let member: BoundaryUser | undefined;
let spaceId = '';
let boundSessionId = '';
let plainSessionId = '';
let orgId = '';
let disabledTurn: WsTurnResult | null = null;

function adminUser(): BoundaryUser {
    if (!admin) throw new Error('beforeAll 에서 관리자 가입이 끝나지 않았다');
    return admin;
}

function memberUser(): BoundaryUser {
    if (!member) throw new Error('beforeAll 에서 일반 사용자 가입이 끝나지 않았다');
    return member;
}

async function errorCode(res: { json(): Promise<unknown> }): Promise<string | undefined> {
    const body = (await res.json()) as { error?: { code?: string } };
    return body.error?.code;
}

async function toggleData(res: { json(): Promise<unknown> }): Promise<ToggleData> {
    return ((await res.json()) as { data: ToggleData }).data;
}

test.beforeAll(async () => {
    admin = await signupBoundaryUser(BASE, { admin: true });
    member = await signupBoundaryUser(BASE);
});

test.afterAll(async ({ request }) => {
    // 각 정리 단계는 따로 잡아 오류를 모으고 다음 단계를 계속한다. Knowledge 상태 확인은 언제나 마지막에 한다.
    const errors: string[] = [];
    const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
        try {
            await fn();
        } catch (err) {
            errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    await step('Knowledge 복원', async () => {
        let restored = false;
        if (admin) {
            try {
                const res = await patchKnowledgeState(request, admin, 'enabled');
                if (res.ok()) {
                    const data = await toggleData(res);
                    if (data.runtime === 'resumed' || data.runtime === 'unchanged') restored = true;
                    else errors.push(`Knowledge 복원: 토글 응답 runtime=${data.runtime}(resumed·unchanged 아님) — 런타임이 멈춰 있을 수 있다`);
                } else {
                    errors.push(`Knowledge 복원: 토글 응답 ${res.status()}`);
                }
            } catch (err) {
                errors.push(`Knowledge 복원: 토글 요청 실패 ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // 토글이 2xx 가 아니거나 요청 자체가 실패하면 DB 로 의도·상태를 되돌린다(관리자 가입 전 실패 포함)
        if (!restored) await forceEnabledInDb();
    });
    if (admin) {
        const a = admin;
        if (spaceId) await step('Space 삭제', async () => { await request.delete(`/api/knowledge/spaces/${spaceId}`, { headers: a.headers }); });
        if (plainSessionId) await step('일반 대화 삭제', async () => { await request.delete(`/api/chat/sessions/${plainSessionId}`, { headers: a.headers }); });
    }
    if (orgId) await step('조직 삭제', () => deleteOrg(orgId));
    if (admin) { const id = admin.userId; await step('관리자 삭제', () => deleteUser(id)); }
    if (member) { const id = member.userId; await step('일반 사용자 삭제', () => deleteUser(id)); }

    await step('Knowledge 상태 확인', async () => {
        const state = await readInstallationState();
        const desired = await readDesiredState();
        if (state !== 'enabled' || desired !== 'enabled') {
            errors.push(`정리 뒤 Knowledge 가 enabled 가 아니다: state=${state} desired_state=${desired}`);
        }
    });
    if (errors.length) throw new Error(`afterAll 정리 오류 ${errors.length}건:\n${errors.join('\n')}`);
});

test('준비: enabled 에서 Space·문서·연결 대화·일반 대화를 만든다', async ({ request }) => {
    test.setTimeout(120_000);
    const a = adminUser();
    expect(await readInstallationState()).toBe('enabled');
    const space = await request.post('/api/knowledge/spaces', { headers: a.headers, data: { name: `pb-${MARKER}` } });
    expect(space.status()).toBe(201);
    spaceId = ((await space.json()) as { data: { space: { id: string } } }).data.space.id;

    const upload = await request.post(`/api/knowledge/spaces/${spaceId}/documents`, {
        headers: a.headers,
        multipart: {
            file: { name: 'plugin-boundary.txt', mimeType: 'text/plain', buffer: Buffer.from(`플러그인 경계 시험 문서. 이 프로젝트의 비밀 코드명은 ${MARKER} 이다.\n`) },
        },
    });
    expect(upload.ok()).toBe(true);
    expect(await waitForDocumentReady(spaceId, 90_000)).toBe('ready');

    const bound = await request.post(`/api/knowledge/spaces/${spaceId}/conversations`, { headers: a.headers });
    expect(bound.status()).toBe(201);
    boundSessionId = ((await bound.json()) as { data: { sessionId: string } }).data.sessionId;

    const plain = await request.post('/api/chat/sessions', { headers: a.headers, data: { title: `pb-plain-${MARKER}` } });
    expect(plain.ok()).toBe(true);
    plainSessionId = ((await plain.json()) as { data: { session: { id: string } } }).data.session.id;
});

test('enabled(대조군): Space 연결 대화의 WS 턴은 Knowledge 출처를 받는다', async () => {
    test.setTimeout(WS_TURN_TIMEOUT_MS + 30_000);
    const turn = await runWsTurn(BASE, ORIGIN, adminUser().authToken, { message: `${MARKER} 코드명이 무엇인지 문서에서 찾아줘`, sessionId: boundSessionId }, WS_TURN_TIMEOUT_MS);
    expect(turn.ended).not.toBe('timeout');
    expect(knowledgeSources(turn.events, spaceId).length, '켜진 상태에서 출처가 없으면 이 환경으로는 끈 뒤의 "출처 없음" 을 판정할 수 없다').toBeGreaterThan(0);
});

test('토글: disabled 응답은 runtime=stopped·restartRequired=false, 바로 다음 라우트는 404 ADDON_DISABLED', async ({ request }) => {
    const a = adminUser();
    const res = await patchKnowledgeState(request, a, 'disabled');
    expect(res.status()).toBe(200);
    const data = await toggleData(res);
    expect(data.runtime).toBe('stopped');
    expect(data.restartRequired).toBe(false);

    const route = await request.get('/api/knowledge/spaces', { headers: a.headers });
    expect(route.status()).toBe(404);
    expect(await errorCode(route)).toBe('ADDON_DISABLED');
});

test('disabled: Space 연결 대화의 WS 턴에 Knowledge 출처가 없다', async () => {
    test.setTimeout(WS_TURN_TIMEOUT_MS + 30_000);
    disabledTurn = await runWsTurn(BASE, ORIGIN, adminUser().authToken, { message: `${MARKER} 코드명이 무엇인지 문서에서 찾아줘`, sessionId: boundSessionId }, WS_TURN_TIMEOUT_MS);
    expect(disabledTurn.ended).not.toBe('timeout');
    expect(knowledgeSources(disabledTurn.events, spaceId)).toEqual([]);
});

test('disabled: 그 턴은 시간 안에 끝났고, Knowledge 기여 도구가 나오면 반드시 거절 문구다', async () => {
    expect(disabledTurn, '앞 테스트의 disabled 턴 결과가 없다').not.toBeNull();
    const turn = disabledTurn as WsTurnResult;
    expect(turn.ended).not.toBe('timeout');
    const surfaced = turn.events.map((e) => JSON.stringify(e)).filter((text) => text.includes(`add-on '${KNOWLEDGE_ID}'`));
    test.info().annotations.push({ type: 'knowledge-tool-surfaced', description: String(surfaced.length) });
    for (const text of surfaced) expect(text).toMatch(/실행할 수 없습니다/);
});

test('disabled: Space 연결 대화의 메시지는 전역 메모리로 가지 않는다(일반 대화는 간다)', async () => {
    test.setTimeout(2 * WS_TURN_TIMEOUT_MS + 2 * MEMORY_WAIT_MS + 30_000);
    const a = adminUser();
    const control = `${MARKER}A`;
    await runWsTurn(BASE, ORIGIN, a.authToken, { message: `${control} 는 내 프로젝트 코드명이야 기억해줘`, sessionId: plainSessionId }, WS_TURN_TIMEOUT_MS);
    await expect.poll(() => countMemoriesContaining(a.userId, control), { timeout: MEMORY_WAIT_MS, message: '대조군(일반 대화)에서 메모리가 생기지 않았다 — 대상 API 를 USER_MEMORY_AUTO_EXTRACT=true 로 띄웠는지 확인' }).toBeGreaterThan(0);

    const isolated = `${MARKER}B`;
    await runWsTurn(BASE, ORIGIN, a.authToken, { message: `${isolated} 는 내 프로젝트 코드명이야 기억해줘`, sessionId: boundSessionId }, WS_TURN_TIMEOUT_MS);
    await new Promise((r) => setTimeout(r, MEMORY_WAIT_MS));
    expect(await countMemoriesContaining(a.userId, isolated)).toBe(0);
});

test('failed: 부팅 실패 상태의 라우트는 503 ADDON_FAILED, Retry-After 없음', async ({ request }) => {
    test.setTimeout(STATE_CACHE_WAIT_MS + 30_000);
    const a = adminUser();
    await setInstallationStateInDb('failed');
    try {
        // DB 를 직접 바꿨으므로 상태 캐시가 지날 때까지 기다린다
        await expect.poll(async () => (await request.get('/api/knowledge/spaces', { headers: a.headers })).status(), { timeout: STATE_CACHE_WAIT_MS, intervals: [1000] }).toBe(503);
        const route = await request.get('/api/knowledge/spaces', { headers: a.headers });
        expect(route.status()).toBe(503);
        expect(route.headers()['retry-after']).toBeUndefined();
        expect(await errorCode(route)).toBe('ADDON_FAILED');
    } finally {
        await setInstallationStateInDb('disabled');
    }
});

test('토글: enabled 응답은 runtime=resumed, 바로 다음 라우트는 200', async ({ request }) => {
    const a = adminUser();
    const res = await patchKnowledgeState(request, a, 'enabled');
    expect(res.status()).toBe(200);
    const data = await toggleData(res);
    expect(data.runtime).toBe('resumed');
    expect(data.restartRequired).toBe(false);
    const route = await request.get('/api/knowledge/spaces', { headers: a.headers });
    expect(route.status()).toBe(200);
});

test('조직 allowlist 밖: 같은 라우트가 그 조직 사용자에게는 403 ADDON_NOT_ENTITLED', async ({ request }) => {
    const a = adminUser();
    const m = memberUser();
    orgId = await createOrgWithAllowlist(a.userId, m.userId, ['e2e-not-knowledge']);
    const active = await request.put('/api/users/me/active-organization', { headers: m.headers, data: { orgId } });
    expect(active.ok()).toBe(true);
    await new Promise((r) => setTimeout(r, 1500)); // ORG_CONTEXT_CACHE_TTL_MS=1000 인 대상 API 기준
    const denied = await request.get('/api/knowledge/spaces', { headers: m.headers });
    expect(denied.status()).toBe(403);
    expect(await errorCode(denied)).toBe('ADDON_NOT_ENTITLED');
    const allowed = await request.get('/api/knowledge/spaces', { headers: a.headers });
    expect(allowed.status()).toBe(200);
});
