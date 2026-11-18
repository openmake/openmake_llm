/**
 * 승인 대기 슬롯 양보 — task 도구 경로(TaskRuntime)의 회귀(r4). 결정 때 자리가 없으면 결정을 저장한 뒤 주차하는데,
 * "저장 대기 → 취소 → 저장 실패" 면 취소된 작업의 도구가 실행되면 안 된다(호출부는 승인 뒤 중단 신호를 다시 보지 않는다).
 * 실제 ApprovalRegistry(가짜 저장소 + 자리 없는 가짜 slots)로 TaskRuntime 의 승인 대상 도구를 돌린다.
 */
import { __setChatTurnIntegrationsForTest } from '../../chat-service/turn-integrations';
import { ApprovalRegistry, type PendingApproval } from '../approval-gate';

let mockRegistry: ApprovalRegistry | undefined;
jest.mock('../approval-gate', () => ({
    ...jest.requireActual('../approval-gate'),
    getApprovalRegistry: () => mockRegistry,
}));
jest.mock('../../../data/models/unified-database', () => ({
    ...jest.requireActual('../../../data/models/unified-database'),
    getPool: jest.fn(() => ({ query: async () => ({ rows: [], rowCount: 0 }) })),
}));

import { TaskRuntime } from '../runtime';
import { waitFor } from './helpers/wait-for';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import { AgentTaskParked } from '../../agent-task/types';
import type { TaskExecutor, ExecResult } from '../executor';

beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 });

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function setup() {
    const store = {
        insertPending: jest.fn(async () => undefined), markDecided: jest.fn(async (..._a: unknown[]): Promise<boolean> => true),
        listPending: jest.fn(async () => []), getPending: jest.fn(async () => undefined), takeoverForCall: jest.fn(async () => undefined),
        expirePendingForTask: jest.fn(async () => undefined), extendPending: jest.fn(async () => true),
    };
    const slots = { yieldSlot: jest.fn(), tryReclaimSlot: jest.fn(() => false), forceReclaimSlot: jest.fn(), resumeAfterRelease: jest.fn() };
    mockRegistry = new ApprovalRegistry(store, slots);
    const exec = jest.fn(async (..._a: unknown[]) => ok('done'));
    const executor = { taskId: 't', label: 'test', localWorkdir: null, isBrowserEnabled: false, browserStatePath: null, exec } as unknown as TaskExecutor;
    const runtime = new TaskRuntime('t-save', 'u1', { ...getTaskSandboxConfig(), approvalPolicy: 'all' }, undefined, undefined, executor, '작업');
    const hooks = { onBeforeExecute: jest.fn(async () => undefined), onApprovalRejected: jest.fn() };
    return { store, slots, exec, runtime, hooks };
}

/** 승인 대상 task 도구(bash)를 부르고 카드가 뜰 때까지 기다린다. */
async function callBash(t: ReturnType<typeof setup>, signal?: AbortSignal) {
    let pending: PendingApproval | undefined;
    const result = t.runtime.executeTaskTool('bash', { command: 'echo hi' }, {
        signal, onApprovalPending: (p) => { pending = p; }, ...t.hooks,
    }).then((r) => r, (e: unknown) => e);
    await waitFor(() => pending, '승인 대기 등록');
    expect(t.slots.yieldSlot).toHaveBeenCalledWith('t-save');
    return { result, id: pending!.approvalId };
}

describe('TaskRuntime — 결정 때 자리가 없을 때', () => {
    it('자리 없음 + 승인: parked → 도구 핸들러 0회, AgentTaskParked', async () => {
        const t = setup();
        const { result, id } = await callBash(t);
        await mockRegistry!.approve(id);
        expect(await result).toBeInstanceOf(AgentTaskParked);
        expect(t.exec).not.toHaveBeenCalled();
        expect(t.hooks.onBeforeExecute).not.toHaveBeenCalled();
        expect(t.slots.resumeAfterRelease).toHaveBeenCalledWith('t-save');
    });

    it.each([
        ['예외', (d: ReturnType<typeof deferred<boolean>>) => d.reject(new Error('db down'))],
        ['false', (d: ReturnType<typeof deferred<boolean>>) => d.resolve(false)],
    ] as const)('저장 대기 → 취소 → 저장 실패(%s) → 도구 핸들러 실행 0회', async (_n, fail) => {
        const t = setup();
        const save = deferred<boolean>();
        t.store.markDecided.mockReturnValueOnce(save.promise);
        const ac = new AbortController();
        const { result, id } = await callBash(t, ac.signal);
        await mockRegistry!.approve(id);
        ac.abort();
        fail(save);
        await result;
        expect(t.exec).not.toHaveBeenCalled();
        expect(t.hooks.onBeforeExecute).not.toHaveBeenCalled();
        expect(t.hooks.onApprovalRejected).toHaveBeenCalledWith({ toolName: 'bash', reason: 'abort' });
        expect(t.slots.forceReclaimSlot).not.toHaveBeenCalled();
        expect(t.slots.resumeAfterRelease).not.toHaveBeenCalled();
    });

    it('대조군: 취소 없이 저장 실패 → 상한을 넘겨 그 자리에서 실행(핸들러 1회)', async () => {
        const t = setup();
        t.store.markDecided.mockRejectedValueOnce(new Error('db down'));
        const { result, id } = await callBash(t);
        await mockRegistry!.approve(id);
        await result;
        expect(t.slots.forceReclaimSlot).toHaveBeenCalledTimes(1);
        expect(t.hooks.onBeforeExecute).toHaveBeenCalledTimes(1);
        expect(t.exec).toHaveBeenCalledTimes(1);
    });
});

describe('TaskRuntime — 결정 이어받기 중 취소(abort 우선)', () => {
    it('takeoverForCall 대기 → 취소 → 미소비 승인 도착 → 도구 핸들러 실행 0회', async () => {
        const t = setup();
        const takeover = deferred<unknown>();
        (t.store.takeoverForCall as jest.Mock).mockReturnValueOnce(takeover.promise);
        const ac = new AbortController();
        const result = t.runtime.executeTaskTool('bash', { command: 'echo hi' }, { signal: ac.signal, ...t.hooks })
            .then((r) => r, (e: unknown) => e);
        await waitFor(() => t.store.takeoverForCall.mock.calls.length > 0 || undefined, '이어받기 시작');
        ac.abort();
        takeover.resolve({ approval_id: 'apv_prior', status: 'approved', decided_at: new Date().toISOString(), created_at: new Date().toISOString(), answer_text: null });
        await result;
        expect(t.exec).not.toHaveBeenCalled();
        expect(t.hooks.onBeforeExecute).not.toHaveBeenCalled();
        expect(t.hooks.onApprovalRejected).toHaveBeenCalledWith({ toolName: 'bash', reason: 'abort' });
    });
});
