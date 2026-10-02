/**
 * 질문 응답 대기 주차(F16.7) — 질문형 승인 + 플래그 ON + 대기 연장 저장소일 때만 만료가 'parked' 가 되고,
 * 저장소 행은 결정(expired) 대신 만료 연장으로 pending 에 남는다.
 */
let parkOn = true;
jest.mock('../../../config/env', () => ({ getConfig: () => ({ agentTaskHitlParkOnTimeout: parkOn }) }));

import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

function store(withExtend = true) {
    const s = {
        insertPending: jest.fn(async () => undefined),
        markDecided: jest.fn(async () => true),
        listPending: jest.fn(async () => []),
        getPending: jest.fn(async () => undefined),
        takeoverForCall: jest.fn(async () => undefined),
        expirePendingForTask: jest.fn(async () => undefined),
        ...(withExtend ? { extendPending: jest.fn(async () => true) } : {}),
    };
    return s as typeof s & ApprovalStore;
}
const input = (toolName: string) => ({ taskId: 't1', userId: 'u1', toolName, args: { question: 'q' } });
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { parkOn = true; });

describe('ApprovalRegistry — 만료 주차(F16.7)', () => {
    it.each(['ask_human', 'mcp_elicit'])('%s 만료는 parked — 행은 연장되고 결정되지 않는다', async (tool) => {
        const s = store();
        const r = await new ApprovalRegistry(s).request(input(tool), { timeoutMs: 5 });
        expect(r).toMatchObject({ decision: 'rejected', reason: 'parked' });
        await flush();
        expect(s.extendPending).toHaveBeenCalledWith(expect.stringContaining('apv_t1_'), AGENT_TASK_LIMITS.HITL_PARK_MAX_MS);
        expect(s.markDecided).not.toHaveBeenCalled();
    });

    it('도구 승인(bash)은 종전대로 timeout → expired', async () => {
        const s = store();
        const r = await new ApprovalRegistry(s).request(input('bash'), { timeoutMs: 5 });
        expect(r).toMatchObject({ reason: 'timeout' });
        await flush();
        expect(s.markDecided).toHaveBeenCalledWith(expect.any(String), 'expired', undefined, undefined, true);
        expect(s.extendPending).not.toHaveBeenCalled();
    });

    it('플래그 OFF·연장 저장소 없음·저장소 없음이면 timeout', async () => {
        parkOn = false;
        await expect(new ApprovalRegistry(store()).request(input('ask_human'), { timeoutMs: 5 })).resolves.toMatchObject({ reason: 'timeout' });
        parkOn = true;
        await expect(new ApprovalRegistry(store(false)).request(input('ask_human'), { timeoutMs: 5 })).resolves.toMatchObject({ reason: 'timeout' });
        await expect(new ApprovalRegistry().request(input('ask_human'), { timeoutMs: 5 })).resolves.toMatchObject({ reason: 'timeout' });
    });
});

describe('ApprovalRegistry — 짧은 유예 후 주차', () => {
    const limits = AGENT_TASK_LIMITS as { HITL_PARK_GRACE_MS: number };
    const original = limits.HITL_PARK_GRACE_MS;
    afterEach(() => { limits.HITL_PARK_GRACE_MS = original; });

    it('유예를 켜면 주차 가능한 도구 승인(bash)이 만료 전 유예 시간에 parked — 행은 연장된다', async () => {
        limits.HITL_PARK_GRACE_MS = 5;
        const s = store();
        const r = await new ApprovalRegistry(s).request(input('bash'), { timeoutMs: 60_000, parkable: true });
        expect(r).toMatchObject({ decision: 'rejected', reason: 'parked' });
        await flush();
        expect(s.extendPending).toHaveBeenCalledWith(expect.stringContaining('apv_t1_'), AGENT_TASK_LIMITS.HITL_PARK_MAX_MS);
        expect(s.markDecided).not.toHaveBeenCalled();
    });

    it('유예 안에 승인하면 주차하지 않고 approved', async () => {
        limits.HITL_PARK_GRACE_MS = 60_000;
        const s = store();
        const reg = new ApprovalRegistry(s);
        let approvalId = '';
        const pending = reg.request(input('bash'), { timeoutMs: 120_000, parkable: true, onPending: (p) => { approvalId = p.approvalId; } });
        await flush();
        await reg.approve(approvalId);
        await expect(pending).resolves.toMatchObject({ decision: 'approved' });
        expect(s.extendPending).not.toHaveBeenCalled();
    });

    it('주차 가능 표시가 없으면(서브에이전트) 유예를 켜도 종전대로 timeout', async () => {
        limits.HITL_PARK_GRACE_MS = 1;
        const s = store();
        await expect(new ApprovalRegistry(s).request(input('bash'), { timeoutMs: 20 })).resolves.toMatchObject({ reason: 'timeout' });
        expect(s.extendPending).not.toHaveBeenCalled();
    });

    it('유예를 끄면(0) 주차 가능 표시가 있어도 도구 승인은 종전대로 timeout', async () => {
        limits.HITL_PARK_GRACE_MS = 0;
        await expect(new ApprovalRegistry(store()).request(input('bash'), { timeoutMs: 5, parkable: true })).resolves.toMatchObject({ reason: 'timeout' });
    });
});
