/** 근거 게이트 기록 저장소 — 삽입 값의 순서를 고정한다 (실제 DB 없음) */
import type { Pool } from 'pg';
import { ChatGroundingGateLogRepository } from '../chat-grounding-gate-log-repository';
import { OrchestratorRunsRepository } from '../orchestrator-runs-repo';

function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('ChatGroundingGateLogRepository.insert', () => {
    it('본문 없이 판정 값만 한 행으로 남긴다, 긴 실패 사유는 200자에서 자른다', async () => {
        const { pool, calls } = fakePool();
        const repo = new ChatGroundingGateLogRepository(pool);
        await repo.insert({ userId: 'u1', sessionId: 's1', messageId: 42, pTrue: 0.02, gateError: null, gateMs: 190, gateModel: 'jev-decision', sourceCount: 8, answerChars: 1200 });
        await repo.insert({ userId: 'u1', sessionId: 's1', messageId: null, pTrue: null, gateError: 'x'.repeat(500), gateMs: 3000, gateModel: 'jev-decision', sourceCount: 1, answerChars: 3 });
        expect(calls[0].sql).toContain('INSERT INTO chat_grounding_gate_log');
        expect(calls[0].params).toEqual(['u1', 's1', 42, 0.02, null, 190, 'jev-decision', 8, 1200]);
        expect(calls[1].params[2]).toBeNull();
        expect(String(calls[1].params[4])).toHaveLength(200);
    });
});

describe('OrchestratorRunsRepository.insert — 검색 게이트 열', () => {
    it('검색 게이트 판정을 미디어 게이트 옆에 남긴다, 없으면 NULL', async () => {
        const { pool, calls } = fakePool();
        const repo = new OrchestratorRunsRepository(pool);
        await repo.insert({ plannerOk: true, outcome: 'simple', gateModel: 'jev-decision', gatePTrue: 0.01, gateMs: 200, searchGatePTrue: 0.9, searchGateMs: 180 });
        await repo.insert({ plannerOk: true, outcome: 'simple' });
        expect(calls[0].sql).toContain('search_gate_p_true, search_gate_ms, search_gate_error');
        expect(calls[0].params.slice(-3)).toEqual([0.9, 180, null]);
        expect(calls[1].params.slice(-3)).toEqual([null, null, null]);
    });
});
