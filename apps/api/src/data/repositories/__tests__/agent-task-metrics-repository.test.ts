import { Pool } from 'pg';
import { AgentTaskMetricsRepository } from '../agent-task-metrics-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

describe('AgentTaskMetricsRepository', () => {
    let pool: Pool;
    let repo: AgentTaskMetricsRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new AgentTaskMetricsRepository(pool);
    });

    it('getToolErrorSummary: tool_result 필터 + days interval 파라미터화', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ total_tool_executions: '1240', error_count: '201', affected_tasks: '71' }],
        });
        const row = await repo.getToolErrorSummary(30);
        expect(row.total_tool_executions).toBe('1240');
        expect(row.error_count).toBe('201');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/step_type = 'tool_result'/);
        expect(sql).toMatch(/content LIKE 'Error:%'/);
        expect(sql).toMatch(/\$1 \|\| ' days'/);
        expect(params).toEqual(['30']);
    });

    it('getToolErrorSummary: 빈 결과 시 0 기본값', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const row = await repo.getToolErrorSummary(7);
        expect(row).toEqual({ total_tool_executions: '0', error_count: '0', affected_tasks: '0' });
    });

    it('getToolErrorTaskStatusDistribution: agent_tasks 조인 + status GROUP BY', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { status: 'completed', tasks: '54' },
                { status: 'failed', tasks: '13' },
            ],
        });
        const rows = await repo.getToolErrorTaskStatusDistribution(30);
        expect(rows).toHaveLength(2);
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/JOIN agent_task_steps/);
        expect(sql).toMatch(/GROUP BY t\.status/);
    });

    it('getToolErrorSignatures: content 정규화 + limit 파라미터화', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ signature: 'Error: [stderr]', count: '26' }],
        });
        const rows = await repo.getToolErrorSignatures(30, 10);
        expect(rows[0].count).toBe('26');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/regexp_replace/);
        expect(sql).toMatch(/LIMIT \$2/);
        expect(params).toEqual(['30', 10]);
    });

    it('getToolErrorByToolName: tool_name IS NOT NULL 필터', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ tool_name: 'bash', count: '47' }],
        });
        const rows = await repo.getToolErrorByToolName(30, 10);
        expect(rows[0].tool_name).toBe('bash');
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/tool_name IS NOT NULL/);
    });
    it('getCompletionVerdictDistribution: completed 한정 + NULL 판정 행 보존', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { completion_path: 'final_answer', judge_verdict: 'achieved', tasks: '31' },
                { completion_path: 'terminate', judge_verdict: null, tasks: '22' },
                { completion_path: null, judge_verdict: null, tasks: '14' },
            ],
        });
        const rows = await repo.getCompletionVerdictDistribution(30);
        // 무판정(NULL) 행을 버리면 지표의 목적 자체가 사라지므로 그대로 올라와야 한다
        expect(rows).toHaveLength(3);
        expect(rows[2]).toEqual({ completion_path: null, judge_verdict: null, tasks: '14' });
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/status = 'completed'/);
        expect(sql).toMatch(/GROUP BY completion_path, judge_verdict/);
        expect(params).toEqual(['30']);
    });

    it('getFailureReasons: failed 한정 + error NULL 은 (unknown) 으로 집계', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ reason: 'goal_incomplete', tasks: '9' }],
        });
        const rows = await repo.getFailureReasons(30, 10);
        expect(rows[0].reason).toBe('goal_incomplete');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/status = 'failed'/);
        expect(sql).toMatch(/COALESCE\(error, '\(unknown\)'\)/);
        expect(params).toEqual(['30', 10]);
    });

    it('getInterventionCounts: retry·hitl_degrade 스텝 보유 작업 수 + 빈 결과 0 기본값', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ total_tasks: '120', retry_tasks: '18', hitl_degrade_tasks: '7' }],
        });
        const row = await repo.getInterventionCounts(30);
        expect(row.retry_tasks).toBe('18');
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/step_type = 'retry'/);
        expect(sql).toMatch(/step_type = 'hitl_degrade'/);

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const empty = await repo.getInterventionCounts(7);
        expect(empty).toEqual({ total_tasks: '0', retry_tasks: '0', hitl_degrade_tasks: '0' });
    });

    it('getPlanAttributionCoverage: plan 있는 작업으로 분모 한정', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ planned_tasks: '40', total_steps: '860', attributed_steps: '731' }],
        });
        const row = await repo.getPlanAttributionCoverage(30);
        expect(row.attributed_steps).toBe('731');
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        // plan 없는 작업까지 세면 커버리지가 구조적으로 낮게 나온다
        expect(sql).toMatch(/t\.plan IS NOT NULL/);
        expect(sql).toMatch(/COUNT\(s\.plan_step_index\) AS attributed_steps/);
    });
});
