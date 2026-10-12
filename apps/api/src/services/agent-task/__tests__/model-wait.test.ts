/**
 * 모델 대기 주차 — 모델 서버가 한동안 응답하지 못하면(재시도·대기를 다 쓴 일시적 오류) 작업을 실패시키지 않고 멈춰 둔다.
 */
const markParked = jest.fn(async (..._a: unknown[]) => undefined);
const updateAgentTask = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ updateAgentTask: (...a: unknown[]) => updateAgentTask(...a) }) }));
const listParkedTasks = jest.fn();
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ markParked: (...a: unknown[]) => markParked(...a), listParkedTasks: () => listParkedTasks() })) }));
const resumeParkedTask = jest.fn(async (_id: string) => true);
jest.mock('../hitl-park', () => ({ resumeParkedTask: (id: string) => resumeParkedTask(id) }));
const unattended = new Set<string>();
jest.mock('../../task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => ({ isUnattended: (id: string) => unattended.has(id) }) }));
const loop = { MODEL_WAIT_ENABLED: true, MODEL_WAIT_MAX_MS: 60_000, MODEL_WAIT_PROBE_TIMEOUT_MS: 1000 };
jest.mock('../../../config/agent-task-turn-loop', () => ({ AGENT_TASK_TURN_LOOP: loop }));
const chat = jest.fn();
jest.mock('../../../llm', () => ({ createClient: () => ({ derive: () => ({ chat: (...a: unknown[]) => chat(...a) }) }) }));
jest.mock('../../../config/model-roles', () => ({ getModelForRole: () => 'agent-model' }));

import { parkForModelOutage, modelWaitAction, probeAgentModel, sweepModelWaitTasks, AGENT_TASK_MODEL_WAIT_EXPIRED_ERROR } from '../model-wait';
import { AgentTaskParked, AgentTaskAbort } from '../types';
import { AgentTaskTurnTimeout } from '../turn-call';
import { classifyAgentTaskFailure } from '../../../config/agent-task-failure-class';

const outage = Object.assign(new Error('503 Service Unavailable'), { status: 503 });
const ctx = () => ({ taskId: 't1', signal: new AbortController().signal, update: jest.fn(async () => undefined) });

beforeEach(() => { jest.clearAllMocks(); unattended.clear(); loop.MODEL_WAIT_ENABLED = true; resumeParkedTask.mockResolvedValue(true); });

describe('parkForModelOutage', () => {
    it('재시도를 다 쓴 일시적 모델 오류면 작업을 멈춰 두고(paused + model_wait) 주차로 끝낸다', async () => {
        const c = ctx();
        const err = await parkForModelOutage(outage, c).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AgentTaskParked);
        expect((err as Error).message).toBe('model_wait');
        expect(c.update).toHaveBeenCalledWith({ status: 'paused' });
        expect(markParked).toHaveBeenCalledWith('t1', 'model_wait');
    });

    it('연결 오류(status 없음)도 같다', async () => {
        await expect(parkForModelOutage(new Error('Connection error.'), ctx())).rejects.toBeInstanceOf(AgentTaskParked);
    });

    it.each([
        ['모델 탓이 아닌 오류(400)', Object.assign(new Error('400 bad request'), { status: 400 })],
        ['시간 예산 소진', new AgentTaskTurnTimeout(null)],
        ['토큰 상한', new AgentTaskAbort('token_limit')],
    ])('%s 는 주차하지 않고 그대로 던진다', async (_name, error) => {
        const c = ctx();
        await expect(parkForModelOutage(error, c)).rejects.toBe(error);
        expect(markParked).not.toHaveBeenCalled();
        expect(c.update).not.toHaveBeenCalled();
    });

    it('취소·종료로 중단된 실행은 주차하지 않는다', async () => {
        const ac = new AbortController(); ac.abort();
        await expect(parkForModelOutage(outage, { ...ctx(), signal: ac.signal })).rejects.toBe(outage);
        expect(markParked).not.toHaveBeenCalled();
    });

    it('무인 실행(예약)은 주차하지 않는다 — 예약은 자체 재실행 규칙이 있다', async () => {
        unattended.add('t1');
        await expect(parkForModelOutage(outage, ctx())).rejects.toBe(outage);
        expect(markParked).not.toHaveBeenCalled();
    });

    it('꺼져 있으면 종전대로 실패시킨다', async () => {
        loop.MODEL_WAIT_ENABLED = false;
        await expect(parkForModelOutage(outage, ctx())).rejects.toBe(outage);
        expect(markParked).not.toHaveBeenCalled();
    });
});

describe('modelWaitAction', () => {
    it('모델이 응답하면 재개, 아니면 상한까지 기다리고 넘기면 끝낸다', () => {
        expect(modelWaitAction({ modelUp: true, waitedMs: 999_999, maxMs: 60_000 })).toBe('resume');
        expect(modelWaitAction({ modelUp: false, waitedMs: 1000, maxMs: 60_000 })).toBe('wait');
        expect(modelWaitAction({ modelUp: false, waitedMs: 60_001, maxMs: 60_000 })).toBe('expire');
    });
});

describe('probeAgentModel', () => {
    it('모델이 답하면 true, 오류면 false(던지지 않는다)', async () => {
        chat.mockResolvedValueOnce({ content: 'ok' });
        await expect(probeAgentModel()).resolves.toBe(true);
        chat.mockRejectedValueOnce(outage);
        await expect(probeAgentModel()).resolves.toBe(false);
    });
});

describe('sweepModelWaitTasks', () => {
    const row = (over: Record<string, unknown>) => ({ id: 't1', reason: 'model_wait', waited_ms: '1000', ...over });

    it('모델 대기 작업이 없으면 모델을 확인하지 않는다', async () => {
        listParkedTasks.mockResolvedValue([{ id: 'x', reason: 'hitl_parked', waited_ms: '1' }]);
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 0, expired: 0 });
        expect(chat).not.toHaveBeenCalled();
    });

    it('모델이 응답하면 재개한다(여러 건이어도 확인은 한 번, 다른 사유의 주차는 건드리지 않는다)', async () => {
        chat.mockResolvedValue({ content: 'ok' });
        listParkedTasks.mockResolvedValue([row({}), row({ id: 't2' }), { id: 'x', reason: 'device_wait', waited_ms: '1' }]);
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 2, expired: 0 });
        expect(chat).toHaveBeenCalledTimes(1);
        expect(resumeParkedTask.mock.calls.map(([id]) => id)).toEqual(['t1', 't2']);
    });

    it('모델이 아직 응답하지 않고 상한 안이면 그대로 둔다', async () => {
        chat.mockRejectedValue(outage);
        listParkedTasks.mockResolvedValue([row({})]);
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 0, expired: 0 });
        expect(resumeParkedTask).not.toHaveBeenCalled();
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('응답하지 않는 채 상한을 넘기면 model_wait_expired 로 실패시키고 알림 표식을 남긴다', async () => {
        chat.mockRejectedValue(outage);
        listParkedTasks.mockResolvedValue([row({ waited_ms: '60001' })]);
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 0, expired: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', { status: 'failed', error: 'model_wait_expired', terminalNotifyPending: true });
    });

    it('조회·개별 처리 실패는 삼킨다', async () => {
        listParkedTasks.mockRejectedValueOnce(new Error('db'));
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 0, expired: 0 });
        chat.mockResolvedValue({ content: 'ok' });
        listParkedTasks.mockResolvedValue([row({}), row({ id: 't2' })]);
        resumeParkedTask.mockRejectedValueOnce(new Error('boom'));
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 1, expired: 0 });
    });
});

it('대기 상한 초과는 모델 호출 오류로 분류한다', () => {
    expect(classifyAgentTaskFailure(AGENT_TASK_MODEL_WAIT_EXPIRED_ERROR)).toBe('llm_error');
});
