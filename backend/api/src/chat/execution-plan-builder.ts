/**
 * ============================================================
 * ExecutionPlanBuilder — Phase B Routing Unification
 * ============================================================
 *
 * 라우팅 4 layer 를 단일 진입점으로 통합하는 builder. Phase 1 은 위임 단계 —
 * 기존 `buildExecutionPlan` (Layer 2) 과 `selectOptimalModel` (Layer 1+3) 을
 * 그대로 내부 호출합니다. 외부 동작은 변화 없음.
 *
 * Phase 2 에서 LLM classifier 제거, Layer 2·4 흡수 후 단일 결정자가 됩니다.
 *
 * @module chat/execution-plan-builder
 * @see chat/execution-plan-types
 * @see docs/superpowers/plans/2026-05-25-routing-unification-phase-b.md
 */

import { buildExecutionPlan } from './profile-resolver';
import { selectOptimalModel } from './model-selector';
import { normalizeStyle } from './style';
import { createLogger } from '../utils/logger';
import type {
    BuildPlanInput,
    UnifiedExecutionPlan,
} from './execution-plan-types';

const logger = createLogger('ExecutionPlanBuilder');

export class ExecutionPlanBuilder {
    /**
     * 통합 실행 계획을 구성합니다.
     *
     * Phase 1: 기존 두 함수 결과를 단순 머지.
     * Phase 2-A: classifier round-trip 제거 (regex only).
     * Phase 2-B: capacityDecision 계산 흡수.
     */
    async build(input: BuildPlanInput): Promise<UnifiedExecutionPlan> {
        const { message, hasImages, executionPlan, style: rawStyle } = input;

        const profilePlan = executionPlan ?? buildExecutionPlan('');
        const modelSelection = await selectOptimalModel(message, hasImages);
        const style = normalizeStyle(rawStyle);

        logger.debug(
            `build: queryType=${modelSelection.queryType} ` +
            `model=${modelSelection.model} ` +
            `strategy=${profilePlan.executionStrategy} ` +
            `style=${style} ` +
            `requestedModel=${profilePlan.requestedModel}`,
        );

        return {
            ...profilePlan,
            modelSelection,
            capacityDecision: null,
            style,
        };
    }
}

/** Singleton — ChatService 가 주입받지 않는 경로 (request-handler 등) 대비 */
let defaultBuilder: ExecutionPlanBuilder | null = null;

export function getExecutionPlanBuilder(): ExecutionPlanBuilder {
    if (!defaultBuilder) {
        defaultBuilder = new ExecutionPlanBuilder();
    }
    return defaultBuilder;
}
