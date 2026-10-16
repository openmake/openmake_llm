/**
 * 소비자 heartbeat 행 — 한 문장으로 upsert 하며 DB 모드·generation 을 함께 읽고, 오래된 행을 지우고, 종료 때 자기 행을 지운다.
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let modeRow: { db_mode: string | null; generation: number | null } | undefined = { db_mode: 'external', generation: 4 };
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            if (sql.includes('INSERT INTO knowledge_worker_heartbeats')) return { rows: modeRow ? [modeRow] : [], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        },
    }),
}));

import { removeWorkerHeartbeat, writeWorkerHeartbeat } from '../heartbeat-row';
import { KNOWLEDGE_RUNTIME } from '../../constants';

beforeEach(() => {
    queries.length = 0;
    modeRow = { db_mode: 'external', generation: 4 };
});

describe('heartbeat 행', () => {
    it('worker_id·종류·진행 수로 upsert 하고 DB 모드·generation 을 돌려준다', async () => {
        await expect(writeWorkerHeartbeat({ workerId: 'w-1', kind: 'inprocess', inflight: 2 })).resolves.toEqual({ dbMode: 'external', generation: 4 });
        expect(queries[0].sql).toMatch(/ON CONFLICT \(worker_id\) DO UPDATE/);
        expect(queries[0].params).toEqual(['w-1', 'inprocess', 2]);
    });

    it('갱신 뒤 보존 기간보다 오래된 행을 지운다', async () => {
        await writeWorkerHeartbeat({ workerId: 'w-1', kind: 'external', inflight: 0 });
        expect(queries[1].sql).toMatch(/DELETE FROM knowledge_worker_heartbeats WHERE last_seen < NOW\(\)/);
        expect(queries[1].params).toEqual([KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_RETENTION_MS]);
    });

    it('모드 행이 없으면 dbMode·generation 은 null', async () => {
        modeRow = { db_mode: null, generation: null };
        await expect(writeWorkerHeartbeat({ workerId: 'w-1', kind: 'external', inflight: 0 })).resolves.toEqual({ dbMode: null, generation: null });
    });

    it('정상 종료 때 자기 행만 지운다', async () => {
        await removeWorkerHeartbeat('w-1');
        expect(queries[0]).toEqual({ sql: 'DELETE FROM knowledge_worker_heartbeats WHERE worker_id = $1', params: ['w-1'] });
    });
});
