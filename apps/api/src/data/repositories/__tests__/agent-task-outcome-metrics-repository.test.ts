/**
 * 작업 지표 집계(Companion P5) — 쿼리 2개(실행 방식별+전체 집계, 실패 사유 상위 N)로 끝나고,
 * 행을 가져와 세지 않는다. pg 는 COUNT/SUM 을 문자열로 돌려주므로 숫자 변환과 0건 null 처리를 본다.
 */
import { Pool } from 'pg';
import { AgentTaskOutcomeMetricsRepository } from '../agent-task-outcome-metrics-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const row = (over: Record<string, unknown>) => ({
    executor: 'sandbox', is_total: false, total: '0', completed: '0', failed: '0', cancelled: '0', in_progress: '0',
    duration_p50_ms: null, duration_p95_ms: null, token_tasks: '0', tokens_avg: null, tokens_sum: null,
    cached_prompt_tokens_sum: null, approval_requests: null, questions: null, device_waits: null, browser_takeovers: null,
    ...over,
});

describe('AgentTaskOutcomeMetricsRepository.getMetrics', () => {
    let pool: Pool;
    let repo: AgentTaskOutcomeMetricsRepository;
    beforeEach(() => {
        pool = { query: jest.fn() } as unknown as Pool;
        repo = new AgentTaskOutcomeMetricsRepository(pool);
    });

    it('실행 방식별·전체 집계와 실패 사유 상위 N 을 쿼리 2개로 만든다', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [
                row({ executor: 'local', total: '4', completed: '2', failed: '1', cancelled: '1', duration_p50_ms: '1500.5', duration_p95_ms: '9000',
                    token_tasks: '3', tokens_avg: '1200.4', tokens_sum: '3601', cached_prompt_tokens_sum: '800',
                    approval_requests: '3', questions: '1', device_waits: '2', browser_takeovers: '1' }),
                row({ executor: 'sandbox', total: '2', completed: '0', in_progress: '2' }),
                row({ executor: null, is_total: true, total: '6', completed: '2', failed: '1', cancelled: '1', in_progress: '2',
                    duration_p50_ms: '1500.5', duration_p95_ms: '9000', token_tasks: '3', tokens_avg: '1200.4', tokens_sum: '3601',
                    cached_prompt_tokens_sum: '800', approval_requests: '3', questions: '1', device_waits: '2', browser_takeovers: '1' }),
            ] })
            .mockResolvedValueOnce({ rows: [{ failure_class: 'timeout', count: '3' }, { failure_class: 'unknown', count: '1' }] });

        const r = await repo.getMetrics({ days: 30, failureTopN: 5 });

        expect(pool.query).toHaveBeenCalledTimes(2);
        const [sql1, p1] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql1).toMatch(/GROUPING SETS \(\(t\.executor\), \(\)\)/);
        expect(sql1).toMatch(/percentile_cont\(0\.5\)/);
        expect(sql1).toMatch(/percentile_cont\(0\.95\)/);
        expect(sql1).toMatch(/FROM agent_task_approvals/);
        expect(sql1).toMatch(/FROM agent_task_events/);
        expect(sql1).toMatch(/to_status = 'running'/);
        expect(p1[0]).toBe(30);
        expect(p1[1]).toEqual(expect.arrayContaining(['ask_human', 'mcp_elicit']));
        expect(p1).toEqual(expect.arrayContaining(['device_wait', 'browser_takeover']));
        const [sql2, p2] = (pool.query as jest.Mock).mock.calls[1];
        expect(sql2).toMatch(/status = 'failed'/);
        expect(sql2).toMatch(/LIMIT \$2/);
        expect(p2).toEqual([30, 5]);

        expect(r.byExecutor.map((g) => g.executor)).toEqual(['local', 'sandbox']);
        const local = r.byExecutor[0];
        expect(local).toMatchObject({
            total: 4, completed: 2, failed: 1, cancelled: 1, inProgress: 0, successRate: 0.5,
            durationP50Ms: 1501, durationP95Ms: 9000, tokenTasks: 3, tokensAvg: 1200, tokensSum: 3601, cachedPromptTokensSum: 800,
            approvalRequests: 3, questions: 1, deviceWaits: 2, browserTakeovers: 1, interventionsPerTask: 1.75,
        });
        // 끝난 작업이 0건이면 성공률·백분위·평균은 null, 합계는 0
        expect(r.byExecutor[1]).toMatchObject({ successRate: null, durationP50Ms: null, tokensAvg: null, tokensSum: 0, interventionsPerTask: 0 });
        expect(r.overall).toMatchObject({ executor: null, total: 6, inProgress: 2, successRate: 0.5 });
        expect(r.topFailures).toEqual([{ failureClass: 'timeout', count: 3 }, { failureClass: 'unknown', count: 1 }]);
    });

    it('기간 안에 작업이 없으면 전체는 0건 묶음, 실행 방식별은 빈 배열', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [row({ executor: null, is_total: true })] }).mockResolvedValueOnce({ rows: [] });
        const r = await repo.getMetrics({ days: 7, failureTopN: 5 });
        expect(r.byExecutor).toEqual([]);
        expect(r.overall).toMatchObject({ executor: null, total: 0, successRate: null, interventionsPerTask: null });
        expect(r.topFailures).toEqual([]);
    });
});
