/**
 * ============================================================
 * Profile Resolver - 외부 API model 필드를 ExecutionPlan으로 변환
 * ============================================================
 *
 * 외부 API 요청의 model 필드를 ChatService 가 소비할 수 있는 실행 계획
 * (ExecutionPlan) 으로 변환합니다. 단일 로컬 모델 환경에서는 모든 요청을
 * 동일한 ExecutionPlan 으로 패스스루합니다.
 *
 * @module chat/profile-resolver
 * @description
 * - buildExecutionPlan(): 모델명 -> ExecutionPlan 생성
 * - listAvailableModels(): 외부 API용 모델 목록 반환 (현재 빈 배열)
 *
 * @see services/ChatService.ts - ExecutionPlan 소비자
 */

import type { ExecutionStrategy } from './pipeline-profile';
import { createLogger } from '../utils/logger';
import type { QueryType } from './model-selector-types';
import { getConfig } from '../config/env';

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
/**
 * ExecutionPlan — 2026-05-26 #I cleanup:
 * dead 필드 6개 제거 (useToolCalling, agentLoopMax, loopStrategy,
 * promptStrategy, contextStrategy, timeBudgetMs). 외부 호출처 0 확인 후 삭제.
 */
export interface ExecutionPlan {
    /** 원본 요청 모델명 */
    requestedModel: string;

    /** 해석된 프로파일 (현재 항상 null — 단일 로컬 모델 환경) */
    profile: null;

    /** 실제 사용할 내부 엔진 모델 ID */
    resolvedEngine: string;

    /** thinking 파라미터 (Gemini think 등) */
    thinkingLevel: 'off' | 'low' | 'medium' | 'high';

    /** 토론(Discussion) 활성화 */
    useDiscussion: boolean;

    /** 필수 도구 목록 */
    requiredTools: string[];

    /** Auto-Routing에서 분류된 원본 QueryType */
    classifiedQueryType?: QueryType;

    /** 실행 전략 — 'single' | 'generate-verify' | 'conditional-verify' */
    executionStrategy: ExecutionStrategy;

    /** Generate-Verify 시 Generator 모델 (executionStrategy가 'single'이면 undefined) */
    generatorModel?: string;

    /** Generate-Verify 시 Verifier 모델 (executionStrategy가 'single'이면 undefined) */
    verifierModel?: string;
}

// ============================================
// 프로파일 해석 함수
// ============================================

/**
 * 요청 모델명으로부터 실행 계획을 생성합니다.
 * 단일 로컬 모델(llmDefaultModel)로 항상 해석합니다.
 *
 * @param requestedModel - 외부 요청의 model 필드
 * @returns ExecutionPlan
 */
export function buildExecutionPlan(
    requestedModel: string,
    _overrides?: Partial<{
        temperature: number;
        maxTokens: number;
        stream: boolean;
    }>
): ExecutionPlan {
    const config = getConfig();
    logger.debug(`buildExecutionPlan: ${requestedModel} → ${config.llmDefaultModel}`);

    return {
        requestedModel,
        profile: null,
        resolvedEngine: config.llmDefaultModel,
        thinkingLevel: 'medium',
        useDiscussion: false,
        requiredTools: [],
        executionStrategy: 'single',
    };
}

/**
 * 외부 API 용 모델 목록 — OpenAI 호환 /v1/models 응답 데이터.
 *
 * 단일 로컬 모델 환경에서는 llmDefaultModel 1개를 노출한다.
 * (이전: 빈 배열 → 외부 OpenAI 호환 클라이언트가 사용 가능 모델 없음으로 인식)
 */
export function listAvailableModels(): Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
}> {
    const config = getConfig();
    const modelId = config.llmDefaultModel;
    return [{
        id: modelId,
        name: modelId,
        description: 'OpenMake LLM — 단일 로컬 모델 (vLLM/LiteLLM)',
        capabilities: ['chat', 'streaming'],
    }];
}
