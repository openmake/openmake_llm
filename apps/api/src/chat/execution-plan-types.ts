/**
 * ============================================================
 * Unified Execution Plan — Phase B Routing Unification
 * ============================================================
 *
 * 기존 layer (model-resolver / classifier) 의 출력을 단일
 * 구조체로 통합합니다. `ExecutionPlan` 과 `ModelSelection` 을 포함합니다.
 * (capacity 결정은 LLMClient.chat per-call 에서 처리 — plan 에 포함하지 않음.)
 *
 * @module chat/execution-plan-types
 * @see chat/execution-plan-builder
 */

import type { ExecutionPlan } from './profile-resolver';
import type { ModelSelection } from './model-selector-types';
import type { Style } from './style';

export interface UnifiedExecutionPlan extends ExecutionPlan {
    /** Layer 1+3 결과 — 분류된 queryType + 옵션 + 모델 ID */
    modelSelection: ModelSelection;

    /** Phase A (2026-05-26): 응답 스타일 축 결과 */
    style: Style;

    /** Phase 2 Custom Agent (2026-05-26): 해석된 사용자 agent. 미설정 시 null */
    userAgent: ResolvedUserAgent | null;
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
    /** 에이전트 전용 모델 fullId (null=상속) — 요청 model 이 자동일 때만 적용 (Phase C) */
    model: string | null;
}
