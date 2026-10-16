/**
 * /api/health 의 knowledge 절 — 한 쿼리로 모드·generation·현재 모드 소비자 heartbeat 나이·대기열 나이·진행 수.
 * pg 는 bigint·SUM 을 문자열로 준다 — 숫자로 바꾼다. 없는 값은 null.
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let row: Record<string, unknown> | undefined;
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        },
    }),
}));

import { readKnowledgeQueueHealth } from '../worker-status';
import { KNOWLEDGE_RUNTIME } from '../../constants';

beforeEach(() => { queries.length = 0; });

describe('readKnowledgeQueueHealth', () => {
    it('bigint 문자열을 숫자로 바꾸고, heartbeat·inflight 는 현재 DB 모드의 소비자만 본다', async () => {
        row = { mode: 'external', generation: 5, heartbeat_age_ms: '1200', queue_oldest_ms: '45000', inflight: '2' };
        await expect(readKnowledgeQueueHealth()).resolves.toEqual({
            mode: 'external', generation: 5, workerHeartbeatAgeMs: 1200, queueOldestAgeMs: 45000, inflight: 2,
        });
        expect(queries[0].sql).toMatch(/h\.mode = \(SELECT mode FROM m\)/);
        expect(queries[0].params).toEqual([KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_STALE_MS]);
    });

    it('현재 모드의 heartbeat 가 없으면 workerHeartbeatAgeMs 는 null, 대기열 나이는 그대로', async () => {
        row = { mode: 'external', generation: 2, heartbeat_age_ms: null, queue_oldest_ms: '600000', inflight: '0' };
        await expect(readKnowledgeQueueHealth()).resolves.toEqual({
            mode: 'external', generation: 2, workerHeartbeatAgeMs: null, queueOldestAgeMs: 600000, inflight: 0,
        });
    });

    it('모드 행이 없으면(마이그레이션 전) null 과 0', async () => {
        row = { mode: null, generation: null, heartbeat_age_ms: null, queue_oldest_ms: null, inflight: null };
        await expect(readKnowledgeQueueHealth()).resolves.toEqual({
            mode: null, generation: null, workerHeartbeatAgeMs: null, queueOldestAgeMs: null, inflight: 0,
        });
    });
});
