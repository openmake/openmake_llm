/**
 * plugin-boundary.spec.ts 의 helper — 관리자·일반 사용자 가입, 격리 DB 조작, WS 한 턴.
 * DB 는 TEST_DATABASE_URL(이름이 _test 로 끝나는 격리 DB)만 — gdpr-fixtures.pgConfig 를 그대로 쓴다.
 * 가입·로그인은 e2e-account 의 signupE2eAccount 를 쓰고, 여기서는 관리자 승격만 더한다.
 * 시험 데이터는 만든 id 로만 지운다.
 */
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { Client } from 'pg';
import WebSocket from 'ws';
import { pgConfig } from './gdpr-fixtures';
import { signupE2eAccount, type E2eAccount } from './e2e-account';

export const KNOWLEDGE_ID = 'knowledge-runtime';
const TEST_PW = 'PluginBoundaryE2E!2026';

export function e2eBaseUrl(): string {
    return process.env.E2E_BASE_URL || process.env.PW_TEST_BASE_URL || 'http://localhost:52418';
}

export function e2eWsOrigin(): string {
    return process.env.E2E_WS_ORIGIN || 'http://localhost:3010';
}

/** 가입·로그인을 마친 시험 사용자 — userId·email·authToken·headers(인증 쿠키 + CSRF 쿠키·헤더) */
export type BoundaryUser = E2eAccount;

export async function withDb<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        return await fn(pg);
    } finally {
        await pg.end();
    }
}

/** 관리자 승격(role 만 — users.tier 는 마이그레이션 039 가 지웠다). 실패하면 방금 만든 사용자를 id 로 지우고 원래 오류를 던진다 */
async function promoteAdminOrDelete(userId: string): Promise<void> {
    try {
        await withDb((pg) => pg.query(`UPDATE users SET role='admin' WHERE id=$1`, [userId]));
    } catch (err) {
        // 승격 실패 사용자가 afterAll 정리 대상(admin 변수)에 오르지 못해 남지 않게 여기서 지운다
        await withDb((pg) => pg.query(`DELETE FROM users WHERE id=$1`, [userId])).catch((cleanupErr: unknown) => {
            console.error(`[plugin-boundary] 승격 실패 사용자 ${userId} 삭제도 실패 — 이 id 로 직접 지운다: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
        });
        throw err;
    }
}

/** 가입 + 로그인. admin 이면 로그인 전에 DB 로 관리자 승격해 로그인 토큰에 역할이 실리게 한다 */
export async function signupBoundaryUser(baseURL: string, opts: { admin?: boolean } = {}): Promise<BoundaryUser> {
    return signupE2eAccount(baseURL, {
        prefix: 'e2e-plugin-boundary',
        password: TEST_PW,
        afterRegister: opts.admin ? promoteAdminOrDelete : undefined,
    });
}

export function patchKnowledgeState(
    api: APIRequestContext,
    admin: BoundaryUser,
    state: 'enabled' | 'disabled',
    opts: { timeoutMs?: number } = {},
): Promise<APIResponse> {
    return api.patch(`/api/admin/addons/${KNOWLEDGE_ID}/state`, {
        headers: admin.headers,
        data: { state, reason: 'e2e plugin-boundary' },
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
}

/**
 * 파괴적 suite 의 대상 가드 — 사용자 승격·전역 add-on 토글·상태 강제를 하므로 격리 대상에서만 돈다.
 * (a) E2E_BASE_URL 이 셸 또는 tests/e2e/.env.e2e 에 명시돼 있어야 한다(기본값 :52418 은 로컬 개발 API).
 * (b) TEST_DATABASE_URL 이 있어야 하고(DATABASE_URL 로 대체하지 않는다), 그 DB 이름과 실제 접속 DB 가 `_test` 로 끝나야 한다.
 * 어긋나면 이유를 담아 던진다 — 호출 측은 이 확인이 통과한 뒤에만 DB 를 바꾼다.
 */
export async function assertIsolatedE2eTarget(): Promise<void> {
    if (!process.env.E2E_BASE_URL) {
        throw new Error('E2E_BASE_URL 이 지정되지 않았다 — 이 suite 는 격리 테스트 DB 에 붙인 e2e 전용 API 에서만 돈다(runbook 부록 B). 개발 API(:52418)로 돌리지 않는다');
    }
    pgConfig(); // TEST_DATABASE_URL 이 있고 그 DB 이름이 _test 로 끝나는지(아니면 던진다)
    const actual = await withDb(async (pg) => (await pg.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? '');
    if (!actual.endsWith('_test')) {
        throw new Error(`접속한 DB(${actual})가 _test 로 끝나지 않는다 — 격리 DB 가 아니면 돌리지 않는다`);
    }
}

/**
 * 부팅 실패(failed)는 관리자 화면으로 만들 수 없어 DB 로 흉내 낸다. DB 를 직접 바꾸면 대상 API 의 add-on 상태
 * 캐시(ADDON_STATE_CACHE_TTL_MS, 기본 30초)가 지난 뒤에 라우트에 보인다 — 쓰는 쪽이 기다린다.
 */
export async function setInstallationStateInDb(state: 'enabled' | 'disabled' | 'failed'): Promise<void> {
    await withDb((pg) => pg.query(`UPDATE addon_installations SET state=$1, updated_at=NOW() WHERE addon_id=$2`, [state, KNOWLEDGE_ID]));
}

export async function readInstallationState(): Promise<string | null> {
    return withDb(async (pg) => {
        const r = await pg.query<{ state: string }>(`SELECT state FROM addon_installations WHERE addon_id=$1`, [KNOWLEDGE_ID]);
        return r.rows[0]?.state ?? null;
    });
}

/** 관리자 의도(desired_state) — 정리 확인에서 state 와 함께 본다 */
export async function readDesiredState(): Promise<string | null> {
    return withDb(async (pg) => {
        const r = await pg.query<{ desired_state: string }>(`SELECT desired_state FROM addon_installations WHERE addon_id=$1`, [KNOWLEDGE_ID]);
        return r.rows[0]?.desired_state ?? null;
    });
}

export async function waitForDocumentReady(spaceId: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = 'none';
    while (Date.now() < deadline) {
        last = await withDb(async (pg) => {
            const r = await pg.query<{ status: string }>(
                `SELECT status FROM knowledge_documents WHERE space_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [spaceId]);
            return r.rows[0]?.status ?? 'none';
        });
        if (last === 'ready' || last === 'failed') return last;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return last;
}

export async function countMemoriesContaining(userId: string, needle: string): Promise<number> {
    return withDb(async (pg) => {
        const r = await pg.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM user_memories WHERE user_id=$1 AND content LIKE $2`, [userId, `%${needle}%`]);
        return Number(r.rows[0].n);
    });
}

/** 조직 하나를 만들고 member 를 넣은 뒤 ADDON_ALLOWLIST 정책을 건다. 돌려준 id 로만 지운다 */
export async function createOrgWithAllowlist(ownerUserId: string, memberUserId: string, allowlist: string[]): Promise<string> {
    const orgId = `e2e-org-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await withDb(async (pg) => {
        await pg.query(`INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $1, $1, $2)`, [orgId, ownerUserId]);
        await pg.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [orgId, memberUserId]);
        await pg.query(
            `INSERT INTO organization_policies (org_id, key, value, updated_by) VALUES ($1, 'ADDON_ALLOWLIST', $2::jsonb, $3)`,
            [orgId, JSON.stringify(allowlist), ownerUserId]);
    });
    return orgId;
}

/** API 삭제가 2xx 가 아닐 때의 대체 — Space 행을 id 로 지운다(문서·작업·연결은 ON DELETE CASCADE). 사용자 삭제로는 지워지지 않는다 */
export async function deleteSpaceInDb(spaceId: string): Promise<void> {
    await withDb((pg) => pg.query(`DELETE FROM knowledge_spaces WHERE id=$1`, [spaceId]));
}

export async function deleteOrg(orgId: string): Promise<void> {
    await withDb((pg) => pg.query(`DELETE FROM organizations WHERE id=$1`, [orgId]));
}

export interface WsTurnResult {
    events: Array<Record<string, unknown>>;
    ended: 'done' | 'error' | 'timeout';
}

/** WS 채팅 한 턴 — done·error 가 오거나 시간이 다 될 때까지 받은 이벤트를 모은다 */
export function runWsTurn(
    baseURL: string,
    origin: string,
    authToken: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
): Promise<WsTurnResult> {
    const wsUrl = `${baseURL.replace(/^http/, 'ws')}/ws`;
    return new Promise((resolve, reject) => {
        const events: Array<Record<string, unknown>> = [];
        const ws = new WebSocket(wsUrl, { headers: { Origin: origin, Cookie: `auth_token=${authToken}` } });
        const finish = (ended: WsTurnResult['ended']) => {
            clearTimeout(timer);
            ws.close();
            resolve({ events, ended });
        };
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'chat', ...payload })));
        ws.on('message', (raw) => {
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(String(raw)) as Record<string, unknown>;
            } catch {
                return;
            }
            events.push(msg);
            if (msg.type === 'done') finish('done');
            else if (msg.type === 'error') finish('error');
        });
        ws.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

/**
 * 그 Space 의 Knowledge 출처만 센다 — 출처 url 이 /knowledge/<spaceId>?doc=… 인 것
 * (addons/knowledge-runtime/retrieval/citation.ts chunkUrl). 웹검색 출처는 빼서 끈 상태 판정이 흔들리지 않게 한다.
 */
export function knowledgeSources(events: Array<Record<string, unknown>>, spaceId: string): Array<Record<string, unknown>> {
    if (!spaceId) throw new Error('knowledgeSources: spaceId 가 비었다 — 준비 테스트가 Space 를 만들지 못했다');
    const prefix = `/knowledge/${encodeURIComponent(spaceId)}`;
    const found: Array<Record<string, unknown>> = [];
    for (const e of events) {
        if (e.type !== 'search_sources' || !Array.isArray(e.sources)) continue;
        for (const src of e.sources as unknown[]) {
            if (typeof src !== 'object' || src === null) continue;
            const url = (src as { url?: unknown }).url;
            if (typeof url === 'string' && url.startsWith(prefix)) found.push(src as Record<string, unknown>);
        }
    }
    return found;
}

/** 실패 경로 복원 — 토글 API 를 못 쓸 때 의도·상태를 add-on id 로 직접 enabled 로 되돌린다 */
export async function forceEnabledInDb(): Promise<void> {
    await withDb((pg) => pg.query(
        `UPDATE addon_installations SET desired_state='enabled', state='enabled', updated_at=NOW() WHERE addon_id=$1`, [KNOWLEDGE_ID]));
}
