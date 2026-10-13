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
    const entry = { userId: 'u1', sessionId: 's1', messageId: 42, pTrue: 0.02, gateError: null, gateMs: 250, gateModel: 'jev-decision', sourceCount: 8, answerChars: 1200, method: 'claim' as const, claimCount: 2, lowCount: 1, claims: [{ n: 1, p: 0.8 }, { n: 2, p: 0.02 }] };

    it('본문 없이 판정 값만 한 행으로 남긴다 — 문장별 결과는 출처 번호와 확률만', async () => {
        const { pool, calls } = fakePool();
        await new ChatGroundingGateLogRepository(pool).insert(entry);
        expect(calls[0].sql).toContain('INSERT INTO chat_grounding_gate_log');
        expect(calls[0].params).toEqual(['u1', 's1', 42, 0.02, null, 250, 'jev-decision', 8, 1200, 'claim', 2, 1, JSON.stringify(entry.claims)]);
    });

    it('답 메시지 id 가 없거나 확률이 없으면 NULL, 긴 실패 사유는 200자에서 자른다', async () => {
        const { pool, calls } = fakePool();
        await new ChatGroundingGateLogRepository(pool).insert({ ...entry, messageId: null, pTrue: null, gateError: 'x'.repeat(500), claimCount: 0, lowCount: 0, claims: [] });
        expect(calls[0].params[2]).toBeNull();
        expect(calls[0].params[3]).toBeNull();
        expect(String(calls[0].params[4])).toHaveLength(200);
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
