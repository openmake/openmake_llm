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

// 종료 알림 표식(174) — 정상 종료가 남긴 'server restarted' 행은 표식을 이미 갖고 있고, 그 알림이 나간 뒤 1분 안에 다시 뜨면
// 시간 조건만으로는 표식이 또 서서 같은 알림이 두 번 나간다. 이번 부팅이 방금 마킹한 행에만 세운다.
describe('initSchema — 종료 알림 표식은 이번 부팅이 마킹한 작업에만 세운다', () => {
    it('좀비 마킹이 돌려준 id 로만 표식을 세운다', async () => {
        const calls: Array<{ sql: string; params?: unknown[] }> = [];
        const pool = {
            query: jest.fn(async (sql: unknown, params?: unknown[]) => {
                calls.push({ sql: String(sql), params });
                const marking = String(sql).includes('UPDATE agent_tasks') && String(sql).includes("error = 'server restarted', completed_at = NOW()");
                return marking ? { rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] } : { rowCount: 0, rows: [] };
            }),
        } as unknown as Pool;
        await initSchema(pool);
        const flag = calls.find(c => c.sql.includes('terminal_notify_pending = TRUE'))!;
        expect(flag.sql).toContain('id = ANY($1)');
        expect(flag.sql).not.toContain("INTERVAL '1 minute'");
        expect(flag.params).toEqual([['a', 'b']]);
    });

    it('마킹한 작업이 없으면 표식을 세우지 않는다', async () => {
        const { pool, queries } = fakePool();
        await initSchema(pool);
        expect(queries.some(q => q.includes('terminal_notify_pending = TRUE'))).toBe(false);
    });
});

