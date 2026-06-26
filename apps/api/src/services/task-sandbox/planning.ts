/**
 * ============================================================
 * Task Plan — 에이전트 실행 계획 + step 상태 추적 (Manus화 G3)
 * ============================================================
 *
 * OpenManus PlanningFlow 대응(단일 에이전트 MVP — 멀티에이전트 executor 라우팅 G4 별도).
 * 에이전트가 plan_create 로 단계를 세우고, 작업하며 plan_update 로 상태를 갱신한다.
 * not_started → in_progress → completed | blocked. 진행 가시성(G5) + 구조적 실행.
 *
 * @module services/task-sandbox/planning
 */

export type PlanStepStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

export interface PlanStep {
    text: string;
    status: PlanStepStatus;
    note?: string;
}

const STATUS_MARK: Record<PlanStepStatus, string> = {
    not_started: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    blocked: '[!]',
};

/** task 실행 계획. 단계 목록 + 상태. 순수 로직(유닛테스트 대상). */
export class TaskPlan {
    private steps: PlanStep[] = [];

    /** 계획 생성/교체. 모든 단계 not_started. */
    create(stepTexts: string[]): void {
        this.steps = stepTexts
            .map((t) => String(t).trim())
            .filter(Boolean)
            .map((text) => ({ text, status: 'not_started' as PlanStepStatus }));
    }

    /** 단계 상태 갱신(1-based index). 범위 밖이면 false. */
    update(stepNumber: number, status: PlanStepStatus, note?: string): boolean {
        const idx = stepNumber - 1;
        if (idx < 0 || idx >= this.steps.length) return false;
        this.steps[idx].status = status;
        if (note !== undefined) this.steps[idx].note = note;
        return true;
    }

    get length(): number { return this.steps.length; }

    /** 첫 미완료 단계(1-based) 또는 0(없음). */
    currentStep(): number {
        const i = this.steps.findIndex((s) => s.status !== 'completed');
        return i < 0 ? 0 : i + 1;
    }

    snapshot(): PlanStep[] {
        return this.steps.map((s) => ({ ...s }));
    }

    /** LLM/사용자용 렌더. */
    render(): string {
        if (this.steps.length === 0) return '(계획 없음 — plan_create 로 단계를 세우세요)';
        const done = this.steps.filter((s) => s.status === 'completed').length;
        const lines = this.steps.map(
            (s, i) => `${i + 1}. ${STATUS_MARK[s.status]} ${s.text}${s.note ? ` — ${s.note}` : ''}`,
        );
        return `## 계획 (${done}/${this.steps.length} 완료)\n${lines.join('\n')}`;
    }
}
