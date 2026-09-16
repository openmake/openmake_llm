/**
 * 턴 경계 반영 — 사용자 계획 편집(139)은 steering 플래그와 무관하게 applyPendingSteering 에서 적용된다.
 */
const addStep = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep: addStep }) }));
let steeringEnabled = true;
jest.mock('../../../config/runtime-limits', () => ({ AGENT_TASK_LIMITS: { get STEERING_ENABLED() { return steeringEnabled; } } }));
jest.mock('../../../prompts/agent-task-prompt', () => ({ getAgentTaskSteeringInjection: (t: string) => `[steer] ${t}` }));

import { applyPendingSteering, getSteeringRegistry } from '../steering';
import { applyPendingPlanEdit, getPlanEditRegistry, PLAN_EDIT_NOTICE } from '../plan-edits';
import type { ChatMessage } from '../../../llm/types';

function runtime() {
    return { replacePlan: jest.fn(), renderPlan: jest.fn(() => '1. a\n2. b') };
}

beforeEach(() => { steeringEnabled = true; addStep.mockClear(); getPlanEditRegistry().clear('t1'); getSteeringRegistry().clear('t1'); });

describe('applyPendingPlanEdit', () => {
    it('대기 편집을 런타임에 반영하고 최신 계획 안내를 대화에 싣는다', () => {
        const rt = runtime();
        const conv: ChatMessage[] = [];
        const emit = jest.fn();
        getPlanEditRegistry().submit('t1', ['a', 'b']);
        applyPendingPlanEdit('t1', 3, conv, emit, rt);
        expect(rt.replacePlan).toHaveBeenCalledWith(['a', 'b']);
        expect(conv).toEqual([{ role: 'user', content: `${PLAN_EDIT_NOTICE}\n\n1. a\n2. b` }]);
        expect(emit).toHaveBeenCalledWith('plan_edit', undefined, expect.stringContaining('2'));
        expect(getPlanEditRegistry().has('t1')).toBe(false);
    });

    it('런타임이 없으면 소비만 하고, 대기 편집이 없으면 아무것도 하지 않는다', () => {
        const conv: ChatMessage[] = [];
        getPlanEditRegistry().submit('t1', ['a']);
        applyPendingPlanEdit('t1', 0, conv, jest.fn(), null);
        expect(conv).toHaveLength(0);
        expect(getPlanEditRegistry().has('t1')).toBe(false);
        const rt = runtime();
        applyPendingPlanEdit('t1', 0, conv, jest.fn(), rt);
        expect(rt.replacePlan).not.toHaveBeenCalled();
    });
});

describe('applyPendingSteering — 계획 편집 포함', () => {
    it('steering 지시 뒤에 계획 편집을 반영한다', async () => {
        const rt = runtime();
        const conv: ChatMessage[] = [];
        getSteeringRegistry().submit('t1', '방향 바꿔', 10);
        getPlanEditRegistry().submit('t1', ['x']);
        const next = await applyPendingSteering('t1', 1, conv, 5, jest.fn(), rt);
        expect(next).toBe(6);
        expect(conv.map((m) => String(m.content).slice(0, 7))).toEqual(['[steer]', PLAN_EDIT_NOTICE.slice(0, 7)]);
    });

    it('steering 이 꺼져 있어도 계획 편집은 반영된다', async () => {
        steeringEnabled = false;
        const rt = runtime();
        const conv: ChatMessage[] = [];
        getSteeringRegistry().submit('t1', '무시됨', 10);
        getPlanEditRegistry().submit('t1', ['x']);
        await expect(applyPendingSteering('t1', 1, conv, 5, jest.fn(), rt)).resolves.toBe(5);
        expect(rt.replacePlan).toHaveBeenCalledWith(['x']);
        expect(conv).toHaveLength(1);
        expect(addStep).not.toHaveBeenCalled();
    });
});
