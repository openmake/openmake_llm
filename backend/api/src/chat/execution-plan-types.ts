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
 */

import type { ExecutionPlan } from './profile-resolver';
import type { ModelSelection } from './model-selector-types';
import type { ModelPoolDecision } from '../llm/model-pool';
import type { Style } from './style';

export interface UnifiedExecutionPlan extends ExecutionPlan {
    /** Layer 1+3 결과 — 분류된 queryType + 옵션 + 모델 ID */
    modelSelection: ModelSelection;

    /**
     * Layer 4 결과 — Phase 2-B 에서 채워짐.
     * Phase 1 동안에는 null (LLMClient.chat 시점에 결정).
     */
    capacityDecision: ModelPoolDecision | null;

    /** Phase A (2026-05-26): 응답 스타일 축 결과 */
    style: Style;

    /** Phase 2 Custom Agent (2026-05-26): 해석된 사용자 agent. 미설정 시 null */
    userAgent: ResolvedUserAgent | null;

    /**
     * Phase D (2026-05-26): brand alias 가 derive 한 mode toggle.
     * ChatService 는 req.thinkingMode || aliasDerived.thinkingMode 식으로 OR 합성.
     * 사용자 명시 toggle 우선.
     */
    aliasDerivedThinkingMode: boolean;
    aliasDerivedDiscussionMode: boolean;
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

    /** Phase A (2026-05-26): per-session 응답 스타일 (concise/default/verbose) */
    style?: Style;

    /**
     * 사용자 정의 Custom Agent id (2026-05-26).
     * 명시 시 18 산업 agent 자동 라우팅 우회 + agent.system_prompt prepend.
     */
    userAgentId?: string;

    /** Custom Agent 조회 시 인증된 user id (소유권 검증) */
    userId?: string;
}

/**
 * Phase 2 Custom Agent (2026-05-26) — builder 가 ChatService 에 전달하는
 * agent 데이터. system prompt prepend + tool/skill 화이트리스트 반영.
 */
export interface ResolvedUserAgent {
    id: string;
    name: string;
    systemPrompt: string;
    allowedTools: string[];
    allowedSkills: string[];
    icon: string | null;
}
