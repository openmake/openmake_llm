/**
 * delegate 팩토리 — 서브에이전트 체크포인트 불러오기·삭제 순서.
 * 주차로 끝나면 체크포인트를 남기고 AgentTaskParked 를 그대로 올린다. 정상 종료면 지운다.
 */
jest.mock('../../../agents/keyword-router', () => ({ routeToAgent: async () => ({ primaryAgent: 'general' }) }));
jest.mock('../../../agents/system-prompt', () => ({ getAgentSystemMessage: async () => ({ prompt: 'persona' }) }));
const runSubagent = jest.fn();
jest.mock('../subagent', () => ({ runSubagent: (...a: unknown[]) => runSubagent(...a) }));
const repo = { loadCheckpoint: jest.fn(), saveCheckpoint: jest.fn(async () => undefined), deleteCheckpoint: jest.fn(async () => undefined), add: jest.fn(async () => undefined) };
jest.mock('../../../data/repositories/agent-task-subagent-step-repository', () => ({ AgentTaskSubagentStepRepository: jest.fn().mockImplementation(() => repo) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }), getPool: () => ({}) }));

import { buildDelegateFn, subagentCheckpointKey } from '../delegate';
import { AgentTaskParked } from '../types';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

const limits = AGENT_TASK_LIMITS as { SUBAGENT_ENABLED: boolean };
const original = limits.SUBAGENT_ENABLED;
beforeAll(() => { limits.SUBAGENT_ENABLED = true; });
afterAll(() => { limits.SUBAGENT_ENABLED = original; });
beforeEach(() => { jest.clearAllMocks(); });

const fn = () => buildDelegateFn({
    client: {} as never, userId: 'u1', taskId: 't1', userCtx: { userId: 'u1' } as never,
    sandboxCfg: { extraTools: [] } as never, mcpTools: [], signal: new AbortController().signal,
    onTokens: () => undefined, onPausedMs: () => undefined,
});

describe('buildDelegateFn — 서브에이전트 체크포인트', () => {
    it('같은 위임(목표·역할)은 같은 키, 다르면 다른 키', () => {
        expect(subagentCheckpointKey('목표', 'finance')).toBe(subagentCheckpointKey('목표', 'finance'));
        expect(subagentCheckpointKey('목표', 'finance')).not.toBe(subagentCheckpointKey('목표', undefined));
    });

    it('체크포인트가 없으면 처음부터 실행하고, 끝나면 체크포인트를 지운다', async () => {
        repo.loadCheckpoint.mockResolvedValue(null);
        runSubagent.mockResolvedValue('결과');
        await expect(fn()('목표', 'finance')).resolves.toContain('결과');
        expect(runSubagent.mock.calls[0][0].park.restored).toBeUndefined();
        expect(repo.deleteCheckpoint).toHaveBeenCalledWith('t1', subagentCheckpointKey('목표', 'finance'));
    });

    it('체크포인트가 있으면 저장된 대화로 재개한다', async () => {
        const state = { conversation: [{ role: 'user', content: 'x' }], turn: 1, tokens: 7 };
        repo.loadCheckpoint.mockResolvedValue({ ...state, trace_id: 'tr-1', trace_seq: 4 });
        runSubagent.mockResolvedValue('이어서 끝');
        await fn()('목표');
        expect(runSubagent.mock.calls[0][0].park.restored).toEqual(state);
    });

    it('주차로 끝나면 체크포인트를 남기고 AgentTaskParked 를 그대로 올린다', async () => {
        repo.loadCheckpoint.mockResolvedValue(null);
        runSubagent.mockImplementation(async (p: { park: { save(s: unknown): Promise<void> } }) => {
            await p.park.save({ conversation: [], turn: 0, tokens: 1 });
            throw new AgentTaskParked();
        });
        await expect(fn()('목표')).rejects.toBeInstanceOf(AgentTaskParked);
        expect(repo.saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ task_id: 't1', ckpt_key: subagentCheckpointKey('목표', undefined), turn: 0, tokens: 1 }));
        expect(repo.deleteCheckpoint).not.toHaveBeenCalled();
    });

    it('빈 껍데기 목표는 서브를 돌리지 않고 이유를 돌려준다', async () => {
        await expect(fn()('위 작업 계속')).resolves.toMatch(/^Error: [\s\S]*맥락/);
        expect(runSubagent).not.toHaveBeenCalled();
        expect(repo.loadCheckpoint).not.toHaveBeenCalled();
    });

    it('결과 끝에 자가 보고 안내를 붙인다', async () => {
        repo.loadCheckpoint.mockResolvedValue(null);
        runSubagent.mockResolvedValue('결과');
        const out = await fn()('목표');
        expect(out.startsWith('결과\n\n')).toBe(true);
        expect(out).toContain('자가 보고');
    });

    it('승인 대기 훅을 서브에이전트에 그대로 넘긴다(부모 상태 paused↔running)', async () => {
        repo.loadCheckpoint.mockResolvedValue(null);
        runSubagent.mockResolvedValue('결과');
        const onApprovalPending = jest.fn();
        const onApprovalDecided = jest.fn();
        await buildDelegateFn({
            client: {} as never, userId: 'u1', taskId: 't1', userCtx: { userId: 'u1' } as never,
            sandboxCfg: { extraTools: [] } as never, mcpTools: [], signal: new AbortController().signal,
            onTokens: () => undefined, onPausedMs: () => undefined, onApprovalPending, onApprovalDecided,
        })('목표');
        expect(runSubagent.mock.calls[0][0]).toMatchObject({ onApprovalPending, onApprovalDecided });
    });

});
