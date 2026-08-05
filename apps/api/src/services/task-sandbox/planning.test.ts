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

describe('TaskPlan autoAdvance (088 증분 3 — 마킹 공백 자동 승격)', () => {
    it('create 직후 첫 단계가 in_progress 로 승격', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', 'B']);
        expect(p.snapshot().map((s) => s.status)).toEqual(['in_progress', 'not_started']);
    });

    it('completed 전이 후 in_progress 부재면 다음 not_started 승격 — [~] 생략 흐름 보정', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', 'B', 'C']);
        p.update(1, 'completed'); // 모델이 2를 in_progress 마킹 안 해도
        expect(p.snapshot().map((s) => s.status)).toEqual(['completed', 'in_progress', 'not_started']);
    });

    it('모델의 명시 in_progress 마킹이 우선 — 이미 있으면 승격 안 함', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', 'B', 'C']);
        p.update(3, 'in_progress'); // 모델이 순서를 건너뛰어 3을 지목
        p.update(1, 'completed');
        expect(p.snapshot().map((s) => s.status)).toEqual(['completed', 'not_started', 'in_progress']);
    });

    it('blocked 전이 후에도 다음 단계 승격(선형 진행 유지)', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', 'B']);
        p.update(1, 'blocked');
        expect(p.snapshot().map((s) => s.status)).toEqual(['blocked', 'in_progress']);
    });

    it('명시 not_started 강등은 존중 — 재승격 안 함', () => {
        const p = new TaskPlan({ autoAdvance: true });
        p.create(['A', 'B']);
        p.update(1, 'not_started'); // 강등(in_progress 전이가 아니므로 advance 미호출)
        expect(p.snapshot()[0].status).toBe('not_started');
    });

    it('autoAdvance 미설정(기본) — 기존 동작 그대로', () => {
        const p = new TaskPlan();
        p.create(['A', 'B']);
        p.update(1, 'completed');
        expect(p.snapshot().map((s) => s.status)).toEqual(['completed', 'not_started']);
    });
});
