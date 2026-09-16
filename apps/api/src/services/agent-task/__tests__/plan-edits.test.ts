import { PlanEditRegistry } from '../plan-edits';
import { TaskPlan } from '../../task-sandbox/planning';

describe('PlanEditRegistry', () => {
    test('drain 은 1회성이고 마지막 편집만 남는다', () => {
        const r = new PlanEditRegistry();
        r.submit('t1', ['a']); r.submit('t1', ['b', 'c']);
        expect(r.has('t1')).toBe(true);
        expect(r.drain('t1')).toEqual(['b', 'c']);
        expect(r.drain('t1')).toBeNull();
    });
});

describe('편집 병합(TaskPlan.restore + create)', () => {
    test('같은 텍스트 단계는 상태를 보존하고 새 단계는 not_started', () => {
        const tp = new TaskPlan();
        tp.restore([{ text: '조사', status: 'completed' }, { text: '초안', status: 'in_progress' }]);
        tp.create(['조사', { text: '초안', doneWhen: 'draft.md' }, '검토']);
        const s = tp.snapshot();
        expect(s.map((x) => [x.text, x.status])).toEqual([['조사', 'completed'], ['초안', 'in_progress'], ['검토', 'not_started']]);
        expect(s[1].doneWhen).toBe('draft.md');
    });
});
