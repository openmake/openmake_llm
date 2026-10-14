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

    it('claimContinuation 은 continued_by_task_id 가 비어 있을 때만 채우고 true', async () => {
        const query = jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [] }).mockResolvedValueOnce({ rowCount: 0, rows: [] });
        const repo = chainRepoWith(query);
        await expect(repo.claimContinuation('a', 'b')).resolves.toBe(true);
        await expect(repo.claimContinuation('a', 'c')).resolves.toBe(false);
        expect(String(query.mock.calls[0][0])).toMatch(/continued_by_task_id IS NULL/);
        expect(query.mock.calls[0][1]).toEqual(['a', 'b']);
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
