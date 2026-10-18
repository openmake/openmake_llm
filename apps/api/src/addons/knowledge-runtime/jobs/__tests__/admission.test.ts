/**
 * claim 재검사 — add-on 단위 게이트(stopped·unknown 이면 claim 없음), 작업별 사용권 판정(run·defer·reject).
 * DB 는 SQL 문자열로 분기하는 가짜 kdb, 판정 포트는 생성자 deps 로 주입한다.
 */
import type { AddonRunVerdict, EntitlementVerdict } from '../../../../runtime-ports/addon-admission';
import type { AdmissionPort } from '../admission';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let claimRows: unknown[] = [];
jest.mock('../../db', () => {
    const query = async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("SET state = 'running'")) {
            const rows = claimRows;
            claimRows = [];
            return { rows, rowCount: rows.length };
        }
        if (sql.includes('RETURNING kind, document_version_id')) return { rows: [{ kind: 'ingest', document_version_id: 'v1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    };
    return { kdb: () => ({ query }), inTransaction: async (fn: (c: { query: typeof query }) => Promise<unknown>) => fn({ query }) };
});
jest.mock('../../config/profiles', () => ({
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
const ingestVersion = jest.fn();
jest.mock('../../ingestion/pipeline', () => ({ ingestVersion: (...a: unknown[]) => ingestVersion(...a) }));
jest.mock('../../embedding/index-manager', () => ({ runReindexJob: jest.fn() }));
jest.mock('../rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../../documents/storage', () => ({ deleteStoredFile: jest.fn() }));
jest.mock('../../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: jest.fn(), checkUserEntitlement: jest.fn(), readAddonStateRevision: jest.fn(), warmAddonStates: jest.fn(),
}));

import { admissionForVerdict, admitJob } from '../admission';
import { KnowledgeWorker } from '../worker';
import { KNOWLEDGE_RUNTIME } from '../../constants';

const JOB = {
    id: 'job-1', kind: 'ingest', document_version_id: 'v1', space_id: 's1', embedding_index_id: null, attempts: 1, fencing_token: '7',
    actor_kind: 'user', actor_user_id: 'u-1', org_id: null, policy_revision: 3, cancel_requested_at: null,
};
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

function fakePort(run: AddonRunVerdict, verdict: EntitlementVerdict = 'ok'): AdmissionPort & { calls: string[]; scopes: unknown[] } {
    const calls: string[] = [];
    const scopes: unknown[] = [];
    return {
        calls,
        scopes,
        readRunVerdict: async () => run,
        checkUserEntitlement: async (_addonId: string, userId: string, scope?: { orgId?: string }) => {
            calls.push(userId);
            scopes.push(scope);
            return verdict;
        },
    };
}

beforeEach(() => {
    queries.length = 0;
    claimRows = [];
    ingestVersion.mockReset();
});

describe('admissionForVerdict', () => {
    it.each([
        ['ok', 'run'],
        ['not-entitled', 'reject'],
        ['disabled', 'defer'],
        ['failed', 'defer'],
        ['state-unknown', 'defer'],
    ] as const)('%s → %s', (verdict, expected) => {
        expect(admissionForVerdict(verdict)).toBe(expected);
    });
});

describe('admitJob', () => {
    it('system 작업은 사용권을 보지 않고 실행한다', async () => {
        const port = fakePort({ run: true }, 'not-entitled');
        await expect(admitJob({ actor_kind: 'system', actor_user_id: 'u-9' }, port)).resolves.toEqual({ admission: 'run', verdict: 'system' });
        expect(port.calls).toEqual([]);
    });

    it('004 이전 행(actor NULL)은 시스템 작업으로 본다', async () => {
        const port = fakePort({ run: true }, 'not-entitled');
        await expect(admitJob({ actor_kind: null, actor_user_id: null }, port)).resolves.toEqual({ admission: 'run', verdict: 'system' });
    });

    it('user·org 인데 사용자 id 가 없으면 거절한다', async () => {
        await expect(admitJob({ actor_kind: 'org', actor_user_id: null }, fakePort({ run: true }))).resolves.toEqual({ admission: 'reject', verdict: 'missing-user' });
    });

    it('조직 작업은 접수한 사용자와 접수 때 저장한 조직으로 사용권을 다시 판정한다(지금 활성 조직이 아니라 — A3)', async () => {
        const port = fakePort({ run: true }, 'ok');
        await expect(admitJob({ actor_kind: 'org', actor_user_id: 'u-1', org_id: 'org-a' }, port)).resolves.toEqual({ admission: 'run', verdict: 'ok' });
        expect(port.calls).toEqual(['u-1']);
        expect(port.scopes).toEqual([{ orgId: 'org-a' }]);
    });

    it('개인 작업은 조직을 지정하지 않는다(사용자의 지금 활성 조직 기준 — 종전)', async () => {
        const port = fakePort({ run: true }, 'ok');
        await admitJob({ actor_kind: 'user', actor_user_id: 'u-1', org_id: null }, port);
        expect(port.scopes).toEqual([undefined]);
    });

    it('조직 작업인데 조직 id 가 없으면 판정하지 않고 거절한다', async () => {
        const port = fakePort({ run: true }, 'ok');
        await expect(admitJob({ actor_kind: 'org', actor_user_id: 'u-1', org_id: null }, port)).resolves.toEqual({ admission: 'reject', verdict: 'missing-org' });
        expect(port.calls).toEqual([]);
    });
});

describe('KnowledgeWorker 실행 판정', () => {
    it('add-on 이 꺼졌으면(stopped) 이번 tick 은 claim 하지 않는다', async () => {
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: fakePort({ run: false, reason: 'stopped', detail: 'disabled' }) });
        expect(await w.tick()).toBe(0);
        expect(sqlWith("SET state = 'running'")).toHaveLength(0);
    });

    it('상태 확인 불가(unknown)여도 claim 하지 않는다(다음 tick 에 다시 본다)', async () => {
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: fakePort({ run: false, reason: 'unknown', detail: 'timeout' }) });
        expect(await w.tick()).toBe(0);
        expect(sqlWith("SET state = 'running'")).toHaveLength(0);
    });

    it('사용권이 철회된 사용자 작업은 실행하지 않고 failed(작업)·ADDON_NOT_ENTITLED(문서 버전)로 끝낸다', async () => {
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: fakePort({ run: true }, 'not-entitled') });
        expect(await w.tick()).toBe(1);
        expect(ingestVersion).not.toHaveBeenCalled();
        const terminal = sqlWith('SET state = $4');
        expect(terminal).toHaveLength(1);
        expect(terminal[0].params).toEqual(['job-1', '7', w.id, 'failed', expect.stringContaining('not-entitled')]);
        const version = sqlWith('UPDATE knowledge_document_versions');
        expect(version[0].params).toEqual(['v1', 'ADDON_NOT_ENTITLED']);
        expect(sqlWith('attempts = GREATEST(attempts - 1, 0)')).toHaveLength(0);
    });

    it('상태 확인 불가면 attempts 를 되돌려 queued 로 보류한다(실패로 세지 않는다)', async () => {
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: fakePort({ run: true }, 'state-unknown') });
        await w.tick();
        expect(ingestVersion).not.toHaveBeenCalled();
        const deferred = sqlWith('attempts = GREATEST(attempts - 1, 0)');
        expect(deferred).toHaveLength(1);
        expect(deferred[0].params).toEqual(['job-1', '7', w.id, expect.stringContaining('state-unknown'), KNOWLEDGE_RUNTIME.JOB_ADMISSION_DEFER_MS]);
        expect(sqlWith('SET state = $4')).toHaveLength(0);
    });

    it('system 작업은 사용권 조회 없이 실행하고 done 을 쓴다', async () => {
        claimRows = [{ ...JOB, actor_kind: 'system', actor_user_id: null }];
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        const port = fakePort({ run: true }, 'not-entitled');
        const w = new KnowledgeWorker({ admission: port });
        await w.tick();
        expect(ingestVersion).toHaveBeenCalledTimes(1);
        expect(port.calls).toEqual([]);
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
    });

    it('판정을 기다리는 사이 즉시 정지되면 판정이 끝나도 핸들러를 돌리지 않고 lease 만 반납한다', async () => {
        claimRows = [JOB];
        let release: (v: EntitlementVerdict) => void = () => undefined;
        const pending = new Promise<EntitlementVerdict>((resolve) => { release = resolve; });
        const port: AdmissionPort = { readRunVerdict: async () => ({ run: true }), checkUserEntitlement: () => pending };
        const w = new KnowledgeWorker({ admission: port });
        const tick = w.tick();
        await new Promise((r) => setImmediate(r)); // claim 을 지나 판정 대기에 들어갈 때까지
        await w.stop({ drain: false, signal: new AbortController().signal });
        release('ok');
        await tick;
        expect(ingestVersion).not.toHaveBeenCalled();
        expect(sqlWith('SET lease_expires_at = NOW()')).toHaveLength(1);
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(w.health().status).toBe('stopped');
    });

    it('판정이 예외면 tick 은 실패하지 않고 그 작업만 lease 반납한다(상태 쓰기 없음)', async () => {
        claimRows = [JOB];
        const port: AdmissionPort = { readRunVerdict: async () => ({ run: true }), checkUserEntitlement: async () => { throw new Error('db down'); } };
        const w = new KnowledgeWorker({ admission: port });
        await expect(w.tick()).resolves.toBe(1);
        expect(ingestVersion).not.toHaveBeenCalled();
        expect(sqlWith('SET lease_expires_at = NOW()')).toHaveLength(1);
        expect(sqlWith('SET state = $4')).toHaveLength(0);
        expect(sqlWith('attempts = GREATEST(attempts - 1, 0)')).toHaveLength(0);
    });

    it('claim 은 actor·취소 열을 돌려받고, 집은 시각을 lastClaimAt 으로 남긴다', async () => {
        claimRows = [{ ...JOB, actor_kind: 'system' }];
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        const w = new KnowledgeWorker({ admission: fakePort({ run: true }), now: () => 1234 });
        expect(w.lastClaimAt()).toBeNull();
        await w.tick();
        expect(sqlWith("SET state = 'running'")[0].sql).toMatch(/j\.actor_kind, j\.actor_user_id, j\.org_id, j\.policy_revision, j\.cancel_requested_at/);
        expect(w.lastClaimAt()).toBe(1234);
        expect(w.id).toMatch(/#\d+#[0-9a-f]{8}$/);
    });
});
