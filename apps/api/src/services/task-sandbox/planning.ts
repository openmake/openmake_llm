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
    /** 완료 기준(Execution Graph 증분 4, 2026-09-16) — goal judge 가 노드 단위로 대조하는 검증 가능한 조건. */
    doneWhen?: string;
    /** 선행 노드(1-based). 자동 승격은 선행이 모두 completed 인 노드만 고른다. */
    after?: number[];
}

/** plan_create 입력 — 문자열(종전) 또는 완료 기준·선행 노드를 가진 객체. */
export type PlanStepInput = string | { text: string; doneWhen?: string; after?: number[] };

const STATUS_VALUES: ReadonlySet<string> = new Set(['not_started', 'in_progress', 'completed', 'blocked']);

/** PURE: 입력 1건 → 정규화된 노드 필드(빈 텍스트는 null). after 는 1 이상 정수만, 자기 자신은 제외. */
export function normalizePlanStepInput(input: unknown, index: number): { text: string; doneWhen?: string; after?: number[] } | null {
    const o = typeof input === 'string' ? { text: input } : (input as { text?: unknown; doneWhen?: unknown; done_when?: unknown; after?: unknown } | null);
    const text = String(o?.text ?? '').trim();
    if (!text) return null;
    const dw = typeof o?.doneWhen === 'string' ? o.doneWhen : typeof o?.done_when === 'string' ? o.done_when : '';
    const after = Array.isArray(o?.after)
        ? [...new Set(o.after.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n !== index + 1))]
        : [];
    return { text, ...(dw.trim() ? { doneWhen: dw.trim() } : {}), ...(after.length > 0 ? { after } : {}) };
}

const STATUS_MARK: Record<PlanStepStatus, string> = {
    not_started: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    blocked: '[!]',
};

/**
 * PURE: 스텝→플랜 노드 귀속(088) — 현재 in_progress 단계의 0-base 인덱스.
 * 엄격 판정: 모델이 in_progress 로 마킹한 단계가 없으면 undefined(NULL 저장) —
 * "첫 미완료 단계" 같은 추정 귀속은 하지 않는다(정합률 계측이 목적이므로 날조 금지).
 * in_progress 가 복수면 첫 번째(모델이 순차 마킹하는 정상 흐름 기준).
 */
export function currentPlanStepIndex(steps: PlanStep[]): number | undefined {
    const i = steps.findIndex((s) => s.status === 'in_progress');
    return i < 0 ? undefined : i;
}

/**
 * PURE: goal 본문의 번호 절차를 초기 계획 단계로 파싱.
 *
 * 왜 필요한가 — goal 에 `[절차] 1) … 7)` 처럼 번호가 적혀 있으면 모델은 **그 번호를 계획으로
 * 인식**해 `plan_create` 없이 `plan_update(step:2)` 부터 부른다. TaskPlan 은 비어 있으므로
 * "아직 계획이 없습니다"/"단계 N 이 범위를 벗어났습니다" 오류가 난다. 실측(2026-08-28):
 * plan 프로토콜 오류 28건 중 20건이 이 형태였고, 실패 인자는 대부분 `{step, status}` 뿐이라
 * **빈 계획을 만들어줘도 그 단계가 무엇인지 알 수 없다**. goal 의 번호를 그대로 계획으로
 * 심어야 모델의 번호와 TaskPlan 의 번호가 일치한다.
 *
 * 결정적 파싱(LLM 없음) — 판단 경계 A형(앞단 LLM 판단) 도입이 아니다.
 *
 * 규칙: 줄 머리의 `N)` `N.` `N-` 만 인정(인라인 번호 제외), **1 부터 시작해 1 씩 증가하는
 * 연속열**만 취한다(중간에 끊기면 거기까지). 하위 들여쓰기 줄은 앞 단계의 연속이므로 버린다.
 * 항목이 `minItems` 미만이면 절차가 아니라고 보고 빈 배열(no-op).
 */
export function parseGoalPlanSteps(
    goal: string,
    opts: { minItems: number; maxItems: number; maxTextChars: number },
): string[] {
    if (!goal) return [];
    const steps: string[] = [];
    let expected = 1;
    for (const rawLine of goal.split('\n')) {
        // 들여쓰기된 줄은 앞 항목의 연속 — 번호처럼 보여도 새 단계로 세지 않는다.
        if (/^\s/.test(rawLine)) continue;
        const m = /^(\d{1,2})\s*[).\-]\s+(\S.*)$/.exec(rawLine.trim());
        if (!m) continue;
        if (Number(m[1]) !== expected) {
            // 1 로 다시 시작하면 새 목록의 시작으로 본다(앞의 짧은 열은 버린다).
            if (Number(m[1]) === 1) { steps.length = 0; expected = 2; steps.push(m[2].trim()); }
            continue;
        }
        steps.push(m[2].trim());
        expected++;
        if (steps.length >= opts.maxItems) break;
    }
    if (steps.length < opts.minItems) return [];
    return steps.map((t) => (t.length > opts.maxTextChars ? t.slice(0, opts.maxTextChars) + '…' : t));
}

/** task 실행 계획. 단계 목록 + 상태. 순수 로직(유닛테스트 대상). */
export class TaskPlan {
    private steps: PlanStep[] = [];

    /** autoAdvance(088 증분 3): 모델이 [~] 마킹을 생략해도(후향 실측 60%, 명시 지시에도
     *  라이브 재현) 활성 단계가 비지 않게, 상태 변화 후 in_progress 가 없으면 첫 not_started
     *  를 결정적으로 승격한다. 선형 실행 가정(모델의 정상 흐름) — 모델의 명시 마킹이 항상 우선. */
    constructor(private readonly opts: { autoAdvance?: boolean } = {}) {}

    /** PURE: 노드(1-based)의 선행 중 아직 completed 가 아닌 것들(범위 밖 번호는 무시). */
    unmetDeps(stepNumber: number): number[] {
        const step = this.steps[stepNumber - 1];
        if (!step?.after) return [];
        return step.after.filter((n) => n <= this.steps.length && this.steps[n - 1].status !== 'completed');
    }

    /** in_progress 부재 시 선행이 끝난 첫 not_started 승격 — create/완료·차단 전이 후에만 호출(명시 강등은 존중). */
    private maybeAdvance(): void {
        if (!this.opts.autoAdvance) return;
        if (this.steps.some((s) => s.status === 'in_progress')) return;
        const idx = this.steps.findIndex((s, i) => s.status === 'not_started' && this.unmetDeps(i + 1).length === 0);
        if (idx >= 0) this.steps[idx].status = 'in_progress';
    }

    /** 계획 생성/교체 — 상태 보존 병합(4-3). 모델이 plan_create 를 재호출해도(라이브에서 관찰된
     *  행동) 텍스트가 동일한 기존 단계의 status/note 는 보존하고, 신규 단계만 not_started 로
     *  시작한다. 진행률(plan 완료율)·가시성이 재호출로 리셋되던 문제 방지. */
    create(inputs: PlanStepInput[]): void {
        const prev = new Map(this.steps.map((s) => [s.text.trim(), s]));
        this.steps = inputs
            .map((input, i) => normalizePlanStepInput(input, i))
            .filter((n): n is NonNullable<typeof n> => n !== null)
            .map((n) => {
                const old = prev.get(n.text);
                return old
                    ? { ...n, status: old.status, ...(old.note !== undefined ? { note: old.note } : {}) }
                    : { ...n, status: 'not_started' as PlanStepStatus };
            });
        this.maybeAdvance();
    }

    /** 단계 상태 갱신(1-based index). 범위 밖이면 false. */
    update(stepNumber: number, status: PlanStepStatus, note?: string): boolean {
        const idx = stepNumber - 1;
        if (idx < 0 || idx >= this.steps.length) return false;
        this.steps[idx].status = status;
        if (note !== undefined) this.steps[idx].note = note;
        // 완료/차단 전이 후에만 자동 승격 — 명시 not_started 강등은 존중(재승격 안 함).
        if (status === 'completed' || status === 'blocked') this.maybeAdvance();
        return true;
    }

    /**
     * 체크포인트에 저장된 계획 복원(124) — 재개 시 종전엔 새 TaskPlan 이라 계획이 비어
     * plan_update 가 "계획이 없습니다" 로 실패하고 진행률·노드 귀속이 0 에서 다시 시작했다.
     * 형태가 맞는 항목만 받아들이고(불량 행은 버림) 자동 승격은 복원 뒤에도 적용한다.
     */
    restore(steps: unknown): void {
        if (!Array.isArray(steps)) return;
        this.steps = steps.flatMap((s, i) => {
            const o = s as Partial<PlanStep> | null;
            const n = o ? normalizePlanStepInput(o, i) : null;
            if (!n || !STATUS_VALUES.has(String(o?.status))) return [];
            return [{ ...n, status: o!.status as PlanStepStatus, ...(typeof o!.note === 'string' ? { note: o!.note } : {}) }];
        });
        this.maybeAdvance();
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
            (s, i) => `${i + 1}. ${STATUS_MARK[s.status]} ${s.text}${s.after?.length ? ` (after ${s.after.join(',')})` : ''}`
                + `${s.note ? ` — ${s.note}` : ''}${s.doneWhen ? `\n   ↳ 완료 기준: ${s.doneWhen}` : ''}`,
        );
        return `## 계획 (${done}/${this.steps.length} 완료)\n${lines.join('\n')}`;
    }
}
