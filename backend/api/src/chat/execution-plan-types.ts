/**
 * ============================================================
 * Unified Execution Plan — Phase B Routing Unification
 * ============================================================
 *
 * 기존 4 layer (LLM classifier / brand profile / model-resolver / model-pool)
 * 의 출력을 단일 구조체로 통합합니다. Phase 1 은 위임 단계 — 기존
 * `ExecutionPlan` 과 `ModelSelection` 을 그대로 포함합니다. Phase 2 에서
 * model-pool 의 `ModelPoolDecision` 을 흡수해 `capacityDecision` 이 채워집니다.
 *
 * @module chat/execution-plan-types
 * @see chat/execution-plan-builder
 * @see docs/superpowers/plans/2026-05-25-routing-unification-phase-b.md
 */

import type { ExecutionPlan } from './profile-resolver';
import type { ModelSelection } from './model-selector-types';
import type { ModelPoolDecision } from '../llm/model-pool';

export interface UnifiedExecutionPlan extends ExecutionPlan {
    /** Layer 1+3 결과 — 분류된 queryType + 옵션 + 모델 ID */
    modelSelection: ModelSelection;

    /**
     * Layer 4 결과 — Phase 2-B 에서 채워짐.
     * Phase 1 동안에는 null (LLMClient.chat 시점에 결정).
     */
    capacityDecision: ModelPoolDecision | null;
}

export interface BuildPlanInput {
    /** 사용자 메시지 (분류 + 토큰 추정 입력) */
    message: string;

    /** 이미지 첨부 여부 (vision queryType override) */
    hasImages: boolean;

    /**
     * request-handler 가 미리 만든 ExecutionPlan.
     * Phase 1 에서는 builder 가 그대로 흡수. Phase 2 부터 builder 가 직접 구성.
     */
    executionPlan?: ExecutionPlan;
}
