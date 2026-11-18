/**
 * 작업 취소(188 체인) — 루트·앞 세그먼트 id 로 취소해도 실제로 돌고 있는 세그먼트를 멈추고 루트에 표식을 남긴다(설계 §2.4).
 */
import express from 'express';
import request from 'supertest';

const rows: Record<string, Record<string, unknown>> = {};
const getAgentTask = jest.fn(async (id: string) => rows[id]);
const updateAgentTask = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getAgentTask, updateAgentTask }), getPool: () => ({}) }));
const listChain = jest.fn();
const markChainCancelled = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => ({ listChain, markChainCancelled })) }));
const cancel = jest.fn();
jest.mock('../../services/AgentTaskService', () => ({ AgentTaskService: { cancel: (id: string) => cancel(id) } }));
const cancelPending = jest.fn().mockReturnValue(false);
jest.mock('../../services/agent-task/task-queue', () => ({ getAgentTaskQueue: () => ({ cancelPending }) }));
const closeTask = jest.fn();
jest.mock('../../services/task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => ({ closeTask }) }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));

import { cancelRouter } from '../agent-task-cancel.routes';
import { resolveCancelTarget } from '../agent-task-chain';
import { AgentTaskTransitionError } from '../../services/agent-task/task-state';

const app = express().use((req, _res, next) => { (req as unknown as { user: unknown }).user = { id: 'u1', role: 'user' }; next(); }).use('/api/agent-tasks', cancelRouter);
type Segs = Parameters<typeof resolveCancelTarget>[1];
const seg = (id: string, status: string) => ({ id, status, user_id: 'u1', chain_root_task_id: 'root' });

describe('resolveCancelTarget', () => {
    const segments = [{ id: 'root', status: 'completed' }, { id: 's1', status: 'completed' }, { id: 's2', status: 'running' }] as Segs;
    it('끝난 루트·앞 세그먼트로 요청하면 끝나지 않은 세그먼트', () => {
        expect(resolveCancelTarget({ id: 'root', status: 'completed', chain_root_task_id: 'root' }, segments)).toBe('s2');
        expect(resolveCancelTarget({ id: 's1', status: 'completed', chain_root_task_id: 'root' }, segments)).toBe('s2');
    });
    it('요청 작업이 아직 돌고 있거나 체인이 아니거나 끝나지 않은 세그먼트가 없으면 요청 작업 그대로', () => {
        expect(resolveCancelTarget({ id: 's2', status: 'running', chain_root_task_id: 'root' }, segments)).toBe('s2');
        expect(resolveCancelTarget({ id: 'x', status: 'completed', chain_root_task_id: null }, segments)).toBe('x');
        expect(resolveCancelTarget({ id: 'root', status: 'completed', chain_root_task_id: 'root' }, [{ id: 'root', status: 'completed' }] as Segs)).toBe('root');
    });
});

describe('POST /:taskId/cancel — 승인 정리 순서', () => {
    beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(rows)) delete rows[k]; });
    it('실행 중이 아닌 작업은 closeTask(미소비 승인 무효화)가 끝난 뒤에 응답한다', async () => {
        rows.q = { id: 'q', status: 'queued', user_id: 'u1' };
        cancel.mockReturnValue(false);
        let release!: () => void;
        let closed = false;
        closeTask.mockImplementationOnce(() => new Promise<void>((r) => { release = () => { closed = true; r(); }; }));
        const pending = request(app).post('/api/agent-tasks/q/cancel').then((res) => ({ res, closedAtResponse: closed }));
        await new Promise((r) => setTimeout(r, 30));
        expect(closeTask).toHaveBeenCalledWith('q');
        release();
        const { res, closedAtResponse } = await pending;
        expect(res.status).toBe(200);
        expect(closedAtResponse).toBe(true);
    });
    it('closeTask(미소비 승인 무효화)가 끝나기 전에는 cancelled 를 저장하지 않는다 — 저장이 늦어도 병렬 /resume 이 옛 승인을 이어받지 않게', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        cancel.mockReturnValue(false);
        let release!: () => void;
        closeTask.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
        let saveCancelled!: () => void;
        updateAgentTask.mockImplementationOnce(() => new Promise<void>((r) => { saveCancelled = r; }));
        const pending = request(app).post('/api/agent-tasks/p/cancel');
        void pending.then(() => undefined);
        await new Promise((r) => setTimeout(r, 30));
        expect(closeTask).toHaveBeenCalledWith('p');
        expect(updateAgentTask).not.toHaveBeenCalled();   // 무효화 전에는 재실행 가능한 상태(cancelled)가 공개되지 않는다
        release();
        await new Promise((r) => setTimeout(r, 30));
        expect(updateAgentTask).toHaveBeenCalledWith('p', { status: 'cancelled', onlyFrom: ['paused'] });   // 조건부 — 정리 중 claim 됐으면 덮어쓰지 않는다
        saveCancelled();
        expect((await pending).status).toBe(200);
    });
});

describe('POST /:taskId/cancel — 정리 중 재개 claim 과의 경쟁(Fable r3 P3)', () => {
    beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(rows)) delete rows[k]; });
    const claimedMeanwhile = () => updateAgentTask.mockRejectedValueOnce(new AgentTaskTransitionError('p', 'pending', 'cancelled'));
    it('정리 중 다른 경로가 claim 해 실행됐으면 cancelled 로 덮어쓰지 않고 실행 중 작업에 취소 신호를 보낸다', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        cancel.mockReturnValueOnce(false).mockReturnValueOnce(true);
        claimedMeanwhile();
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(200);
        expect(cancel).toHaveBeenCalledTimes(2);
        expect(res.body.data.message).toBe('작업 취소를 요청했습니다.');
    });
    it('claim 됐지만 아직 실행이 등록되지 않았으면 409 — 다시 취소하게', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        cancel.mockReturnValue(false);
        claimedMeanwhile();
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(409);
    });
    it('전이 거부가 아닌 저장 실패는 그대로 오류', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        cancel.mockReturnValue(false);
        updateAgentTask.mockRejectedValueOnce(new Error('db down'));
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(500);
    });
});

describe('POST /:taskId/cancel — 체인', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const k of Object.keys(rows)) delete rows[k];
        rows.root = seg('root', 'completed'); rows.s1 = seg('s1', 'completed'); rows.s2 = seg('s2', 'running');
        listChain.mockResolvedValue([rows.root, rows.s1, rows.s2]);
    });
    it('루트 id 로 취소하면 루트에 표식을 남기고 돌고 있는 세그먼트에 중단 신호 — 200', async () => {
        cancel.mockReturnValue(true);
        const res = await request(app).post('/api/agent-tasks/root/cancel');
        expect(res.status).toBe(200);
        expect(markChainCancelled).toHaveBeenCalledWith('root');
        expect(cancel).toHaveBeenCalledWith('s2');
        expect(res.body.data.taskId).toBe('s2');
    });
    it('앞 세그먼트 id 로 취소해도, 레지스트리에 없으면 DB 상태로 정리 — 대상은 끝나지 않은 세그먼트', async () => {
        cancel.mockReturnValue(false);
        const res = await request(app).post('/api/agent-tasks/s1/cancel');
        expect(res.status).toBe(200);
        expect(cancelPending).toHaveBeenCalledWith('s2');
        expect(updateAgentTask).toHaveBeenCalledWith('s2', { status: 'cancelled', onlyFrom: ['running'] });
        expect(updateAgentTask).not.toHaveBeenCalledWith('root', expect.anything());
    });
    it('체인이 이미 끝났으면(끝나지 않은 세그먼트 없음) 종전처럼 400', async () => {
        rows.s2 = seg('s2', 'completed');
        listChain.mockResolvedValue([rows.root, rows.s1, rows.s2]);
        cancel.mockReturnValue(false);
        const res = await request(app).post('/api/agent-tasks/root/cancel');
        expect(res.status).toBe(400);
        expect(cancel).toHaveBeenCalledWith('root');
    });
    it('체인이 아닌 작업은 종전과 같다(체인 목록을 읽지 않는다)', async () => {
        rows.t = { id: 't', status: 'running', user_id: 'u1' };
        cancel.mockReturnValue(true);
        const res = await request(app).post('/api/agent-tasks/t/cancel');
        expect(res.status).toBe(200);
        expect(cancel).toHaveBeenCalledWith('t');
        expect(listChain).not.toHaveBeenCalled();
        expect(markChainCancelled).not.toHaveBeenCalled();
    });
});

describe('POST /:taskId/cancel — 미소비 승인 무효화', () => {
    beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(rows)) delete rows[k]; cancel.mockReturnValue(false); });
    it('대기열(queued) 작업 취소도 closeTask 를 부른다 — 자리가 없어 주차로 넘긴 미소비 승인이 다시 쓰이지 않게', async () => {
        rows.q = { id: 'q', status: 'queued', user_id: 'u1' };
        cancelPending.mockReturnValueOnce(true);
        const res = await request(app).post('/api/agent-tasks/q/cancel');
        expect(res.status).toBe(200);
        expect(updateAgentTask).toHaveBeenCalledWith('q', { status: 'cancelled', onlyFrom: expect.arrayContaining(['queued']) });
        expect(closeTask).toHaveBeenCalledWith('q');
    });
    it('대기열에서 꺼냈으면(dequeued) 읽은 뒤 바뀐 pending·queued 에서도 취소한다 — 꺼낸 항목 없는 고아 queued 행을 남기지 않게(Fable r4 P3)', async () => {
        // 읽은 시점은 paused, 그 뒤 주차 재개가 claim(pending)·dispatch(queued)해 대기열에 넣은 것을 이 요청이 꺼냈다
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        cancelPending.mockReturnValueOnce(true);
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(200);
        const opts = updateAgentTask.mock.calls[0][1] as { onlyFrom: string[] };
        expect([...opts.onlyFrom].sort()).toEqual(['paused', 'pending', 'queued']);
    });
    it('대기열에서 꺼내지 않았으면 읽은 상태에서만 취소한다(종전)', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(200);
        expect(updateAgentTask).toHaveBeenCalledWith('p', { status: 'cancelled', onlyFrom: ['paused'] });
    });
    it('주차(paused) 작업 취소는 종전대로 closeTask', async () => {
        rows.p = { id: 'p', status: 'paused', user_id: 'u1' };
        const res = await request(app).post('/api/agent-tasks/p/cancel');
        expect(res.status).toBe(200);
        expect(closeTask).toHaveBeenCalledWith('p');
    });
});
