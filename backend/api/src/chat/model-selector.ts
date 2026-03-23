/**
 * ============================================================
 * Model Selector - 질문 유형별 자동 모델 라우팅
 * ============================================================
 * 
 * 사용자 질문을 분석하여 9가지 QueryType으로 분류하고,
 * 최적의 Ollama 모델 프리셋을 자동 선택합니다.
 * Brand model alias(openmake_llm_auto)를 통한 스마트 자동 라우팅도 지원합니다.
 * 
 * @module chat/model-selector
 * @description
 * - 질문 유형 분류: 정규식 패턴 매칭 + 키워드 가중치 스코어링 알고리즘
 * - 모델 프리셋 선택: QueryType별 최적 모델 매칭 (우선순위 기반)
 * - Brand Model 지원: pipeline-profile.ts의 프로파일 기반 ModelSelection 생성
 * - Auto-Routing: openmake_llm_auto 요청 시 질문 유형에 따라 brand profile 자동 선택
 * - 모델별 파라미터 조정: 모델 특성에 맞는 temperature, top_p, num_ctx 자동 튜닝
 * 
 * 자동 라우팅 알고리즘 흐름:
 * 1. classifyQuery() - 정규식/키워드로 QueryType 분류 + 신뢰도 계산
 * 2. selectOptimalModel() - QueryType에 맞는 ModelPreset 선택
 * 3. selectModelForProfile() - Brand model alias인 경우 프로파일 기반 선택
 * 4. selectBrandProfileForAutoRouting() - auto 모드 시 brand profile ID 결정
 * 5. adjustOptionsForModel() - 선택된 모델에 맞게 옵션 미세 조정
 * 
 * @see chat/pipeline-profile.ts - 브랜드 모델 프로파일 정의
 * @see services/ChatService.ts - 최종 모델 선택 결과 소비
 */

import { getConfig } from '../config/env';
import { ModelOptions } from '../ollama/types';
import { isValidBrandModel, getProfiles } from './pipeline-profile';
import { createLogger } from '../utils/logger';
import { MODEL_CONTEXT_DEFAULTS } from '../config/runtime-limits';
import { QUERY_TYPE_PARAMS } from '../config/llm-parameters';
import { applyCostTierCeiling, getDefaultCostTier } from './cost-tier';
import { ModelPreset, getModelPresets } from '../config/model-presets';
import { MODEL_CAPABILITY_PRESETS } from '../config/model-defaults';

const logger = createLogger('ModelSelector');

// Re-export types from model-selector-types
export type { QueryType, QueryClassification, ModelSelection } from './model-selector-types';
import type { QueryType, ModelSelection } from './model-selector-types';

/**
 * Auto-Routing 결과 인터페이스
 * selectBrandProfileForAutoRouting()의 반환 타입으로,
 * 프로파일 ID와 분류 메타데이터를 함께 반환합니다.
 */
export interface AutoRoutingResult {
    /** 선택된 brand model 프로파일 ID (예: 'openmake_llm_code') */
    profileId: string;
    /** Auto-Routing에서 분류된 QueryType */
    classifiedQueryType: QueryType;
    /** 분류 신뢰도 (0.0~1.0) */
    classifiedConfidence: number;
    /** 분류 소스 ('llm' | 'cache' | 'regex') */
    classifierSource: 'llm' | 'cache' | 'regex';
}

// Re-export classifyQuery from query-classifier
export { classifyQuery } from './query-classifier';
// Import classifyQuery for internal use (via separate name to avoid conflict)
import { classifyQuery as _classifyQuery } from './query-classifier';
// Import LLM classifier for Auto-Routing (Phase D)
import { classifyWithLLM, getConfidenceThreshold } from './llm-classifier';

// Re-export ModelPreset and getModelPresets from config for backward compatibility
export { ModelPreset, getModelPresets } from '../config/model-presets';



// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형에 따라 최적의 모델 프리셋을 선택합니다.
 * 
 * 선택 알고리즘:
 * 1. classifyQuery()로 질문 유형 분류 (정규식 + 키워드 스코어링)
 * 2. 이미지 첨부 시 vision으로 강제 전환
 * 3. MODEL_PRESETS에서 해당 유형의 bestFor에 포함된 프리셋 검색
 * 4. priority가 가장 낮은(=우선순위 높은) 프리셋 선택
 * 5. 매칭 실패 시 gemini-flash 폴백
 * 6. .env에서 실제 모델명 resolve
 * 
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부 (true면 vision 모델 강제 선택)
 * @returns 모델 선택 결과 (모델명, 옵션, 사유, 기능 플래그)
 */
export async function selectOptimalModel(query: string, hasImages?: boolean): Promise<ModelSelection> {
    const config = getConfig();

    // ── LLM 분류 우선, 실패/신뢰도 부족/예외 시 regex fallback ──
    let classifiedType: QueryType;
    let classifiedConfidence: number;

    try {
        const llmResult = await classifyWithLLM(query);
        if (llmResult && llmResult.confidence >= getConfidenceThreshold()) {
            classifiedType = llmResult.type;
            classifiedConfidence = llmResult.confidence;
            logger.info(`[selectOptimalModel] LLM 분류: ${classifiedType} (${(classifiedConfidence * 100).toFixed(0)}%) [source=${llmResult.source}]`);
        } else {
            const regexResult = _classifyQuery(query);
            classifiedType = regexResult.type;
            classifiedConfidence = regexResult.confidence;
            logger.info(`[selectOptimalModel] Regex fallback: ${classifiedType} (${(classifiedConfidence * 100).toFixed(0)}%)`);
        }
    } catch (error) {
        const regexResult = _classifyQuery(query);
        classifiedType = regexResult.type;
        classifiedConfidence = regexResult.confidence;
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`[selectOptimalModel] LLM 분류 예외 → regex fallback: ${classifiedType} (${errMsg})`);
    }

    // 이미지가 첨부된 경우 비전 모델 강제 선택
    if (hasImages) {
        classifiedType = 'vision';
    }

    logger.info(`질문 유형: ${classifiedType} (신뢰도: ${(classifiedConfidence * 100).toFixed(0)}%)`);

    // 질문 유형에 맞는 최적 모델 찾기
    let selectedPreset: ModelPreset | null = null;
    let lowestPriority = Infinity;

    for (const [, preset] of Object.entries(getModelPresets())) {
        if (preset.bestFor.includes(classifiedType)) {
            if (preset.priority < lowestPriority) {
                lowestPriority = preset.priority;
                selectedPreset = preset;
            }
        }
    }

    // 폴백: Gemini Flash (기본)
    if (!selectedPreset) {
        selectedPreset = getModelPresets()['gemini-flash'];
    }

    // 실제 모델명 해석: 분류로 선택된 프리셋 모델을 우선 사용하고,
    // 프리셋이 비어 있는 비정상 케이스에서만 OLLAMA_DEFAULT_MODEL로 폴백
    const actualModel = selectedPreset.defaultModel || config.ollamaDefaultModel;

    logger.info(`선택된 모델: ${selectedPreset.name} (${actualModel})`);

    return {
        model: actualModel,
        options: selectedPreset.options,
        reason: `${classifiedType} 질문 → ${selectedPreset.name} 사용`,
        queryType: classifiedType,
        supportsToolCalling: selectedPreset.capabilities.toolCalling,
        supportsThinking: selectedPreset.capabilities.thinking,
        supportsVision: selectedPreset.capabilities.vision,
    };
}

// ============================================================
// 모델 호환성 체크
// ============================================================

/**
 * 모델이 특정 기능을 지원하는지 확인합니다.
 * MODEL_PRESETS에서 모델명을 검색하여 해당 기능 플래그를 반환합니다.
 * 
 * @param modelName - 확인할 모델명
 * @param capability - 확인할 기능 ('toolCalling' | 'thinking' | 'vision' | 'streaming')
 * @returns 해당 기능 지원 여부
 */
export function checkModelCapability(
    modelName: string,
    capability: 'toolCalling' | 'thinking' | 'vision' | 'streaming'
): boolean {
    const lowerModel = modelName.toLowerCase();

    // 1차: 모델명으로 프리셋 찾기 (정확한 매칭)
    for (const preset of Object.values(getModelPresets())) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities[capability];
        }
    }

    // 2차: MODEL_CAPABILITY_PRESETS에서 프리픽스 매칭 (longest match 우선)
    // Auto-Routing 맵의 모델(kimi, deepseek, cogito 등)이 프리셋에 없을 때 사용
    let bestMatch: { prefix: string; caps: typeof MODEL_CAPABILITY_PRESETS[string] } | null = null;
    for (const [prefix, caps] of Object.entries(MODEL_CAPABILITY_PRESETS)) {
        if (lowerModel.includes(prefix) && (!bestMatch || prefix.length > bestMatch.prefix.length)) {
            bestMatch = { prefix, caps };
        }
    }
    if (bestMatch) {
        return bestMatch.caps[capability];
    }

    // 3차: 알 수 없는 모델은 보수적 기본값 반환
    const defaults: Record<string, boolean> = {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    };
    return defaults[capability] ?? false;
}

/**
 * 모델의 최대 컨텍스트 길이(토큰)를 반환합니다.
 * MODEL_PRESETS에서 검색하며, 미발견 시 기본값 32768을 반환합니다.
 * 
 * @param modelName - 확인할 모델명
 * @returns 최대 컨텍스트 길이 (토큰 단위)
 */
export function getModelContextLength(modelName: string): number {
    const lowerModel = modelName.toLowerCase();

    for (const preset of Object.values(getModelPresets())) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities.contextLength;
        }
    }

    // 기본값
    return MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX;
}

// ============================================================
// 모델별 파라미터 조정
// ============================================================

/**
 * 특정 모델과 질문 유형에 맞게 모델 옵션을 미세 조정합니다.
 * 
 * 모델별 조정:
 * - Qwen Coder: temperature <= 0.3, repeat_penalty = 1.0
 * - Kimi: num_ctx >= 65536 (긴 문서 지원)
 * - Vision 모델: temperature = 0.6
 * 
 * 질문 유형별 조정:
 * - code: temperature <= 0.3 (정확성 우선)
 * - creative: temperature >= 0.85 (창의성 우선)
 * - math: temperature = 0.1 (결정적 응답)
 * - translation: temperature = 0.3, repeat_penalty = 1.2
 * 
 * @param modelName - 대상 모델명
 * @param baseOptions - 기본 모델 옵션
 * @param queryType - 질문 유형
 * @returns 조정된 모델 옵션 (원본 불변)
 */
export function adjustOptionsForModel(
    modelName: string, 
    baseOptions: ModelOptions,
    queryType: QueryType
): ModelOptions {
    const lowerModel = modelName.toLowerCase();
    const adjustedOptions = { ...baseOptions };

    // Qwen Coder: 코딩에 특화된 낮은 temperature
    if (lowerModel.includes('qwen') && lowerModel.includes('coder')) {
        adjustedOptions.temperature = Math.min(adjustedOptions.temperature || QUERY_TYPE_PARAMS.DEFAULT_TEMP_FALLBACK, QUERY_TYPE_PARAMS.QWEN_CODER_TEMP_CAP);
        adjustedOptions.repeat_penalty = 1.0;
    }

    // Kimi: 긴 컨텍스트 윈도우 지원 (128K+ 토큰)
    if (lowerModel.includes('kimi')) {
        adjustedOptions.num_ctx = Math.max(adjustedOptions.num_ctx || MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX, MODEL_CONTEXT_DEFAULTS.EXTENDED_NUM_CTX);
    }

    // Vision 모델: 이미지 분석에 적합한 설정
    if (lowerModel.includes('vl') || lowerModel.includes('vision')) {
        adjustedOptions.temperature = QUERY_TYPE_PARAMS.VISION_TEMP;
    }

    // 질문 유형별 추가 조정
    switch (queryType) {
        case 'code-agent':
        case 'code-gen':
        case 'code':
            adjustedOptions.temperature = Math.min(adjustedOptions.temperature || QUERY_TYPE_PARAMS.DEFAULT_TEMP_FALLBACK, QUERY_TYPE_PARAMS.CODE_TEMP_CAP);
            adjustedOptions.repeat_penalty = 1.0;
            break;
        case 'creative':
            adjustedOptions.temperature = Math.max(adjustedOptions.temperature || QUERY_TYPE_PARAMS.DEFAULT_TEMP_FALLBACK, QUERY_TYPE_PARAMS.CREATIVE_TEMP_FLOOR);
            adjustedOptions.top_p = QUERY_TYPE_PARAMS.CREATIVE_TOP_P;
            break;
        case 'math-hard':
        case 'math-applied':
        case 'math':
            adjustedOptions.temperature = QUERY_TYPE_PARAMS.MATH_TEMP;
            adjustedOptions.top_p = QUERY_TYPE_PARAMS.MATH_TOP_P;
            break;
        case 'reasoning':
            adjustedOptions.temperature = QUERY_TYPE_PARAMS.REASONING_TEMP;
            adjustedOptions.top_p = QUERY_TYPE_PARAMS.REASONING_TOP_P;
            break;
        case 'translation':
            adjustedOptions.temperature = QUERY_TYPE_PARAMS.TRANSLATION_TEMP;
            adjustedOptions.repeat_penalty = QUERY_TYPE_PARAMS.TRANSLATION_REPEAT_PENALTY;
            break;
    }

    return adjustedOptions;
}

// ============================================================
// §9 Brand Model Alias 지원
// ============================================================

/**
 * Brand model alias를 감지하여 프로파일 기반 ModelSelection을 반환합니다.
 * Brand model이 아닌 경우 null을 반환합니다.
 * 
 * @param requestedModel - 요청된 모델명 (예: "openmake_llm_pro")
 * @returns ModelSelection 또는 null
 */
export async function selectModelForProfile(requestedModel: string, query?: string, hasImages?: boolean): Promise<ModelSelection | null> {
    if (!isValidBrandModel(requestedModel)) {
        return null;
    }

    const profiles = getProfiles();
    const profile = profiles[requestedModel];
    if (!profile) return null;

    // __auto__ 엔진: brand model 프로파일 자동 라우팅
    // 이 함수에서는 brand model 프로파일 ID만 반환 (실제 라우팅은 ChatService에서 buildExecutionPlan 사용)
    if (profile.engineModel === '__auto__') {
        const autoRoutingResult = await selectBrandProfileForAutoRouting(query || '', hasImages);
        const targetProfile = autoRoutingResult.profileId;
        const targetProfiles = getProfiles();
        const resolvedProfile = targetProfiles[targetProfile];
        if (resolvedProfile) {
            logger.info(`§9 Auto-Routing: ${requestedModel} → ${targetProfile} (engine=${resolvedProfile.engineModel})`);
            return {
                model: resolvedProfile.engineModel,
                options: {
                    temperature: resolvedProfile.thinking === 'high' ? 0.3 : resolvedProfile.thinking === 'off' ? 0.7 : 0.5,
                    num_ctx: resolvedProfile.contextStrategy === 'full' ? MODEL_CONTEXT_DEFAULTS.EXTENDED_NUM_CTX : MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
                },
                reason: `Auto-Routing → ${resolvedProfile.displayName} → ${resolvedProfile.engineModel}`,
                queryType: autoRoutingResult.classifiedQueryType,
                supportsToolCalling: true,
                supportsThinking: resolvedProfile.thinking !== 'off',
                supportsVision: resolvedProfile.requiredTools.includes('vision'),
            };
        }
        // Fallback: 프로파일을 못 찾으면 기존 자동 선택
        const autoSelection = await selectOptimalModel(query || '', hasImages);
        logger.info(`§9 Auto-Routing Fallback: ${requestedModel} → ${autoSelection.model}`);
        return autoSelection;
    }

    logger.info(`§9 Brand Model: ${requestedModel} → engine=${profile.engineModel}`);

    return {
        model: profile.engineModel,
        options: {
            temperature: profile.thinking === 'high' ? 0.3 : profile.thinking === 'off' ? 0.7 : 0.5,
            num_ctx: profile.contextStrategy === 'full' ? MODEL_CONTEXT_DEFAULTS.EXTENDED_NUM_CTX : MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        reason: `Brand model ${profile.displayName} → ${profile.engineModel}`,
        queryType: profile.promptStrategy === 'force_coder' ? 'code-gen'
            : profile.promptStrategy === 'force_reasoning' ? 'math-applied'
            : profile.promptStrategy === 'force_creative' ? 'creative'
            : 'chat',
        supportsToolCalling: true,
        supportsThinking: profile.thinking !== 'off',
        supportsVision: profile.requiredTools.includes('vision'),
    };
}

// ============================================================
// §9 Auto-Routing: Brand Model 프로파일 자동 라우팅
// ============================================================

/**
 * openmake_llm_auto 사용 시 질문 유형에 따라 적합한 brand model 프로파일 ID를 반환합니다.
 * 
 * 내부 엔진 모델이 아닌 brand model 프로파일(openmake_llm_pro, _fast, _think, _code, _vision)로
 * 라우팅하여 해당 프로파일의 전체 ExecutionPlan(에이전트 루프, thinking, 프롬프트 전략 등)을 적용합니다.
 * 
 * 매핑 (5개 대상 모델: pro/fast/think/code/vision):
 *   code           → openmake_llm_code    (코드 전문)
 *   math           → openmake_llm_think   (심층 추론)
 *   creative       → openmake_llm_pro     (프리미엄 창작)
 *   analysis       → openmake_llm_pro     (복잡한 분석)
 *   document       → openmake_llm_pro     (문서 분석)
 *   vision         → openmake_llm_vision  (멀티모달)
 *   translation    → openmake_llm_pro     (고품질 번역)
 *   korean         → openmake_llm_pro     (한국어 고품질)
 *   chat (간단)    → openmake_llm_fast    (빠른 응답)
 *   chat (복잡)    → openmake_llm_pro     (프리미엄 대화)
 * 
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부
 * @returns brand model 프로파일 ID (예: 'openmake_llm_code')
 */
export async function selectBrandProfileForAutoRouting(query: string, hasImages?: boolean): Promise<AutoRoutingResult> {
    // 이미지가 첨부되면 무조건 vision 프로파일
    if (hasImages) {
        logger.info('§9 Auto-Routing: 이미지 감지 → openmake_llm_vision');
        return {
            profileId: 'openmake_llm_vision',
            classifiedQueryType: 'vision',
            classifiedConfidence: 1.0,
            classifierSource: 'regex',
        };
    }

    // ── Phase D: LLM 분류기 우선 시도, 실패 시 regex fallback ──
    let classifiedType: QueryType;
    let classifiedConfidence: number;
    let classifierSource: 'llm' | 'cache' | 'regex' = 'regex';

    let llmResult: Awaited<ReturnType<typeof classifyWithLLM>> = null;
    try {
        llmResult = await classifyWithLLM(query);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`[selectBrandProfileForAutoRouting] LLM 분류 예외 → regex fallback (${errMsg})`);
    }

    if (llmResult && llmResult.confidence >= getConfidenceThreshold()) {
        // LLM 분류 성공 + 신뢰도 충분
        classifiedType = llmResult.type;
        classifiedConfidence = llmResult.confidence;
        classifierSource = llmResult.source === 'cache' ? 'cache' : 'llm';
        logger.info(`§9 LLM 분류: ${classifiedType} (${(classifiedConfidence * 100).toFixed(0)}%) [source=${classifierSource}]`);
    } else {
        // LLM 분류 실패 또는 신뢰도 부족 → regex fallback
        const regexClassification = _classifyQuery(query);
        classifiedType = regexClassification.type;
        classifiedConfidence = regexClassification.confidence;
        classifierSource = 'regex';
        if (llmResult) {
            logger.info(`§9 LLM 신뢰도 부족 (${(llmResult.confidence * 100).toFixed(0)}% < ${(getConfidenceThreshold() * 100).toFixed(0)}%) → regex fallback: ${classifiedType}`);
        } else {
            logger.info(`§9 LLM 분류 실패 → regex fallback: ${classifiedType}`);
        }
    }

    let targetProfile: string;

    switch (classifiedType) {
        case 'code-agent':
        case 'code-gen':
        case 'code':
            targetProfile = 'openmake_llm_code';
            break;
        case 'math-hard':
        case 'math-applied':
        case 'math':
        case 'reasoning':
            targetProfile = 'openmake_llm_think';
            break;
        case 'creative':
        case 'analysis':
        case 'document':
            targetProfile = 'openmake_llm_pro';
            break;
        case 'vision':
            targetProfile = 'openmake_llm_vision';
            break;
        case 'chat':
            // 짧은 인사/간단한 질문은 fast, 복잡한 대화는 pro
            if (classifiedConfidence < 0.3 && query.length < 50) {
                targetProfile = 'openmake_llm_fast';
            } else {
                targetProfile = 'openmake_llm_pro';
            }
            break;
        case 'translation':
        case 'korean':
            targetProfile = 'openmake_llm_pro';
            break;
        default:
            targetProfile = 'openmake_llm_fast';
            break;
    }

    // P2-1: Cost tier ceiling
    const maxTier = getDefaultCostTier();
    if (maxTier !== 'premium') {
        const originalProfile = targetProfile;
        targetProfile = applyCostTierCeiling(targetProfile, maxTier, classifiedType);
        if (targetProfile !== originalProfile) {
            logger.info(`§9 Cost-Tier: ${originalProfile} → ${targetProfile} (ceiling=${maxTier})`);
        }
    }

    logger.info(`§9 Auto-Routing: ${classifiedType} (confidence=${(classifiedConfidence * 100).toFixed(0)}%, source=${classifierSource}) → ${targetProfile}`);
    return {
        profileId: targetProfile,
        classifiedQueryType: classifiedType,
        classifiedConfidence,
        classifierSource,
    };
}

// ============================================================
// 레거시 호환성 (기존 함수 유지)
// ============================================================

/**
 * @deprecated selectOptimalModel() 사용 권장
 */
export async function selectOptimalModelLegacy(query: string): Promise<{ model: string; reason: string }> {
    const selection = await selectOptimalModel(query);
    return {
        model: selection.model,
        reason: selection.reason,
    };
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 사용 가능한 모든 모델 프리셋 목록을 반환합니다.
 * 
 * @returns 프리셋 ID, 이름, 적합한 질문 유형 배열
 */
export function getAvailablePresets(): Array<{ id: string; name: string; bestFor: QueryType[] }> {
    return Object.entries(getModelPresets()).map(([id, preset]) => ({
        id,
        name: preset.name,
        bestFor: preset.bestFor,
    }));
}

/**
 * 질문 유형별 추천 모델명을 반환합니다.
 * bestFor 배열의 첫 번째 항목이 일치하는 프리셋의 defaultModel을 반환합니다.
 * 
 * @param queryType - 질문 유형
 * @returns 추천 모델명 (폴백: gemini-flash의 defaultModel)
 */
export function getRecommendedModel(queryType: QueryType): string {
    for (const preset of Object.values(getModelPresets())) {
        if (preset.bestFor[0] === queryType) {
            return preset.defaultModel;
        }
    }
    return getModelPresets()['gemini-flash'].defaultModel;
}
