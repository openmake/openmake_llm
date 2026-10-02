/**
 * 부팅 시 "좀비 정리" 회귀 가드.
 *
 * 이 두 UPDATE 가 사라지면 이전 프로세스가 남긴 진행 중 상태가 영구히 남아, 프론트가
 * 끝나지 않는 작업을 계속 '진행 중' 으로 표시한다. 실제로 Deep Research 쪽 정리가
 * 없어서 2026-07-26 중단분 3건이 나흘간 running 으로 방치됐다.
 */
import type { Pool } from 'pg';
import { initSchema } from '../schema-initializer';
import { leaseOwner } from '../../../services/agent-task/task-lease';

function fakePool(): { pool: Pool; queries: string[] } {
    const queries: string[] = [];
    const pool = {
        query: jest.fn(async (sql: unknown) => {
            queries.push(String(sql));
            return { rowCount: 0, rows: [] };
        }),
    } as unknown as Pool;
    return { pool, queries };
}

describe('initSchema — 부팅 시 좀비 정리', () => {
    it('agent_tasks 의 running/paused 를 failed(server restarted) 로 마킹한다', async () => {
        const { pool, queries } = fakePool();

        await initSchema(pool);

        const sql = queries.find(q => q.includes('UPDATE agent_tasks') && q.includes("'server restarted'"));
        expect(sql).toBeDefined();
        expect(sql).toContain("status IN ('running', 'paused')");
    });

    it('research_sessions 의 pending/running 을 failed 로 마킹한다', async () => {
        // Deep Research 는 큐·워커 없이 in-process 로 돌기 때문에, 재시작 후 이 상태를
        // 이어받는 주체가 없다. resume 이 없어 error 컬럼도 없으므로 status/completed_at 만 정리.
        const { pool, queries } = fakePool();

        await initSchema(pool);

        const sql = queries.find(q => q.includes('UPDATE research_sessions'));
        expect(sql).toBeDefined();
        expect(sql).toContain("status = 'failed'");
        expect(sql).toContain("status IN ('pending', 'running')");
    });
});

describe('initSchema — 실행 소유권(176)이 있으면 다른 서버의 실행 중 작업은 건드리지 않는다', () => {
    it('소유권이 없거나, 내 것이거나, 지난 작업만 failed 로 마킹한다', async () => {
        const { pool, queries } = fakePool();
        await initSchema(pool);
        const sql = queries.find(q => q.includes('UPDATE agent_tasks') && q.includes("'server restarted'"))!;
        expect(sql).toContain('lease_owner IS NULL');
        expect(sql).toContain(`lease_owner = '${leaseOwner()}'`);
        expect(sql).toContain('lease_until < NOW()');
    });

    it('소유권 컬럼이 아직 없으면(176 적용 전 부팅) 종전 조건으로 마킹한다', async () => {
        const queries: string[] = [];
        const pool = {
            query: jest.fn(async (sql: unknown) => {
                queries.push(String(sql));
                if (String(sql).includes('SELECT lease_owner')) throw new Error('column "lease_owner" does not exist');
                return { rowCount: 0, rows: [] };
            }),
        } as unknown as Pool;
        await initSchema(pool);
        const sql = queries.find(q => q.includes('UPDATE agent_tasks') && q.includes("'server restarted'"))!;
        expect(sql).toBeDefined();
        expect(sql).not.toContain('lease_owner');
    });
});
