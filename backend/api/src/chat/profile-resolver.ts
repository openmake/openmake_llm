/**
 * ============================================================
 * Profile Resolver - Brand Model Alias를 ExecutionPlan으로 변환
 * ============================================================
 * 
 * 외부 API 요청의 model 필드를 파이프라인 프로파일로 변환하고,
 * ChatService가 소비할 수 있는 실행 계획(ExecutionPlan)을 생성합니다.
 * Brand model이 아닌 일반 모델은 기본 설정으로 패스스루됩니다.
 * 
 * @module chat/profile-resolver
 * @description
 * - resolveProfile(): 모델명 -> PipelineProfile 변환 (brand model 아니면 null)
 * - buildExecutionPlan(): 모델명 -> 완전한 ExecutionPlan 생성 (brand/일반 모두 지원)
 * - listAvailableModels(): 외부 API용 brand model 목록 반환
 * 
 * 실행 흐름:
 * API 요청 (model='openmake_llm_pro') -> resolveProfile() -> buildExecutionPlan() -> ChatService
 * 
 * @see chat/pipeline-profile.ts - PipelineProfile 정의
 * @see services/ChatService.ts - ExecutionPlan 소비자
 * @see docs/api/API_KEY_SERVICE_PLAN.md 9절
 */

import { PipelineProfile, getProfiles, isValidBrandModel } from './pipeline-profile';
import { createLogger } from '../utils/logger';

const logger = createLogger('ProfileResolver');

// ============================================
// 실행 계획 인터페이스
// ============================================

/**
 * 파이프라인 실행 계획
 * 
 * ChatService가 소비하는 구조체로,
 * 프로파일의 설정을 구체적인 실행 파라미터로 변환한 결과입니다.
 */
export interface ExecutionPlan {
    /** 원본 요청 모델명 (brand alias 또는 원본 모델) */
    requestedModel: string;

    /** 해석된 프로파일 (없으면 기본 모델 직접 사용) */
    profile: PipelineProfile | null;

    /** 실제 사용할 내부 엔진 모델 ID */
    resolvedEngine: string;

    /** A2A 에이전트 루프 활성화 여부 */
    useAgentLoop: boolean;

    /** 에이전트 루프 최대 반복 */
    agentLoopMax: number;

    /** 에이전트 루프 실행 방식 */
    loopStrategy: 'parallel' | 'sequential' | 'auto';

    /** thinking 파라미터 (Gemini think 등) */
    thinkingLevel: 'off' | 'low' | 'medium' | 'high';

    /** 토론(Discussion) 활성화 */
    useDiscussion: boolean;

    /** 프롬프트 전략 */
    promptStrategy: 'auto' | 'force_coder' | 'force_reasoning' | 'force_creative' | 'none';

    /** 컨텍스트 윈도우 전략 */
    contextStrategy: 'full' | 'lite' | 'auto';

    /** 시간 예산 (ms) — 0이면 무제한 */
    timeBudgetMs: number;

    /** 필수 도구 목록 */
    requiredTools: string[];

    /** brand model 여부 (외부 API Key 요청인지 판별) */
    isBrandModel: boolean;
}

// ============================================
// 프로파일 해석 함수
// ============================================

/**
 * 요청 모델명을 파이프라인 프로파일로 해석
 * 
 * @param requestedModel - 외부 요청의 model 필드 (예: "openmake_llm_pro")
 * @returns 해석된 PipelineProfile 또는 null (brand model이 아닌 경우)
 */
export function resolveProfile(requestedModel: string): PipelineProfile | null {
    if (!isValidBrandModel(requestedModel)) {
        return null;
    }

    const profiles = getProfiles();
    return profiles[requestedModel] || null;
}

/**
 * 요청 모델명으로부터 완전한 실행 계획을 생성
 * 
 * Brand model이면 프로파일 기반으로 실행 계획을 구성하고,
 * 일반 모델이면 기본 설정으로 패스스루합니다.
 * 
 * @param requestedModel - 외부 요청의 model 필드
 * @param overrides - 사용자 요청의 오버라이드 파라미터
 */
export function buildExecutionPlan(
    requestedModel: string,
    overrides?: Partial<{
        temperature: number;
        maxTokens: number;
        stream: boolean;
    }>
): ExecutionPlan {
    const profile = resolveProfile(requestedModel);

    if (profile) {
        // Brand model → 프로파일 기반 실행 계획
        logger.info(`Brand model 해석: ${requestedModel} → engine=${profile.engineModel}`);

        return {
            requestedModel,
            profile,
            resolvedEngine: profile.engineModel,
            useAgentLoop: profile.a2a !== 'off',
            agentLoopMax: profile.agentLoopMax,
            loopStrategy: profile.loopStrategy,
            thinkingLevel: profile.thinking,
            useDiscussion: profile.discussion,
            promptStrategy: profile.promptStrategy,
            contextStrategy: profile.contextStrategy,
            timeBudgetMs: profile.timeBudgetSeconds * 1000,
            requiredTools: profile.requiredTools,
            isBrandModel: true,
        };
    }

    // 일반 모델 → 기본 패스스루 (기존 동작 유지)
    logger.debug(`일반 모델 패스스루: ${requestedModel}`);

    return {
        requestedModel,
        profile: null,
        resolvedEngine: requestedModel,
        useAgentLoop: false,
        agentLoopMax: 5,
        loopStrategy: 'auto',
        thinkingLevel: 'medium',
        useDiscussion: false,
        promptStrategy: 'auto',
        contextStrategy: 'auto',
        timeBudgetMs: 0,
        requiredTools: [],
        isBrandModel: false,
    };
}

/**
 * 모든 사용 가능한 brand model 목록을 외부 API용 형식으로 반환합니다.
 * 각 모델의 ID, 이름, 설명, 지원 기능(agent, thinking, discussion 등)을 포함합니다.
 * 
 * @returns 외부 API 응답용 모델 목록 배열
 */
export function listAvailableModels(): Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
}> {
    const profiles = getProfiles();

    return Object.values(profiles).map(p => ({
        id: p.id,
        name: p.displayName,
        description: p.description,
        capabilities: [
            ...(p.a2a !== 'off' ? ['agent'] : []),
            ...(p.thinking !== 'off' ? ['thinking'] : []),
            ...(p.discussion ? ['discussion'] : []),
            ...p.requiredTools,
        ],
    }));
}
