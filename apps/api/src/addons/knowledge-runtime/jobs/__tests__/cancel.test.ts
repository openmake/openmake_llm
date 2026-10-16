// apps/api/src/addons/knowledge-runtime/jobs/__tests__/cancel.test.ts
/**
 * 취소 요청 — queued 는 바로 cancelled(문서 버전 CANCELLED), running 은 요청만 찍고 cancelling.
 * 본인(user·org 접수자) 또는 관리자만, 그 밖은 404. 끝난 작업은 409. 성공하면 감사 knowledge.job_cancelled(실패해도 취소는 유지).
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let row: Record<string, unknown> | undefined;
jest.mock('../../db', () => {
    const query = async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('FOR UPDATE')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        return { rows: [], rowCount: 1 };
    };
    return { kdb: () => ({ query }), inTransaction: async (fn: (c: { query: typeof query }) => Promise<unknown>) => fn({ query }) };
});
const audit = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../../../../runtime-ports/audit-port', () => ({ recordAddonAudit: (...a: unknown[]) => audit(...a) }));

import { requestJobCancel } from '../cancel';

const own = { state: 'queued', kind: 'ingest', actor_kind: 'user', actor_user_id: 'u-1', document_version_id: 'v1' };
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

beforeEach(() => {
    queries.length = 0;
    audit.mockReset();
    audit.mockResolvedValue(undefined);
});

describe('requestJobCancel', () => {
    it('대기 중인 본인 수집 작업은 바로 cancelled, 문서 버전은 CANCELLED, 감사가 남는다', async () => {
        row = { ...own };
        await expect(requestJobCancel({ jobId: 'j1', userId: 'u-1', isAdmin: false })).resolves.toEqual({ jobId: 'j1', state: 'cancelled' });
        expect(sqlWith("SET state = 'cancelled'")[0].params).toEqual(['j1']);
        expect(sqlWith('UPDATE knowledge_document_versions')[0].params).toEqual(['v1', 'CANCELLED']);
        expect(audit).toHaveBeenCalledWith({
            action: 'knowledge.job_cancelled', userId: 'u-1', resourceType: 'knowledge_job', resourceId: 'j1',
            details: { outcome: 'cancelled', byAdmin: false },
        });
    });

    it('실행 중인 본인 작업은 요청만 찍고 cancelling(문서는 실행자가 마감)', async () => {
        row = { ...own, state: 'running', actor_kind: 'org' };
        await expect(requestJobCancel({ jobId: 'j1', userId: 'u-1', isAdmin: false })).resolves.toEqual({ jobId: 'j1', state: 'cancelling' });
        expect(sqlWith('cancel_requested_at = COALESCE(cancel_requested_at, NOW())')).toHaveLength(1);
        expect(sqlWith('UPDATE knowledge_document_versions')).toHaveLength(0);
    });

    it('남의 작업·시스템 작업·004 이전 작업은 관리자가 아니면 404(존재를 드러내지 않는다)', async () => {
        for (const r of [{ ...own, actor_user_id: 'u-2' }, { ...own, actor_kind: 'system' }, { ...own, actor_kind: null, actor_user_id: null }]) {
            row = r;
            await expect(requestJobCancel({ jobId: 'j1', userId: 'u-1', isAdmin: false })).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
        }
        expect(audit).not.toHaveBeenCalled();
    });

    it('관리자는 시스템 작업도 취소한다', async () => {
        row = { ...own, kind: 'cleanup', actor_kind: 'system', actor_user_id: null, document_version_id: null };
        await expect(requestJobCancel({ jobId: 'j9', userId: 'admin-1', isAdmin: true })).resolves.toEqual({ jobId: 'j9', state: 'cancelled' });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ details: { outcome: 'cancelled', byAdmin: true } }));
    });

    it('끝난 작업은 409, 없는 작업은 404', async () => {
        for (const state of ['done', 'failed', 'cancelled']) {
            row = { ...own, state };
            await expect(requestJobCancel({ jobId: 'j1', userId: 'u-1', isAdmin: false })).rejects.toMatchObject({ statusCode: 409, code: 'JOB_NOT_CANCELLABLE' });
        }
        row = undefined;
        await expect(requestJobCancel({ jobId: 'nope', userId: 'u-1', isAdmin: true })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('감사 기록이 실패해도 취소 결과는 돌려준다', async () => {
        row = { ...own };
        audit.mockRejectedValueOnce(new Error('audit down'));
        await expect(requestJobCancel({ jobId: 'j1', userId: 'u-1', isAdmin: false })).resolves.toEqual({ jobId: 'j1', state: 'cancelled' });
    });
});
