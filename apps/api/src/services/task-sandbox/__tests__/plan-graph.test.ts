/**
 * Execution Graph 증분 4 — 노드 완료 기준(doneWhen)·선행 노드(after).
 */
import { TaskPlan, normalizePlanStepInput } from '../planning';
import { createPlanTools } from '../tools-plan';
import { buildJudgeExecutionContext } from '../../agent-task/goal-judge';

const txt = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? '';

describe('normalizePlanStepInput', () => {
    it('문자열·객체(done_when/doneWhen/after)를 같은 형태로 만든다', () => {
        expect(normalizePlanStepInput('조사', 0)).toEqual({ text: '조사' });
        expect(normalizePlanStepInput({ text: '초안', done_when: 'draft.md 존재', after: [1] }, 1)).toEqual({ text: '초안', doneWhen: 'draft.md 존재', after: [1] });
        expect(normalizePlanStepInput({ text: '검토', doneWhen: '리뷰 완료' }, 2)).toEqual({ text: '검토', doneWhen: '리뷰 완료' });
    });
    it('빈 텍스트는 null, after 는 자기 자신·0 이하·중복 제거', () => {
        expect(normalizePlanStepInput({ text: '  ' }, 0)).toBeNull();
        expect(normalizePlanStepInput({ text: 'x', after: [2, 2, 0, -1, 1.5] }, 1)).toEqual({ text: 'x' });
        expect(normalizePlanStepInput({ text: 'x', after: [1, 3] }, 1)).toEqual({ text: 'x', after: [1, 3] });
    });
});

describe('TaskPlan 선행 노드', () => {
    it('자동 승격은 선행이 끝난 노드만 고른다', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', { text: 'B', after: [1] }, { text: 'C' }]);
        expect(p.snapshot().map((s) => s.status)).toEqual(['in_progress', 'not_started', 'not_started']);
        p.update(1, 'blocked'); // A 차단 → B 는 선행 미완료라 건너뛰고 C 승격
        expect(p.snapshot().map((s) => s.status)).toEqual(['blocked', 'not_started', 'in_progress']);
        p.update(3, 'completed');
        expect(p.snapshot()[1].status).toBe('not_started'); // 여전히 A 대기
        p.update(1, 'completed');
        expect(p.snapshot()[1].status).toBe('in_progress');
    });
    it('unmetDeps 는 completed 가 아닌 선행만, 범위 밖은 무시', () => {
        const p = new TaskPlan();
        p.create(['A', { text: 'B', after: [1, 9] }]);
        expect(p.unmetDeps(2)).toEqual([1]);
        p.update(1, 'completed');
        expect(p.unmetDeps(2)).toEqual([]);
    });
    it('render 는 선행·완료 기준을 보여주고 restore 는 두 속성을 보존한다', () => {
        const p = new TaskPlan();
        p.create([{ text: 'A', doneWhen: 'a.txt 존재' }, { text: 'B', after: [1] }]);
        expect(p.render()).toContain('↳ 완료 기준: a.txt 존재');
        expect(p.render()).toContain('B (after 1)');
        const q = new TaskPlan();
        q.restore(p.snapshot());
        expect(q.snapshot()).toEqual(p.snapshot());
    });
});

describe('plan 도구', () => {
    it('plan_create 가 객체 항목을 받고 plan_update 는 선행 미완료를 경고한다(차단 아님)', async () => {
        const plan = new TaskPlan();
        const [create, update] = createPlanTools(plan);
        const r = await create.handler({ steps: ['조사', { text: '초안', done_when: 'draft.md 존재', after: [1] }] }, { userId: 'u', role: 'user' });
        expect(txt(r)).toContain('완료 기준: draft.md 존재');
        const u = await update.handler({ step: 2, status: 'in_progress' }, { userId: 'u', role: 'user' });
        expect(u.isError).toBeFalsy();
        expect(txt(u)).toContain('선행 단계 1');
        expect(plan.snapshot()[1].status).toBe('in_progress');
    });
    it('유효한 단계가 없으면 오류', async () => {
        const [create] = createPlanTools(new TaskPlan());
        const r = await create.handler({ steps: [{ text: '' }] }, { userId: 'u', role: 'user' });
        expect(r.isError).toBe(true);
    });
});

describe('judge 실행 컨텍스트', () => {
    it('완료 기준이 있는 노드만 DONE_WHEN 블록으로 싣는다', () => {
        const ctx = buildJudgeExecutionContext(new Set(['bash']), 3, [
            { status: 'completed', text: '조사' },
            { status: 'in_progress', text: '초안', doneWhen: 'draft.md 존재' },
        ]);
        expect(ctx).toContain('계획 노드 완료 기준(DONE_WHEN):');
        expect(ctx).toContain('2. 초안 — 완료 기준: draft.md 존재');
        expect(ctx).not.toContain('1. 조사');
    });
});
