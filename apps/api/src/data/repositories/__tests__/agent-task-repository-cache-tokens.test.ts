/**
 * 캐시 적중 프롬프트 토큰(182) 저장 — 값이 있을 때만 쓰고, 없으면 칸을 건드리지 않는다(NULL = 서버가 안 줌).
 */
import type { Pool } from 'pg';
import { AgentTaskRepository } from '../agent-task-repository';

function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

function setParam(call: { sql: string; params: unknown[] }, column: string): unknown {
    const m = call.sql.match(new RegExp(`\\b${column} = \\$(\\d+)`));
    return m ? call.params[Number(m[1]) - 1] : undefined;
}

describe('AgentTaskRepository — 캐시 적중 프롬프트 토큰(182)', () => {
    it('적중 토큰과 그 분모(값을 준 호출의 입력 토큰)를 함께 쓴다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).updateAgentTask('t1', { totalTokens: 300, cachedPromptTokens: 100, cacheReportedPromptTokens: 250 });
        expect(setParam(calls[0], 'cached_prompt_tokens')).toBe(100);
        expect(setParam(calls[0], 'cache_reported_prompt_tokens')).toBe(250);
        expect(setParam(calls[0], 'total_tokens')).toBe(300);
    });

    it('적중 0 도 쓴다(서버가 0 을 준 것)', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).updateAgentTask('t1', { cachedPromptTokens: 0, cacheReportedPromptTokens: 250 });
        expect(setParam(calls[0], 'cached_prompt_tokens')).toBe(0);
    });

    it('값이 없으면 칸을 건드리지 않는다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).updateAgentTask('t1', { totalTokens: 300 });
        expect(calls[0].sql).not.toContain('cached_prompt_tokens');
        expect(calls[0].sql).not.toContain('cache_reported_prompt_tokens');
    });
});
