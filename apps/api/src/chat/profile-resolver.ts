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
 * - listAvailableModels(): 외부 API용 모델 목록 반환
 *
 * @see services/ChatService.ts - ExecutionPlan 소비자
 */

import { createLogger } from '../utils/logger';
import { getConfig } from '../config/env';

const logger = createLogger('ProfileResolver');

// ============================================
// 실행 계획 인터페이스
// ============================================

/**
 * 파이프라인 실행 전략 — 단일 경로만 남았다.
 *
 * 구 'generate-verify'·'conditional-verify' 는 2026-07-18 strategy 계층 폐기
 * (tail 셰도우 1.9% 근거) 로 생성되지 않는다. 이 타입만 담고 있던
 * chat/pipeline-profile.ts 는 2026-09-18 정리에서 제거하고 여기로 흡수했다.
 */
export type ExecutionStrategy = 'single';

/**
 * 파이프라인 실행 계획
 *
 * ChatService가 소비하는 구조체로,
 * 프로파일의 설정을 구체적인 실행 파라미터로 변환한 결과입니다.
 *
 * dead 필드 정리 이력 — 외부 호출처 0 확인 후 삭제:
 * - 2026-05-26: useToolCalling·agentLoopMax·loopStrategy·promptStrategy·
 *   contextStrategy·timeBudgetMs (6개)
 * - 2026-09-18: profile·classifiedQueryType·generatorModel·verifierModel (4개,
 *   strategy 계층 폐기 잔재)
 */
export interface ExecutionPlan {
    /** 원본 요청 모델명 */
    requestedModel: string;

    /** 실제 사용할 내부 엔진 모델 ID */
    resolvedEngine: string;

    /** thinking(추론) 강도 */
    thinkingLevel: 'off' | 'low' | 'medium' | 'high';

    /** 토론(Discussion) 활성화 */
    useDiscussion: boolean;

    /** 필수 도구 목록 */
    requiredTools: string[];

    /** 실행 전략 — 단일 경로 */
    executionStrategy: ExecutionStrategy;
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
