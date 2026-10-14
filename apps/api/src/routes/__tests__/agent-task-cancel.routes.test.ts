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
jest.mock('../../services/task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => ({ closeTask: jest.fn() }) }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));

import { cancelRouter } from '../agent-task-cancel.routes';
import { resolveCancelTarget } from '../agent-task-chain';

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
        expect(updateAgentTask).toHaveBeenCalledWith('s2', { status: 'cancelled' });
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
