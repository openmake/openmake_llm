import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskChainRepository } from '../../data/repositories/agent-task-chain-repository';

function poolWith(query: jest.Mock) {
    return { query } as unknown as import('pg').Pool;
}
function repoWith(query: jest.Mock) {
    return new AgentTaskRepository(poolWith(query));
}
function chainRepoWith(query: jest.Mock) {
    return new AgentTaskChainRepository(poolWith(query));
}

describe('AgentTaskRepository — 체인 열(188)', () => {
    it('createAgentTask 가 체인 열 네 개를 값이 있을 때만 INSERT 에 넣는다', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ id: 't1' }], rowCount: 1 });
        const repo = repoWith(query);
        await repo.createAgentTask({
            id: 't1', userId: 'u1', goal: 'g', maxTurns: 32,
            chainRootTaskId: 't1',
            longRunning: { maxDurationMs: 1, maxTotalTokens: 2, maxSegments: 3, startedAt: 4 },
        });
        const sql = String(query.mock.calls[0][0]);
        expect(sql).toContain('chain_root_task_id');
        expect(sql).toContain('long_running');
        expect(sql).not.toContain('continued_from_task_id');
        expect(sql).not.toContain('continuation');
        const params = query.mock.calls[0][1] as unknown[];
        expect(params).toContain('t1');
        expect(params).toContain(JSON.stringify({ maxDurationMs: 1, maxTotalTokens: 2, maxSegments: 3, startedAt: 4 }));
    });

    it('createAgentTask 가 후속 세그먼트의 직전 id·continuation 을 넣는다', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const continuation = { segmentIndex: 1 } as unknown as import('../../services/agent-task/types').ContinuationInfo;
        await repoWith(query).createAgentTask({ id: 's1', goal: 'g', chainRootTaskId: 'root', continuedFromTaskId: 'root', continuation });
        const sql = String(query.mock.calls[0][0]);
        expect(sql).toContain('continued_from_task_id');
        expect(sql).toContain('continuation');
        expect(sql).not.toContain('long_running');
        const params = query.mock.calls[0][1] as unknown[];
        expect(params).toContain('root');
        expect(params).toContain(JSON.stringify(continuation));
    });

    // 원자적 후속 생성(#1473) — 한 연결에서 BEGIN → 선점 → 완전한 INSERT → COMMIT. 실제 PG 의 롤백·경합은 continuation-atomicity.db.test.ts
    function txPool(claimRows: number, failInsert = false) {
        const sqls: string[] = [];
        const params: unknown[][] = [];
        const client = {
            query: jest.fn(async (sql: string, p: unknown[] = []) => {
                sqls.push(sql); params.push(p);
                if (failInsert && sql.startsWith('INSERT')) throw new Error('insert failed');
                return { rows: [], rowCount: sql.startsWith('UPDATE') ? claimRows : 1 };
            }),
            release: jest.fn(),
        };
        return { pool: { connect: async () => client } as unknown as import('pg').Pool, sqls, params, client };
    }
    const seed = {
        parentTaskId: 'a', create: { id: 'b', userId: 'u', goal: 'g', maxTurns: 32, chainRootTaskId: 'a', continuedFromTaskId: 'a' },
        checkpoint: { conversation: [], completedTurn: -1 }, plan: { items: [] }, forkedFromTurn: 7,
        approvalPolicy: 'none', thinkingLevel: 'high', lease: { owner: 'h:0', leaseMs: 60_000 },
    };

    it('createContinuationSuccessor 는 한 트랜잭션에서 선점 뒤 시드·소유권까지 담은 INSERT 를 하고 true', async () => {
        const { pool, sqls, params } = txPool(1);
        await expect(new AgentTaskRepository(pool).createContinuationSuccessor(seed)).resolves.toBe(true);
        expect(sqls[0]).toBe('BEGIN');
        expect(sqls[1]).toMatch(/continued_by_task_id IS NULL/);
        expect(params[1]).toEqual(['a', 'b']);
        expect(sqls[2]).toMatch(/^INSERT INTO agent_tasks \(.*checkpoint, forked_from_task_id, forked_from_turn, plan, approval_policy, thinking_level, lease_owner, lease_until\)/);
        expect(sqls[2]).toMatch(/NOW\(\) \+ make_interval\(secs => \$\d+\)\)$/);
        expect(params[2]).toEqual(expect.arrayContaining(['b', 'a', 7, 'none', 'high', 'h:0', 60]));
        expect(sqls[3]).toBe('COMMIT');
    });

    it('선점을 놓치면 INSERT 없이 false', async () => {
        const { pool, sqls } = txPool(0);
        await expect(new AgentTaskRepository(pool).createContinuationSuccessor(seed)).resolves.toBe(false);
        expect(sqls.some((s) => s.startsWith('INSERT'))).toBe(false);
    });

    it('INSERT 가 실패하면 ROLLBACK 하고 던진다(선점도 남지 않는다)', async () => {
        const { pool, sqls } = txPool(1, true);
        await expect(new AgentTaskRepository(pool).createContinuationSuccessor(seed)).rejects.toThrow('insert failed');
        expect(sqls.at(-1)).toBe('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
    });

    it('소유권을 끄면 소유권 열 없이 INSERT 한다', async () => {
        const { pool, sqls } = txPool(1);
        await new AgentTaskRepository(pool).createContinuationSuccessor({ ...seed, lease: undefined });
        expect(sqls[2]).not.toMatch(/lease_/);
    });

    it('resetContinuation 은 그 후속 id 일 때만 continued_by_task_id 를 비운다', async () => {
        const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
        await chainRepoWith(query).resetContinuation('a', 'b');
        const sql = String(query.mock.calls[0][0]);
        expect(sql).toMatch(/continued_by_task_id = NULL/);
        expect(sql).toMatch(/continued_by_task_id = \$2/);
        expect(query.mock.calls[0][1]).toEqual(['a', 'b']);
    });

    it('markChainCancelled 는 long_running 에 cancelled 를 병합한다', async () => {
        const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
        await chainRepoWith(query).markChainCancelled('root');
        expect(String(query.mock.calls[0][0])).toMatch(/long_running\s*=\s*COALESCE\(long_running, '\{\}'::jsonb\)\s*\|\|/);
        expect(query.mock.calls[0][1]).toEqual(['root']);
    });

    it('listChain 은 루트 id 로 created_at 오름차순 조회', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ id: 'root' }, { id: 's1' }], rowCount: 2 });
        const rows = await chainRepoWith(query).listChain('root');
        expect(rows.map((r) => r.id)).toEqual(['root', 's1']);
        expect(String(query.mock.calls[0][0])).toMatch(/WHERE chain_root_task_id = \$1 ORDER BY created_at ASC/);
    });
});
