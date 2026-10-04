/**
 * 샌드박스를 쓰기로 한 작업이 샌드박스를 받지 못했을 때 — 상한이면 기다리고, 끝내 못 만들면 숨기지 않는다.
 */
const addAgentTaskStep = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep }) }));

import {
    createSandboxWaiting, handleSandboxUnavailable, withSandboxUnavailableFootnote, withSandboxUnavailableJudgeNote,
    clearSandboxUnavailable, SANDBOX_UNAVAILABLE_ERROR,
} from '../sandbox-unavailable';
import { TaskSandboxCapacityError } from '../../task-sandbox/sandbox';
import { getSandboxUnavailableConfig } from '../../../config/task-sandbox';
import { getSandboxUnavailableSystemNotice, getSandboxUnavailableFootnote } from '../../../prompts/agent-task-tools';
import { AGENT_TASK_INCOMPLETE_MARKER } from '../../../prompts/agent-task-prompt';
import { AgentTaskAbort } from '../types';
import { classifyAgentTaskFailure } from '../../../config/agent-task-failure-class';
import type { ChatMessage } from '../../../llm/types';

const ENV = ['TASK_SANDBOX_UNAVAILABLE_POLICY', 'TASK_SANDBOX_CAPACITY_WAIT_MS', 'TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS'];
const capacity = () => new TaskSandboxCapacityError(8, 8);
const stepTypes = (): string[] => addAgentTaskStep.mock.calls.map(([s]) => (s as { stepType: string }).stepType);
const fresh = (): ChatMessage[] => [{ role: 'system', content: 'SYS' }, { role: 'user', content: '목표' }];
const base = (over: Record<string, unknown> = {}) => ({
    taskId: 't1', signal: new AbortController().signal, stepNumber: 3, emitStep: jest.fn(), conversation: fresh(), ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    for (const k of ENV) delete process.env[k];
    process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '5000';
    process.env.TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS = '10';
    clearSandboxUnavailable('t1');
});
afterAll(() => { for (const k of ENV) delete process.env[k]; });

describe('설정', () => {
    it('기본은 알리고 진행, 총 60초·간격 3초', () => {
        for (const k of ENV) delete process.env[k];
        expect(getSandboxUnavailableConfig()).toEqual({ policy: 'notify', capacityWaitMs: 60_000, capacityWaitIntervalMs: 3_000 });
    });
    it('모르는 정책 값은 기본으로, 대기 0 은 기다리지 않음으로 읽는다', () => {
        expect(getSandboxUnavailableConfig({ TASK_SANDBOX_UNAVAILABLE_POLICY: 'x', TASK_SANDBOX_CAPACITY_WAIT_MS: '0' }))
            .toMatchObject({ policy: 'notify', capacityWaitMs: 0 });
        expect(getSandboxUnavailableConfig({ TASK_SANDBOX_UNAVAILABLE_POLICY: 'fail' }).policy).toBe('fail');
        expect(getSandboxUnavailableConfig({ TASK_SANDBOX_UNAVAILABLE_POLICY: 'silent' }).policy).toBe('silent');
    });
});

describe('createSandboxWaiting — 상한은 기다린다', () => {
    it('상한 오류 뒤 자리가 나면 대기 끝에 샌드박스가 붙고, 대기 스텝은 한 번만 남는다', async () => {
        const create = jest.fn().mockRejectedValueOnce(capacity()).mockRejectedValueOnce(capacity()).mockResolvedValue(undefined);
        const p = base();
        const next = await createSandboxWaiting({ create }, p);
        expect(create).toHaveBeenCalledTimes(3);
        expect(stepTypes()).toEqual(['sandbox_wait']);
        expect(addAgentTaskStep.mock.calls[0][0]).toMatchObject({ taskId: 't1', stepNumber: 3 });
        expect(p.emitStep).toHaveBeenCalledWith('sandbox_wait', undefined, expect.stringContaining('8/8'));
        expect(next).toBe(4);
    });

    it('대기 상한까지 자리가 안 나면 포기한다 — 그동안 쓴 스텝 번호를 오류에 싣는다', async () => {
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '40';
        const create = jest.fn().mockRejectedValue(capacity());
        const started = Date.now();
        const err = await createSandboxWaiting({ create }, base()).catch((e) => e);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(create.mock.calls.length).toBeGreaterThan(1);
        expect(err).toMatchObject({ stepNumber: 4 });
        expect(err.cause).toBeInstanceOf(TaskSandboxCapacityError);
    });

    it('상한이 아닌 생성 실패는 기다리지 않고 바로 던진다', async () => {
        const boom = new Error('task 샌드박스 생성 실패 (t1): no such image');
        const create = jest.fn().mockRejectedValue(boom);
        await expect(createSandboxWaiting({ create }, base())).rejects.toBe(boom);
        expect(create).toHaveBeenCalledTimes(1);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
    });

    it('취소 신호가 오면 대기가 바로 끝난다', async () => {
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '60000';
        process.env.TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS = '30000';
        const ac = new AbortController();
        const create = jest.fn().mockRejectedValue(capacity());
        const started = Date.now();
        const run = createSandboxWaiting({ create }, base({ signal: ac.signal })).catch((e) => e);
        setTimeout(() => ac.abort(), 20);
        const err = await run;
        expect(Date.now() - started).toBeLessThan(2000);
        expect(err).toBeInstanceOf(AgentTaskAbort);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('정책 silent 이거나 대기 0 이면 상한에도 기다리지 않는다', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'silent';
        const create = jest.fn().mockRejectedValue(capacity());
        await expect(createSandboxWaiting({ create }, base())).rejects.toBeInstanceOf(TaskSandboxCapacityError);
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'notify';
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '0';
        await expect(createSandboxWaiting({ create }, base())).rejects.toBeInstanceOf(TaskSandboxCapacityError);
        expect(create).toHaveBeenCalledTimes(2);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
    });

    it('샌드박스가 붙으면 이전 실행이 남긴 "실행 환경 없음" 안내를 대화에서 지운다(재개)', async () => {
        const conversation: ChatMessage[] = [{ role: 'system', content: `SYS${getSandboxUnavailableSystemNotice()}` }];
        await createSandboxWaiting({ create: jest.fn().mockResolvedValue(undefined) }, base({ conversation }));
        expect(conversation[0].content).toBe('SYS');
    });
});

describe('handleSandboxUnavailable — 못 만들면 숨기지 않는다', () => {
    it('notify: 스텝·진행 이벤트·시스템 안내를 남기고, 결과 각주와 판정 맥락이 켜진다', async () => {
        const p = base();
        const next = await handleSandboxUnavailable(capacity(), p);
        expect(next).toBe(4);
        expect(stepTypes()).toEqual(['sandbox_unavailable']);
        expect(String((addAgentTaskStep.mock.calls[0][0] as { content: string }).content)).toContain('8/8');
        expect(p.emitStep).toHaveBeenCalledWith('sandbox_unavailable', undefined, expect.any(String));
        const sys = String(p.conversation[0].content);
        expect(sys.startsWith('SYS')).toBe(true);
        expect(sys).toContain(AGENT_TASK_INCOMPLETE_MARKER);
        expect(withSandboxUnavailableFootnote('답', 't1')).toBe(`답\n\n${getSandboxUnavailableFootnote()}`);
        expect(withSandboxUnavailableJudgeNote('ctx', 't1')).not.toBe('ctx');
        expect(withSandboxUnavailableJudgeNote('ctx', 't1').startsWith('ctx')).toBe(true);
        // 다른 작업·정리 뒤에는 붙지 않는다
        expect(withSandboxUnavailableFootnote('답', 't2')).toBe('답');
        clearSandboxUnavailable('t1');
        expect(withSandboxUnavailableFootnote('답', 't1')).toBe('답');
        expect(withSandboxUnavailableJudgeNote('ctx', 't1')).toBe('ctx');
    });

    it('notify: 재개로 같은 안내가 이미 있으면 두 번 넣지 않는다', async () => {
        const p = base();
        await handleSandboxUnavailable(capacity(), p);
        const once = p.conversation[0].content;
        await handleSandboxUnavailable(capacity(), p);
        expect(p.conversation[0].content).toBe(once);
    });

    it('대기하다 포기한 오류면 그동안 쓴 스텝 번호를 이어 쓰고, 사유는 상한으로 남긴다', async () => {
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '30';
        const p = base();
        const err = await createSandboxWaiting({ create: jest.fn().mockRejectedValue(capacity()) }, p).catch((e) => e);
        const next = await handleSandboxUnavailable(err, p);
        expect(stepTypes()).toEqual(['sandbox_wait', 'sandbox_unavailable']);
        expect(addAgentTaskStep.mock.calls.map(([s]) => (s as { stepNumber: number }).stepNumber)).toEqual([3, 4]);
        expect(next).toBe(5);
        expect(String((addAgentTaskStep.mock.calls[1][0] as { content: string }).content)).toContain('8/8');
    });

    it('상한이 아닌 생성 실패는 사유를 구분해 남긴다(오류 원문은 싣지 않는다)', async () => {
        await handleSandboxUnavailable(new Error('docker: secret /Users/x path'), base());
        const content = String((addAgentTaskStep.mock.calls[0][0] as { content: string }).content);
        expect(content).not.toContain('8/8');
        expect(content).not.toContain('/Users/x');
    });

    it('fail: 스텝을 남기고 실패 사유 코드로 끝낸다 — 분류는 재시도하면 될 수 있는 종류', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'fail';
        const p = base();
        const err = await handleSandboxUnavailable(capacity(), p).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(SANDBOX_UNAVAILABLE_ERROR);
        expect(SANDBOX_UNAVAILABLE_ERROR).toBe('sandbox_unavailable');
        expect(classifyAgentTaskFailure(SANDBOX_UNAVAILABLE_ERROR)).toBe('interrupted');
        expect(stepTypes()).toEqual(['sandbox_unavailable']);
        expect(p.conversation[0].content).toBe('SYS');
        expect(withSandboxUnavailableFootnote('답', 't1')).toBe('답');
    });

    it('silent: 종전과 같다 — 스텝·안내·각주 없이 조용히 진행', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'silent';
        const p = base();
        expect(await handleSandboxUnavailable(capacity(), p)).toBe(3);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
        expect(p.emitStep).not.toHaveBeenCalled();
        expect(p.conversation[0].content).toBe('SYS');
        expect(withSandboxUnavailableFootnote('답', 't1')).toBe('답');
    });

    it('로컬 실행기는 정책과 무관하게 종전과 같다', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'fail';
        const p = base({ remote: true });
        expect(await handleSandboxUnavailable(new Error('device offline'), p)).toBe(3);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
        expect(p.conversation[0].content).toBe('SYS');
    });

    it('취소된 뒤면 안내를 남기지 않고 취소로 끝낸다', async () => {
        const ac = new AbortController(); ac.abort();
        await expect(handleSandboxUnavailable(new AgentTaskAbort('aborted'), base({ signal: ac.signal }))).rejects.toBeInstanceOf(AgentTaskAbort);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
    });
});
