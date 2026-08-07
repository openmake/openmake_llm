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
});
