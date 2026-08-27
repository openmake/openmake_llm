import { Pool } from 'pg';
import { ToolHealthRepository } from '../tool-health-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

describe('ToolHealthRepository', () => {
    let pool: Pool;
    let repo: ToolHealthRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new ToolHealthRepository(pool);
    });

    it('getToolHealth: audit_logs 소스 + 분모(COUNT(*)) 포함 + minCalls HAVING', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{ tool: 'open-design::list_projects', server: 'open-design', calls: '14', errors: '6', last_error_at: new Date(0), p50_duration_ms: '25' }],
        });
        const rows = await repo.getToolHealth(30, 3, 20);
        expect(rows).toHaveLength(1);
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/FROM audit_logs/);
        expect(sql).toMatch(/action = 'mcp_tool_call'/);
        // 분모가 이 지표의 존재 이유 — COUNT(*) 가 빠지면 기존 '오류 건수' 지표와 같아진다.
        expect(sql).toMatch(/COUNT\(\*\) AS calls/);
        expect(sql).toMatch(/HAVING COUNT\(\*\) >= \$2/);
        expect(params).toEqual(['30', '3', '20']);
    });

    it('getToolHealth: durationMs 가 숫자가 아닌 행은 p50 계산에서 제외(캐스팅 실패 방지)', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        await repo.getToolHealth(7, 1, 5);
        const [sql] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/durationMs' ~ '\^\[0-9\]\+\$'/);
    });

    it('getErrorCategories: 실패 행만 + 도구×카테고리 GROUP BY', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({
            rows: [
                { tool: 'a::b', category: 'timeout', count: '3' },
                { tool: 'a::b', category: null, count: '1' },
            ],
        });
        const rows = await repo.getErrorCategories(30);
        expect(rows).toHaveLength(2);
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/details->>'isError' = 'true'/);
        expect(sql).toMatch(/GROUP BY resource_id, details->>'errorCategory'/);
        expect(params).toEqual(['30']);
    });

    it('getSummary: 빈 결과 시 0 기본값', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const row = await repo.getSummary(7);
        expect(row).toEqual({ calls: '0', errors: '0', distinct_tools: '0', failing_tools: '0' });
    });
});
