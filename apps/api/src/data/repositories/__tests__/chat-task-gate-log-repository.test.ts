/** 작업 게이트 기록 저장소 — 삽입 값의 순서와 집계 쿼리의 조건을 고정한다 (실제 DB 없음) */
import type { Pool } from 'pg';
import { ChatTaskGateLogRepository, type ChatTaskGateLogEntry } from '../chat-task-gate-log-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

const entry: ChatTaskGateLogEntry = {
    userId: 'u1', sessionId: 's1', messageId: 42, channel: 'web', mode: 'shadow',
    source: 'jev', pTrue: 0.93, gateError: null, gateMs: 240, gateModel: 'jev-decision', suggested: false, queryChars: 17,
};

describe('ChatTaskGateLogRepository.insert', () => {
    it('본문 없이 판정 값만 한 행으로 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
        await new ChatTaskGateLogRepository(pool).insert(entry);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain('INSERT INTO chat_task_gate_log');
        expect(calls[0].params).toEqual(['u1', 's1', 42, 'web', 'shadow', 'jev', 0.93, null, 240, 'jev-decision', false, 17]);
    });

    it('답 메시지가 없는 턴과 판정 실패는 NULL 로 남긴다, 긴 실패 사유는 200자에서 자른다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
        await new ChatTaskGateLogRepository(pool).insert({ ...entry, messageId: null, pTrue: null, gateError: 'x'.repeat(500) });
        expect(calls[0].params[2]).toBeNull();
        expect(calls[0].params[6]).toBeNull();
        expect(String(calls[0].params[7])).toHaveLength(200);
    });
});

describe('ChatTaskGateLogRepository 집계', () => {
    it('summary 는 기간 조건으로 건수·실패·지연을 한 번에 센다 — pg 의 문자열 숫자를 수로 바꾼다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ total: '10', rule: '3', jev: '7', failed: '1', p50_ms: '250', p95_ms: '900' }] }]);
        const s = await new ChatTaskGateLogRepository(pool).summary('2026-10-01T00:00:00.000Z');
        expect(calls[0].params).toEqual(['2026-10-01T00:00:00.000Z']);
        expect(calls[0].sql).toContain('created_at >= $1');
        expect(s).toEqual({ total: 10, rule: 3, jev: 7, failed: 1, p50Ms: 250, p95Ms: 900 });
    });

    it('summary 는 기록이 없어도 0 으로 돌려준다', async () => {
        const { pool } = fakePool([{ rows: [{ total: '0', rule: '0', jev: '0', failed: '0', p50_ms: null, p95_ms: null }] }]);
        expect(await new ChatTaskGateLogRepository(pool).summary('2026-10-01T00:00:00.000Z')).toEqual({ total: 0, rule: 0, jev: 0, failed: 0, p50Ms: null, p95Ms: null });
    });

    it('histogram 은 어댑터 판정만 0.1 구간으로 센다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ bucket: 0, count: '5' }, { bucket: 9, count: '2' }] }]);
        const h = await new ChatTaskGateLogRepository(pool).histogram('2026-10-01T00:00:00.000Z');
        expect(calls[0].sql).toContain("source = 'jev'");
        expect(calls[0].sql).toContain('p_true IS NOT NULL');
        expect(h).toEqual([{ bucket: 0, count: 5 }, { bucket: 9, count: 2 }]);
    });

    it('samples 는 확률 구간·상한을 파라미터로 넘기고, 본문은 메시지 테이블에서 가져온다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ p_true: 0.97, created_at: '2026-10-13T00:00:00Z', question: '보고서 만들어줘' }] }]);
        const rows = await new ChatTaskGateLogRepository(pool).samples('2026-10-01T00:00:00.000Z', 0.3, 0.7, 30);
        expect(calls[0].params).toEqual(['2026-10-01T00:00:00.000Z', 0.3, 0.7, 30]);
        expect(calls[0].sql).toContain('conversation_messages');
        expect(calls[0].sql).toContain("m.role = 'user'");
        expect(rows).toEqual([{ pTrue: 0.97, createdAt: '2026-10-13T00:00:00Z', question: '보고서 만들어줘' }]);
    });
});
