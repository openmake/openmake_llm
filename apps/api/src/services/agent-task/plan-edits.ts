/**
 * 사용자 계획 편집 레지스트리 (F18 PR-4, 139) — steering 과 같은 인메모리 패턴.
 * 실행 중 작업의 편집은 즉시 교체하지 않고 **턴 경계**에서 drain 해 `TaskRuntime.restorePlan` + steering 문구로 반영한다
 * (턴 중간 교체는 모델이 보고 있는 계획과 어긋나 plan_update 프로토콜 오류를 낸다).
 * @module services/agent-task/plan-edits
 */
import type { PlanStepInput } from '../task-sandbox/planning';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskPlanEdits');

export class PlanEditRegistry {
    private pending = new Map<string, PlanStepInput[]>();
    /** 마지막 편집만 유지(직전 편집은 덮어씀). */
    submit(taskId: string, steps: PlanStepInput[]): void { this.pending.set(taskId, steps); logger.info(`[${taskId}] 계획 편집 접수 (${steps.length}단계, 다음 턴 적용)`); }
    drain(taskId: string): PlanStepInput[] | null { const s = this.pending.get(taskId) ?? null; this.pending.delete(taskId); return s; }
    clear(taskId: string): void { this.pending.delete(taskId); }
    has(taskId: string): boolean { return this.pending.has(taskId); }
}

let registry: PlanEditRegistry | null = null;
export function getPlanEditRegistry(): PlanEditRegistry {
    if (!registry) registry = new PlanEditRegistry();
    return registry;
}

/** 편집 반영 시 모델에게 주는 안내(steering 채널). */
export const PLAN_EDIT_NOTICE = '사용자가 계획을 직접 수정했습니다. 아래 최신 계획을 따르고, 이미 완료된 단계의 상태는 유지하세요.';
