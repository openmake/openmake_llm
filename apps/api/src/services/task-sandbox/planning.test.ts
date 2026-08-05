import { TaskPlan, currentPlanStepIndex } from './planning';

describe('TaskPlan', () => {
    it('create → 모든 단계 not_started, 빈 문자열 제거', () => {
        const p = new TaskPlan();
        p.create(['A', '  ', 'B', '']);
        expect(p.length).toBe(2);
        expect(p.snapshot().map((s) => s.status)).toEqual(['not_started', 'not_started']);
    });

    it('update 로 상태/메모 갱신', () => {
        const p = new TaskPlan();
        p.create(['A', 'B']);
        expect(p.update(1, 'completed')).toBe(true);
        expect(p.update(2, 'in_progress', '진행중')).toBe(true);
        const s = p.snapshot();
        expect(s[0].status).toBe('completed');
        expect(s[1]).toMatchObject({ status: 'in_progress', note: '진행중' });
    });

    it('범위 밖 update 는 false', () => {
        const p = new TaskPlan();
        p.create(['A']);
        expect(p.update(5, 'completed')).toBe(false);
        expect(p.update(0, 'completed')).toBe(false);
    });

    it('currentStep = 첫 미완료(1-based), 전부 완료면 0', () => {
        const p = new TaskPlan();
        p.create(['A', 'B', 'C']);
        expect(p.currentStep()).toBe(1);
        p.update(1, 'completed');
        expect(p.currentStep()).toBe(2);
        p.update(2, 'completed'); p.update(3, 'completed');
        expect(p.currentStep()).toBe(0);
    });

    it('render 에 진행도 + 상태 마크', () => {
        const p = new TaskPlan();
        p.create(['A', 'B']);
        p.update(1, 'completed');
        const r = p.render();
        expect(r).toContain('(1/2 완료)');
        expect(r).toContain('[x] A');
        expect(r).toContain('[ ] B');
    });

    it('빈 계획 render', () => {
        expect(new TaskPlan().render()).toContain('계획 없음');
    });

    it('create 재호출(4-3) — 텍스트 동일 단계는 상태/메모 보존, 신규만 not_started', () => {
        const p = new TaskPlan();
        p.create(['A', 'B', 'C']);
        p.update(1, 'completed');
        p.update(2, 'in_progress', '진행중');
        // 모델이 plan_create 를 재호출(라이브 관찰 행동) — A/B 유지 + D 신규, C 제거
        p.create(['A', 'B', 'D']);
        const s = p.snapshot();
        expect(s[0]).toMatchObject({ text: 'A', status: 'completed' });
        expect(s[1]).toMatchObject({ text: 'B', status: 'in_progress', note: '진행중' });
        expect(s[2]).toMatchObject({ text: 'D', status: 'not_started' });
        expect(p.length).toBe(3);
    });
});

describe('currentPlanStepIndex (088 스텝→플랜 노드 귀속)', () => {
    const step = (status: 'not_started' | 'in_progress' | 'completed' | 'blocked') =>
        ({ text: 's', status });

    it('첫 in_progress 단계의 0-base 인덱스', () => {
        expect(currentPlanStepIndex([step('completed'), step('in_progress'), step('not_started')])).toBe(1);
    });

    it('in_progress 복수면 첫 번째', () => {
        expect(currentPlanStepIndex([step('in_progress'), step('in_progress')])).toBe(0);
    });

    it('in_progress 없으면 undefined — 추정 귀속(첫 미완료 등) 금지', () => {
        expect(currentPlanStepIndex([step('completed'), step('not_started')])).toBeUndefined();
        expect(currentPlanStepIndex([step('blocked')])).toBeUndefined();
        expect(currentPlanStepIndex([])).toBeUndefined();
    });
});
