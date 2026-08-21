import { Pool } from 'pg';
import { RoutingMetricsRepository } from '../routing-metrics-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

describe('RoutingMetricsRepository', () => {
    let pool: Pool;
    let repo: RoutingMetricsRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new RoutingMetricsRepository(pool);
    });

    it('getOrchestrationDispatchSummary: 의도/노출/호출/성공 FILTER + days 파라미터화', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{
                total_turns: '820',
                intent_turns: '61',
                exposed_turns: '58',
                called_turns: '19',
                success_turns: '17',
            }],
        });
        const row = await repo.getOrchestrationDispatchSummary(30);
        expect(row.exposed_turns).toBe('58');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/discussion_intent OR task_delegate_intent/);
        expect(sql).toMatch(/cardinality\(tools_exposed\) > 0/);
        expect(sql).toMatch(/tool_called IS NOT NULL/);
        expect(sql).toMatch(/\$1 \|\| ' days'/);
        expect(params).toEqual(['30']);
    });

    it('getOrchestrationDispatchSummary: 빈 결과 시 0 기본값', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const row = await repo.getOrchestrationDispatchSummary(7);
        expect(row).toEqual({
            total_turns: '0',
            intent_turns: '0',
            exposed_turns: '0',
            called_turns: '0',
            success_turns: '0',
        });
    });

    it('getOrchestrationByTool: tool_called NOT NULL 한정 + GROUP BY', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ tool_called: 'delegate_agent_task', turns: '12', success_turns: '11' }],
        });
        const rows = await repo.getOrchestrationByTool(30);
        expect(rows[0].tool_called).toBe('delegate_agent_task');
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/tool_called IS NOT NULL/);
        expect(sql).toMatch(/GROUP BY tool_called/);
    });

    it('getOrchestrationToggleRecall: user_mode none 제외 + 의도별 FILTER', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{
                user_mode: 'discussion',
                turns: '24',
                discussion_intent_turns: '18',
                task_delegate_intent_turns: '1',
            }],
        });
        const rows = await repo.getOrchestrationToggleRecall(30);
        expect(rows[0].discussion_intent_turns).toBe('18');
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/user_mode <> 'none'/);
        expect(sql).toMatch(/GROUP BY user_mode/);
    });

    it('getTailShadowSummary: 라벨·grounding FILTER + 전기간 last_decision_at 서브쿼리', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{
                total_decisions: '206',
                tail_decisions: '4',
                labeled_decisions: '120',
                grounding_fired_decisions: '3',
                grounding_fixed_decisions: '2',
                last_decision_at: '2026-07-30T01:00:00.000Z',
            }],
        });
        const row = await repo.getTailShadowSummary(30);
        expect(row.tail_decisions).toBe('4');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/COUNT\(a_was_correct\) AS labeled_decisions/);
        // 신선도는 기간 밖 적재 중단도 보여야 하므로 last_decision_at 은 기간 필터 없는 서브쿼리
        expect(sql).toMatch(/\(SELECT MAX\(created_at\) FROM routing_shadow_decisions\)/);
        expect(params).toEqual(['30']);
    });

    it('getTailShadowSummary: 빈 결과 시 0·null 기본값', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const row = await repo.getTailShadowSummary(7);
        expect(row).toEqual({
            total_decisions: '0',
            tail_decisions: '0',
            labeled_decisions: '0',
            grounding_fired_decisions: '0',
            grounding_fixed_decisions: '0',
            last_decision_at: null,
        });
    });

    it('getTailShadowByVerifiability: NULL verifiability 행 보존', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { verifiability: 'high', decisions: '80', tail_decisions: '4' },
                { verifiability: null, decisions: '12', tail_decisions: '0' },
            ],
        });
        const rows = await repo.getTailShadowByVerifiability(30);
        expect(rows).toHaveLength(2);
        expect(rows[1].verifiability).toBeNull();
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/GROUP BY verifiability/);
    });
});
