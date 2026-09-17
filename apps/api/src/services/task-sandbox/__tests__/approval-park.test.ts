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
