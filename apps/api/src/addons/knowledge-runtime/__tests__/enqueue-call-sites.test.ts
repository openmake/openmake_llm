/**
 * 접수 지점 — 업로드·재시도는 Space actor(user|org), 문서·Space 삭제의 정리는 system(요청자 기록), 관리자 재청킹은 관리자 user.
 * 업로드·재시도·관리자 재청킹은 작업 전에 공간 색인 모델을 그 행위자 키로 선검사한다(412).
 * 서비스만 태우고 큐·DB·저장소·인가는 mock.
 */
const enqueueJob = jest.fn(async (..._a: unknown[]) => 'job-1');
jest.mock('../jobs/queue', () => ({ enqueueJob: (...a: unknown[]) => enqueueJob(...a) }));
const fakeClient = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
jest.mock('../db', () => ({
    kdb: () => fakeClient,
    inTransaction: async (fn: (c: typeof fakeClient) => Promise<unknown>) => fn(fakeClient),
}));
jest.mock('../config/scope-policy', () => ({
    actorFor: async (userId: string) => ({ userId, activeOrg: null, orgWriteRoles: [] }),
    creatableScopeId: jest.fn(),
    SCOPE_POLICY: {},
    SCOPE_TYPES: ['user', 'organization'],
}));
let scopeRow: { id: string; scope_type: 'user' | 'organization'; scope_id: string; config_profile_id: string | null; embedding_index_id: string | null } =
    { id: 's1', scope_type: 'organization', scope_id: 'org-9', config_profile_id: null, embedding_index_id: 'idx-1' };
jest.mock('../spaces/repository', () => ({
    getSpaceScopeRow: async () => scopeRow,
    touchSpace: async () => undefined,
    tombstoneSpace: async () => true,
}));
jest.mock('../documents/repository', () => ({
    countLiveDocuments: async () => 0,
    hasLiveHash: async () => false,
    insertDocumentWithVersion: async () => undefined,
    softDeleteDocument: async () => true,
    getRetryTarget: async () => ({ documentId: 'd1', versionId: 'v-retry', status: 'failed' }),
    resetVersionForRetry: async () => undefined,
    listDocumentRowsForSpace: async () => [],
}));
jest.mock('../config/profiles', () => ({
    resolveSpaceProfiles: async () => ({
        limits: { allowedMimeTypes: ['text/plain'], maxFileBytes: 1000, maxDocumentsPerSpace: 10, purgeAfterDays: 30 },
        chunker: { id: 'chunker-default' },
    }),
    getDefaultLimits: async () => ({ purgeAfterDays: 30 }),
    clearProfileCache: jest.fn(),
}));
const storeOriginal = jest.fn(async (_s: string, v: string) => v);
jest.mock('../documents/storage', () => ({ contentHash: () => 'h'.repeat(64), storeOriginal: (s: string, v: string) => storeOriginal(s, v) }));
jest.mock('../capabilities', () => ({ getCapabilities: jest.fn(), pgvectorVersion: jest.fn() }));
const assertSpaceEmbeddingReady = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../embedding/readiness', () => ({
    assertSpaceEmbeddingReady: (...a: unknown[]) => assertSpaceEmbeddingReady(...a),
    describeSpaceEmbeddings: jest.fn(), ensureLiveIndex: jest.fn(),
}));

import { deleteDocument, retryDocument, uploadDocument } from '../documents/service';
import { deleteSpace } from '../spaces/service';
import { rechunkSpace } from '../admin/service';
import { AppError } from '../../../utils/error-handler';

const actorOf = (call: number) => (enqueueJob.mock.calls[call] as unknown as [{ actor: unknown; kind: string }])[0];

beforeEach(() => {
    enqueueJob.mockClear();
    storeOriginal.mockClear();
    assertSpaceEmbeddingReady.mockClear();
    scopeRow = { id: 's1', scope_type: 'organization', scope_id: 'org-9', config_profile_id: null, embedding_index_id: 'idx-1' };
});

describe('임베딩 키 선검사(412)', () => {
    it('업로드: 선검사가 412 면 파일을 저장하지 않고 작업도 만들지 않는다', async () => {
        assertSpaceEmbeddingReady.mockRejectedValueOnce(new AppError('키 없음', 412, true, 'EMBEDDING_KEY_MISSING'));
        await expect(uploadDocument('u-1', 's1', { buffer: Buffer.from('hello'), originalname: 'a.txt', mimetype: 'text/plain', size: 5 }))
            .rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_MISSING' });
        expect(assertSpaceEmbeddingReady).toHaveBeenCalledWith(scopeRow, 'u-1');
        expect(storeOriginal).not.toHaveBeenCalled();
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('재시도: 선검사가 412 면 작업을 만들지 않는다', async () => {
        assertSpaceEmbeddingReady.mockRejectedValueOnce(new AppError('키 거절', 412, true, 'EMBEDDING_KEY_REJECTED'));
        await expect(retryDocument('u-1', 's1', 'd1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_REJECTED' });
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('관리자 재청킹: 공간 색인을 요청한 관리자 키로 선검사하고, 412 면 작업을 만들지 않는다', async () => {
        fakeClient.query.mockResolvedValueOnce({ rows: [{ id: 's1', embedding_index_id: 'idx-ext' }], rowCount: 1 } as never);
        assertSpaceEmbeddingReady.mockRejectedValueOnce(new AppError('키 없음', 412, true, 'EMBEDDING_KEY_MISSING'));
        await expect(rechunkSpace('s1', 'admin-1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_MISSING' });
        expect(assertSpaceEmbeddingReady).toHaveBeenCalledWith({ id: 's1', embedding_index_id: 'idx-ext' }, 'admin-1');
        expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('관리자 재청킹: 없는(삭제된) 공간은 404 — 선검사도 하지 않는다', async () => {
        fakeClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
        await expect(rechunkSpace('gone', 'admin-1')).rejects.toMatchObject({ statusCode: 404 });
        expect(assertSpaceEmbeddingReady).not.toHaveBeenCalled();
        expect(enqueueJob).not.toHaveBeenCalled();
    });
});

describe('접수 지점 actor', () => {
    it('조직 Space 업로드는 org actor(조직 id)로 ingest 를 같은 트랜잭션에 넣는다', async () => {
        await uploadDocument('u-1', 's1', { buffer: Buffer.from('hello'), originalname: 'a.txt', mimetype: 'text/plain', size: 5 });
        expect(actorOf(0)).toMatchObject({ kind: 'ingest', actor: { kind: 'org', userId: 'u-1', orgId: 'org-9' } });
        expect(enqueueJob.mock.calls[0][1]).toBe(fakeClient);
    });

    it('개인 Space 재시도는 user actor', async () => {
        scopeRow = { id: 's1', scope_type: 'user', scope_id: 'u-1', config_profile_id: null, embedding_index_id: 'idx-1' };
        await retryDocument('u-1', 's1', 'd1');
        expect(actorOf(0)).toMatchObject({ kind: 'ingest', documentVersionId: 'v-retry', actor: { kind: 'user', userId: 'u-1', orgId: null } });
    });

    it('문서 삭제·Space 삭제의 정리는 system actor(요청자 기록)', async () => {
        await deleteDocument('u-1', 's1', 'd1');
        await deleteSpace('u-1', 's1');
        expect(actorOf(0)).toMatchObject({ kind: 'cleanup', actor: { kind: 'system', userId: 'u-1', orgId: null } });
        expect(actorOf(1)).toMatchObject({ kind: 'cleanup', actor: { kind: 'system', userId: 'u-1', orgId: null } });
    });

    it('관리자 재청킹은 그 관리자의 user actor', async () => {
        fakeClient.query.mockResolvedValueOnce({ rows: [{ id: 's1', embedding_index_id: 'idx-1' }], rowCount: 1 } as never);
        await rechunkSpace('s1', 'admin-1');
        expect(actorOf(0)).toMatchObject({ kind: 'rechunk', spaceId: 's1', actor: { kind: 'user', userId: 'admin-1', orgId: null } });
    });
});
