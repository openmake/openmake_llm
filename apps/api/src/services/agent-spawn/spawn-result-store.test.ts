/**
 * spawn_agents 끝난 서브 결과의 즉시 기록·재사용.
 * fan-out 도중 서버가 재시작되면 부모가 같은 spawn_agents 호출을 다시 실행한다 — 이미 끝난 서브는 다시 돌리지 않는다.
 */
import type { ToolDefinition } from '../../llm/types';

/** agent_task_subagent_checkpoints 대역 — `${taskId}/${ckptKey}` → 행. */
const mockRows = new Map<string, { conversation: unknown[]; created_at?: Date }>();
const mockRepo = {
    saveCheckpoint: jest.fn(async (row: { task_id: string; ckpt_key: string; conversation: unknown[] }) => { mockRows.set(`${row.task_id}/${row.ckpt_key}`, row); }),
    loadCheckpoint: jest.fn(async (taskId: string, key: string) => mockRows.get(`${taskId}/${key}`) ?? null),
    deleteCheckpoint: jest.fn(async (taskId: string, key: string) => { mockRows.delete(`${taskId}/${key}`); }),
    add: jest.fn(async () => undefined),
};
jest.mock('../../data/repositories/agent-task-subagent-step-repository', () => ({ AgentTaskSubagentStepRepository: jest.fn().mockImplementation(() => mockRepo) }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }), getPool: () => ({}) }));
jest.mock('../task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ isAutoApprove: () => false }),
}));
const runSubagentMock = jest.fn();
jest.mock('../agent-task/subagent', () => ({ runSubagent: (p: unknown) => runSubagentMock(p) }));
jest.mock('../../llm', () => ({ createClient: jest.fn(() => ({})) }));

import { runSpawnAgents } from './spawn-agents';
import { SpawnResultStore, spawnResultKey } from './spawn-result-store';
import { AGENT_DELEGATION } from '../../config/agent-task-delegation';

const tool: ToolDefinition = { type: 'function', function: { name: 'web_search', description: '', parameters: { type: 'object', properties: {} } } };
const base = {
    client: {} as never, tools: [tool], userCtx: { userId: 'u1', role: 'user' } as never, taskId: 't1',
    sandboxCfg: { approvalPolicy: 'none' as const, approvalTimeoutMs: 0 },
};
const A = { prompt: '서울 9월 강수량을 조사해 요약' };
const B = { prompt: '부산 9월 강수량을 조사해 요약' };

beforeEach(() => {
    jest.clearAllMocks();
    mockRows.clear();
});

describe('spawnResultKey', () => {
    it('같은 지시·역할·에이전트면 같은 키, 하나라도 다르면 다른 키', () => {
        expect(spawnResultKey({ prompt: 'p', role: 'r' })).toBe(spawnResultKey({ prompt: 'p', role: 'r' }));
        expect(spawnResultKey({ prompt: 'p', role: 'r' })).not.toBe(spawnResultKey({ prompt: 'p' }));
        expect(spawnResultKey({ prompt: 'p' })).not.toBe(spawnResultKey({ prompt: 'p', agentId: 'a1' }));
    });
});

describe('SpawnResultStore', () => {
    it('저장한 결과와 종료 사유를 그대로 읽는다', async () => {
        const store = new SpawnResultStore('t1');
        await store.save(A, { result: '서울 결과', exit: 'completed' });
        await expect(store.load(A)).resolves.toEqual({ result: '서울 결과', exit: 'completed' });
        await expect(store.load(B)).resolves.toBeNull();
    });

    it('형태가 다른 행(주차된 delegate 대화 등)은 결과로 읽지 않는다', async () => {
        mockRows.set(`t1/${spawnResultKey(A)}`, { conversation: [{ role: 'user', content: 'x' }] });
        await expect(new SpawnResultStore('t1').load(A)).resolves.toBeNull();
    });

    it('기록 시각이 만료 시간을 넘긴 결과는 재사용하지 않는다 — 한참 뒤의 같은 지시에 낡은 결과를 주지 않는다', async () => {
        const stored = { result: '서울 결과', exit: 'completed' };
        const age = (ms: number): Date => new Date(Date.now() - ms);
        mockRows.set(`t1/${spawnResultKey(A)}`, { conversation: [stored], created_at: age(AGENT_DELEGATION.RESULT_REUSE_MAX_AGE_MS + 60_000) });
        mockRows.set(`t1/${spawnResultKey(B)}`, { conversation: [stored], created_at: age(AGENT_DELEGATION.RESULT_REUSE_MAX_AGE_MS - 60_000) });
        const store = new SpawnResultStore('t1');
        await expect(store.load(A)).resolves.toBeNull();
        await expect(store.load(B)).resolves.toEqual(stored);
    });

    it('만료 기본값은 6시간이다', () => {
        expect(AGENT_DELEGATION.RESULT_REUSE_MAX_AGE_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('저장소가 죽어도 던지지 않는다 — 기록은 실행을 막지 않는다', async () => {
        mockRepo.saveCheckpoint.mockRejectedValueOnce(new Error('db down'));
        mockRepo.loadCheckpoint.mockRejectedValueOnce(new Error('db down'));
        const store = new SpawnResultStore('t1');
        await expect(store.save(A, { result: 'x', exit: 'completed' })).resolves.toBeUndefined();
        await expect(store.load(A)).resolves.toBeNull();
    });
});

describe('runSpawnAgents — 끝난 서브 결과 재사용', () => {
    it('도중에 중단된 fan-out 을 다시 실행하면 끝난 서브는 돌리지 않고 저장된 결과를 쓴다', async () => {
        // 1차: A 는 끝나고, B 가 도는 중에 서버가 내려간다(상위 중단).
        const shutdown = new AbortController();
        runSubagentMock.mockImplementation(async (p: { subgoal: string; onExit: (r: string) => void }) => {
            if (p.subgoal === A.prompt) { p.onExit('completed'); return '서울 결과'; }
            shutdown.abort();
            p.onExit('error');
            return 'Error: 상위 작업이 중단되었습니다.';
        });
        await runSpawnAgents({ ...base, signal: shutdown.signal, args: { tasks: [A, B] } });
        expect([...mockRows.keys()]).toEqual([`t1/${spawnResultKey(A)}`]);

        // 2차(재개): 같은 호출이 다시 온다 — B 만 돈다.
        runSubagentMock.mockReset();
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { p.onExit('completed'); return '부산 결과'; });
        const out = await runSpawnAgents({ ...base, args: { tasks: [A, B] } });
        expect(runSubagentMock).toHaveBeenCalledTimes(1);
        expect(runSubagentMock.mock.calls[0][0].subgoal).toBe(B.prompt);
        expect(out).toContain('[종료 사유: 정상 완료 · 이전 실행 결과 재사용]\n서울 결과');
        expect(out).toContain('[종료 사유: 정상 완료]\n부산 결과');
        // fan-out 이 끝났으니 기록을 지운다 — 뒤의 다른 호출이 낡은 결과를 쓰지 않게.
        expect(mockRows.size).toBe(0);
    });

    it('만료된 기록이 남아 있으면 그 서브를 다시 돌린다', async () => {
        mockRows.set(`t1/${spawnResultKey(A)}`, {
            conversation: [{ result: '낡은 서울 결과', exit: 'completed' }],
            created_at: new Date(Date.now() - AGENT_DELEGATION.RESULT_REUSE_MAX_AGE_MS - 60_000),
        });
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { p.onExit('completed'); return '새 서울 결과'; });
        const out = await runSpawnAgents({ ...base, args: { tasks: [A] } });
        expect(runSubagentMock).toHaveBeenCalledTimes(1);
        expect(out).toContain('새 서울 결과');
        expect(out).not.toContain('낡은 서울 결과');
        expect(out).not.toContain('이전 실행 결과 재사용');
    });

    it('오류·시간 초과로 끝난 서브는 기록하지 않는다 — 재개 때 다시 돈다', async () => {
        const shutdown = new AbortController();
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { shutdown.abort(); p.onExit('timeout'); return 'Error: 서브에이전트 실행 실패 — Request timed out.'; });
        await runSpawnAgents({ ...base, signal: shutdown.signal, args: { tasks: [A] } });
        expect(mockRepo.saveCheckpoint).not.toHaveBeenCalled();
    });

    it('채팅 경로(작업 행 없음)와 끈 설정에서는 기록하지 않는다', async () => {
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { p.onExit('completed'); return '결과'; });
        await runSpawnAgents({ ...base, taskId: '__chat__', args: { tasks: [A] } });
        const flags = AGENT_DELEGATION as { RESULT_REUSE_ENABLED: boolean };
        flags.RESULT_REUSE_ENABLED = false;
        try { await runSpawnAgents({ ...base, args: { tasks: [A] } }); } finally { flags.RESULT_REUSE_ENABLED = true; }
        expect(mockRepo.saveCheckpoint).not.toHaveBeenCalled();
        expect(mockRepo.loadCheckpoint).not.toHaveBeenCalled();
    });
});
