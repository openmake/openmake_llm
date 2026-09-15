/**
 * 계획 복원(124) — 체크포인트의 plan 스냅샷을 TaskPlan 에 되살린다.
 */
import { TaskPlan } from '../planning';

describe('TaskPlan.restore', () => {
    it('저장된 단계·상태·메모를 그대로 복원하고 goal 시드 계획을 대체한다', () => {
        const plan = new TaskPlan({ autoAdvance: true });
        plan.create(['옛 1', '옛 2']);
        plan.restore([
            { text: '읽기', status: 'completed', note: '완료' },
            { text: '수정', status: 'in_progress' },
            { text: '검증', status: 'not_started' },
        ]);
        expect(plan.snapshot()).toEqual([
            { text: '읽기', status: 'completed', note: '완료' },
            { text: '수정', status: 'in_progress' },
            { text: '검증', status: 'not_started' },
        ]);
        expect(plan.currentStep()).toBe(2);
    });

    it('in_progress 가 없는 스냅샷은 복원 뒤 자동 승격된다', () => {
        const plan = new TaskPlan({ autoAdvance: true });
        plan.restore([{ text: 'a', status: 'completed' }, { text: 'b', status: 'not_started' }]);
        expect(plan.snapshot()[1].status).toBe('in_progress');
    });

    it('형태가 맞지 않는 항목은 버리고, 배열이 아니면 무시한다', () => {
        const plan = new TaskPlan();
        plan.create(['유지']);
        plan.restore('garbage');
        expect(plan.snapshot().map((s) => s.text)).toEqual(['유지']);
        plan.restore([{ text: 'ok', status: 'not_started' }, { text: '', status: 'not_started' }, { status: 'completed' }, null, { text: 'bad', status: 'weird' }]);
        expect(plan.snapshot()).toEqual([{ text: 'ok', status: 'not_started' }]);
    });
});
