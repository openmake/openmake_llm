import { Pool } from 'pg';
import { OpsMetricsRepository } from '../ops-metrics-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

describe('OpsMetricsRepository', () => {
    let pool: Pool;
    let repo: OpsMetricsRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new OpsMetricsRepository(pool);
    });

    it('getProviderUsage: 클라이언트 중단(CLIENT_ABORTED)은 errors 에서 빼고 client_aborted 로 따로 센다', async () => {
        const rows = [{
            provider_id: 'openai', model_id: 'gpt-x', requests: '10',
            input_tokens: '100', output_tokens: '200', cost_usd_micros: '300',
            avg_duration_ms: '1500', errors: '1', client_aborted: '2',
        }];
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows });
        const result = await repo.getProviderUsage(24, 5);
        expect(result).toEqual(rows);
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/FROM external_provider_usage/);
        expect(sql).toMatch(/error_code IS NOT NULL AND error_code <> 'CLIENT_ABORTED'\) AS errors/);
        expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE error_code = 'CLIENT_ABORTED'\) AS client_aborted/);
        expect(params).toEqual(['24', '5']);
    });
});
