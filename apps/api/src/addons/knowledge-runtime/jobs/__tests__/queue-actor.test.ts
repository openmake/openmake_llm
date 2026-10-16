/**
 * 접수(enqueue)가 actor 세 열과 접수 시점 add-on 상태 revision 을 싣는다 — DB 는 가짜 kdb, revision 은 포트 mock.
 */
import type { PoolClient } from 'pg';

const queries: Array<{ sql: string; params: unknown[] }> = [];
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            return { rows: [], rowCount: 1 };
        },
    }),
}));
const readAddonStateRevision = jest.fn();
jest.mock('../../../../runtime-ports/addon-admission', () => ({
    readAddonStateRevision: (...a: unknown[]) => readAddonStateRevision(...a),
}));

import { enqueueJob } from '../queue';
import { spaceJobActor, systemJobActor, userJobActor } from '../actor';

beforeEach(() => {
    queries.length = 0;
    readAddonStateRevision.mockReset();
});

describe('JobActor 생성', () => {
    it('개인 Space 는 user, 조직 Space 는 org(조직 id 포함)', () => {
        expect(spaceJobActor('u-1', { scope_type: 'user', scope_id: 'u-1' })).toEqual({ kind: 'user', userId: 'u-1', orgId: null });
        expect(spaceJobActor('u-1', { scope_type: 'organization', scope_id: 'org-9' })).toEqual({ kind: 'org', userId: 'u-1', orgId: 'org-9' });
    });

    it('관리자 작업은 user, 정리·평가는 system(요청자는 기록용)', () => {
        expect(userJobActor('admin-1')).toEqual({ kind: 'user', userId: 'admin-1', orgId: null });
        expect(systemJobActor('u-2')).toEqual({ kind: 'system', userId: 'u-2', orgId: null });
        expect(systemJobActor(null)).toEqual({ kind: 'system', userId: null, orgId: null });
    });
});

describe('enqueueJob — actor·policy_revision', () => {
    it('actor 세 열과 접수 시점 revision 을 넣는다(add-on id 로 조회)', async () => {
        readAddonStateRevision.mockResolvedValue(7);
        const id = await enqueueJob({ kind: 'ingest', documentVersionId: 'v1', actor: spaceJobActor('u-1', { scope_type: 'organization', scope_id: 'org-9' }) });
        expect(readAddonStateRevision).toHaveBeenCalledWith('knowledge-runtime');
        expect(queries[0].sql).toMatch(/actor_kind, actor_user_id, org_id, policy_revision/);
        expect(queries[0].params).toEqual([id, 'ingest', 'v1', null, null, null, 'org', 'u-1', 'org-9', 7]);
    });

    it('revision 조회 실패(null)여도 접수한다 — 실행 판정은 claim 때 다시 한다', async () => {
        readAddonStateRevision.mockResolvedValue(null);
        await enqueueJob({ kind: 'rechunk', spaceId: 's1', actor: userJobActor('admin-1') });
        expect(queries[0].params.slice(6)).toEqual(['user', 'admin-1', null, null]);
    });

    it('트랜잭션 client 를 주면 그 client 로 넣고 runAfter 를 ISO 로 넘긴다', async () => {
        readAddonStateRevision.mockResolvedValue(1);
        const client = { query: jest.fn(async (_sql: string, _params: unknown[]) => ({ rows: [], rowCount: 1 })) };
        await enqueueJob(
            { kind: 'cleanup', spaceId: 's1', runAfter: new Date('2026-11-01T00:00:00.000Z'), actor: systemJobActor('u-2') },
            client as unknown as PoolClient,
        );
        expect(queries).toHaveLength(0);
        expect(client.query.mock.calls[0][1]).toEqual([expect.any(String), 'cleanup', null, 's1', null, '2026-11-01T00:00:00.000Z', 'system', 'u-2', null, 1]);
    });
});
