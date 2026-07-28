/**
 * Harness 자가개선 루프 영속화 검증 — getPool 을 mock 하여 DB 없이 SQL 호출을 관찰.
 */
const queryMock = jest.fn();

jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({ query: queryMock }),
}));

import { AgentLearningSystem } from '../learning';

describe('AgentLearningSystem 자가개선 영속화', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryMock.mockResolvedValue({ rows: [] });
    });

    it('runSelfImprovementCycle: 저품질 에이전트의 제안을 agent_prompt_suggestions 에 INSERT', async () => {
        const sys = new AgentLearningSystem();
        // 낮은 평점 + 실패 키워드('틀리') 5건 → 품질 20점, 실패패턴 '잘못된 응답'
        for (let i = 0; i < 5; i++) {
            await sys.collectFeedback({
                agentId: 'agent-x',
                rating: 1,
                comment: '답이 틀리고 오류가 많음',
                query: '질문',
                response: '응답',
            });
        }

        const result = await sys.runSelfImprovementCycle();
        expect(result.improvedAgents).toContain('agent-x');

        const insertCalls = queryMock.mock.calls.filter(
            ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_prompt_suggestions')
        );
        expect(insertCalls.length).toBeGreaterThan(0);
        // status='pending' + ON CONFLICT DO NOTHING 멱등
        expect(insertCalls[0][0]).toContain("'pending'");
        expect(insertCalls[0][0]).toContain('ON CONFLICT (id) DO NOTHING');
    });

    it('getApprovedPromptAdditions: 승인된 제안만 매핑 반환', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockResolvedValueOnce({
            rows: [{ suggestion: '구체적 예시 포함' }, { suggestion: '불확실은 추정 표기' }],
        });
        const additions = await sys.getApprovedPromptAdditions('agent-x');
        expect(additions).toEqual(['구체적 예시 포함', '불확실은 추정 표기']);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain("status = 'approved'");
        expect(params[0]).toBe('agent-x');
    });

    it('DB 오류 시 graceful — getApprovedPromptAdditions 는 빈 배열', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockRejectedValueOnce(new Error('relation does not exist'));
        const additions = await sys.getApprovedPromptAdditions('agent-x');
        expect(additions).toEqual([]);
    });

    it('listSuggestions: status 필터 + 행 매핑', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 'sug_1', agent_id: 'a', suggestion: 's', source_patterns: 'p', quality_score: 20, status: 'pending', created_at: new Date('2026-06-18') }],
        });
        const rows = await sys.listSuggestions({ status: 'pending', agentId: 'a' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'sug_1', agentId: 'a', status: 'pending', qualityScore: 20 });
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('status = $1');
        expect(sql).toContain('agent_id = $2');
        expect(params).toEqual(['pending', 'a', 100]);
    });

    it("listSuggestions: status='all' 이면 status 필터 없음", async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockResolvedValueOnce({ rows: [] });
        await sys.listSuggestions({ status: 'all' });
        const [sql] = queryMock.mock.calls[0];
        expect(sql).not.toContain('status =');
    });

    it('listSuggestions: DB 오류 → graceful 빈 배열', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockRejectedValueOnce(new Error('down'));
        expect(await sys.listSuggestions()).toEqual([]);
    });

    it('setSuggestionStatus: 갱신 행 있으면 true', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockResolvedValueOnce({ rows: [{ id: 'sug_1' }], rowCount: 1 });
        const ok = await sys.setSuggestionStatus('sug_1', 'approved');
        expect(ok).toBe(true);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('UPDATE agent_prompt_suggestions SET status = $2');
        expect(params).toEqual(['sug_1', 'approved']);
    });

    it('setSuggestionStatus: 미존재 → false', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        expect(await sys.setSuggestionStatus('nope', 'rejected')).toBe(false);
    });

    it('setSuggestionStatus: DB 오류는 throw (라우트가 500 처리)', async () => {
        const sys = new AgentLearningSystem();
        queryMock.mockRejectedValueOnce(new Error('db error'));
        await expect(sys.setSuggestionStatus('sug_1', 'approved')).rejects.toThrow('db error');
    });
});
