/**
 * MCP add-on 데이터 의무 — 종전 Base 보존 작업에 있던 인스턴스 이력 정리(최신 transition 보존)를 그대로 옮겼다.
 */
const mockQuery = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({ query: mockQuery }) }));

import { mcpDataModule } from '../data-module';

const ENV_KEY = 'MCP_INSTANCE_RETENTION_DAYS';
const saved = process.env[ENV_KEY];
afterEach(() => { if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved; mockQuery.mockReset(); });

const run = () => mcpDataModule.retention![0].run();

describe('mcpDataModule.retention', () => {
    it('기본 30일 — 최신 transition 은 남기고 지운 행 수를 돌려준다', async () => {
        delete process.env[ENV_KEY];
        mockQuery.mockResolvedValue({ rowCount: 4 });
        await expect(run()).resolves.toBe(4);
        const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toMatch(/DELETE FROM mcp_server_instances/);
        expect(sql).toMatch(/DISTINCT ON \(mcp_server_id, user_id\)/);
        expect(params).toEqual(['30']);
    });

    it('0 이하·숫자 아님이면 정리하지 않는다', async () => {
        for (const v of ['0', '-1', 'x']) {
            process.env[ENV_KEY] = v;
            await expect(run()).resolves.toBe(0);
        }
        expect(mockQuery).not.toHaveBeenCalled();
    });
});
