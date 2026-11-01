/**
 * 공간 재색인 요청(requestSpaceReindex) — 쓰기 권한 → 요청자 라이브 배정의 색인 보장(필요하면 측정 1회, 요청자 키)
 * → 같은 색인이면 409 REINDEX_NOT_NEEDED, 진행 중이면 409 REINDEX_IN_PROGRESS → reindex 작업(공간 actor) + 감사.
 * 키 문제는 412(코드), 측정 실패는 502 — 작업은 생기지 않는다. 진행 중 검사와 작업 넣기는 공간별 advisory xact lock 아래 한 트랜잭션.
 */
const queryRows: { inProgress: unknown[] } = { inProgress: [] };
const txQueries: Array<{ sql: string; params: unknown[] }> = [];
const txClient = {
    query: async (sql: string, params: unknown[] = []) => {
        txQueries.push({ sql, params });
        return sql.includes("kind = 'reindex'") ? { rows: queryRows.inProgress } : { rows: [] };
    },
};
jest.mock('../db', () => ({
    kdb: () => ({ query: async () => { throw new Error('진행 중 검사·작업 넣기는 트랜잭션 client 로만'); } }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn(txClient),
}));
jest.mock('../config/scope-policy', () => ({ actorFor: async (userId: string) => ({ userId, activeOrg: null, orgWriteRoles: [] }) }));
let scopeRow: Record<string, unknown> | null = null;
jest.mock('../spaces/repository', () => ({ getSpaceScopeRow: async () => scopeRow }));
const enqueueJob = jest.fn(async (..._a: unknown[]) => 'job-9');
jest.mock('../jobs/queue', () => ({ enqueueJob: (...a: unknown[]) => enqueueJob(...a) }));
const recordAddonAudit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../runtime-ports/audit-port', () => ({ recordAddonAudit: (...a: unknown[]) => recordAddonAudit(...a) }));
const ensureLiveIndex = jest.fn();
jest.mock('../embedding/readiness', () => ({ ensureLiveIndex: (...a: unknown[]) => ensureLiveIndex(...a) }));
jest.mock('../embedding/provider', () => ({ makeIndexEmbedder: jest.fn(), classifyEmbedError: jest.fn() }));

import { requestSpaceReindex } from '../embedding/space-reindex';
import { AppError } from '../../../utils/error-handler';

const live = { fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'user' };
const newIndex = { id: 'idx-new', providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', dimension: 3, metric: 'cosine', status: 'ready', requestParams: {} };

beforeEach(() => {
    scopeRow = { id: 's1', scope_type: 'organization', scope_id: 'org-1', config_profile_id: null, embedding_index_id: 'idx-old' };
    queryRows.inProgress = [];
    txQueries.length = 0;
    enqueueJob.mockClear();
    recordAddonAudit.mockClear();
    ensureLiveIndex.mockReset();
    ensureLiveIndex.mockResolvedValue({ live, index: newIndex });
});

describe('requestSpaceReindex', () => {
    it('요청자 라이브 색인으로 reindex 작업(공간 actor)을 넣고 감사를 남긴다', async () => {
        expect(await requestSpaceReindex('u1', 's1')).toEqual({ jobId: 'job-9', indexId: 'idx-new' });
        expect(ensureLiveIndex).toHaveBeenCalledWith('u1');
        expect(enqueueJob).toHaveBeenCalledWith({
            kind: 'reindex', spaceId: 's1', embeddingIndexId: 'idx-new', actor: { kind: 'org', userId: 'u1', orgId: 'org-1' },
        }, txClient);
        // 같은 트랜잭션 첫 문장이 공간별 잠금, 그 뒤 진행 중 검사 — 동시 요청 둘이 모두 통과하지 못한다
        expect(txQueries[0].sql).toMatch(/pg_advisory_xact_lock\(hashtext\(/);
        expect(txQueries[0].params).toEqual(['s1']);
        expect(txQueries[1].sql).toMatch(/kind = 'reindex'/);
        expect(recordAddonAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'knowledge.space_reindex_requested', userId: 'u1', resourceType: 'knowledge_space', resourceId: 's1',
            details: { spaceId: 's1', fromIndexId: 'idx-old', toIndexId: 'idx-new', providerRef: 'gemini:emb-1', jobId: 'job-9' },
        }));
    });

    it('쓰기 권한이 없으면 404 — 색인 해석·작업 없음', async () => {
        scopeRow = null;
        await expect(requestSpaceReindex('u1', 's1')).rejects.toMatchObject({ statusCode: 404 });
        expect(ensureLiveIndex).not.toHaveBeenCalled();
    });

    it('새 색인이 지금 색인과 같으면 409 REINDEX_NOT_NEEDED', async () => {
        scopeRow = { ...scopeRow, embedding_index_id: 'idx-new' };
        await expect(requestSpaceReindex('u1', 's1')).rejects.toMatchObject({ statusCode: 409, code: 'REINDEX_NOT_NEEDED' });
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('같은 공간에 대기·실행 중 reindex 가 있으면 409 REINDEX_IN_PROGRESS', async () => {
        queryRows.inProgress = [{ id: 'j-old' }];
        await expect(requestSpaceReindex('u1', 's1')).rejects.toMatchObject({ statusCode: 409, code: 'REINDEX_IN_PROGRESS' });
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('키 문제(ensureLiveIndex 의 412)는 그대로 — 작업 없음', async () => {
        ensureLiveIndex.mockRejectedValue(new AppError('키 없음', 412, true, 'EMBEDDING_KEY_MISSING'));
        await expect(requestSpaceReindex('u1', 's1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_MISSING' });
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});
