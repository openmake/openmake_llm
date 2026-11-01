/**
 * K08 시딩 teardown — 시딩 전부터 있던 색인은 지우지 않고(다른 공간이 FK 로 가리킬 수 있다, 006),
 * 시딩 중에 새로 생긴 색인만 지운다.
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let indexRows: Array<{ id: string }> = [];
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });
            if (sql.includes('SELECT id FROM knowledge_embedding_indexes')) return { rows: indexRows };
            if (sql.includes('SELECT d.current_version_id')) return { rows: [{ version_id: 'v-1', status: 'ready', failure_code: null }] };
            if (sql.includes('COUNT(*) n')) return { rows: [{ n: '0' }] };
            return { rows: [] };
        },
    }),
}));
jest.mock('../../../../services/org/membership-cache', () => ({ clearOrgMembershipCache: jest.fn() }));
const createSpace = jest.fn();
jest.mock('../../spaces/service', () => ({ createSpace: (...a: unknown[]) => createSpace(...a) }));
const uploadDocument = jest.fn();
jest.mock('../../documents/service', () => ({ uploadDocument: (...a: unknown[]) => uploadDocument(...a) }));
jest.mock('../../conversations/binding-service', () => ({ createBoundConversation: async () => ({ sessionId: 'sess-bound' }) }));
jest.mock('../../jobs/worker', () => ({ KnowledgeWorker: jest.fn().mockImplementation(() => ({ tick: async () => 0 })) }));
jest.mock('../../documents/storage', () => ({ contentHash: () => 'h', storeOriginal: async () => 'ref' }));
jest.mock('../../jobs/queue', () => ({ enqueueJob: jest.fn() }));
jest.mock('../../jobs/actor', () => ({ systemJobActor: jest.fn() }));
jest.mock('../fixtures/pdf', () => ({ buildTextLayerPdf: jest.fn(), scannedPdfBytes: jest.fn() }));
jest.mock('../fixtures/corpus', () => ({
    PERSONAS: { owner: 'owner', victim: 'victim', orgOwner: 'orgOwner', orgOutsider: 'orgOutsider' },
    ORGS: { o1: 'o1', o2: 'o2' },
    SPACES: [
        { key: 'alpha', scopeType: 'user', ownerPersona: 'owner', name: 'A' },
        { key: 'victim', scopeType: 'user', ownerPersona: 'victim', name: 'V' },
    ],
    CORPUS: [{ key: 'd1', spaceKey: 'alpha', format: 'txt', filename: 'd1.txt', text: 'hello' }],
}));

import { seed } from '../seeding';

describe('seed teardown — 시딩이 만든 색인만 지운다', () => {
    it('시딩 전부터 있던 색인 id 는 삭제·잔여 검사 대상이 아니다', async () => {
        indexRows = [{ id: 'idx-old' }];
        createSpace.mockImplementation(async () => {
            indexRows = [{ id: 'idx-old' }, { id: 'idx-new' }]; // 공간 생성이 라이브 배정 색인을 만들었다
            return { id: `sp-${createSpace.mock.calls.length}` };
        });
        uploadDocument.mockResolvedValue({ id: 'doc-1' });

        const ctx = await seed('t');
        await ctx.teardown();

        const del = queries.find((q) => q.sql.includes('DELETE FROM knowledge_embedding_indexes'));
        expect(del?.params).toEqual([['idx-new']]);
        const left = queries.find((q) => q.sql.includes('FROM knowledge_embedding_indexes WHERE id = ANY'));
        expect(left?.params).toEqual([['idx-new']]);
        await import('node:fs/promises').then((fs) => fs.rm(ctx.storageDir, { recursive: true, force: true }));
    });
});
