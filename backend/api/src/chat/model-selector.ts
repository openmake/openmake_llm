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
import { createLogger } from '../utils/logger';
import { MODEL_CONTEXT_DEFAULTS } from '../config/runtime-limits';
import { QUERY_TYPE_PARAMS, LLM_TOP_P } from '../config/llm-parameters';
import { recommendTokenBudget } from './complexity-assessor';
import { ModelPreset, getModelPresets } from '../config/model-presets';
import { MODEL_CAPABILITY_PRESETS } from '../config/model-defaults';

const logger = createLogger('ModelSelector');

// Re-export types from model-selector-types
export type { QueryType, QueryClassification, ModelSelection } from './model-selector-types';
import type { QueryType, ModelSelection } from './model-selector-types';

// Re-export classifyQuery from query-classifier
export { classifyQuery } from './query-classifier';
// Import classifyQuery for internal use (via separate name to avoid conflict)
import { classifyQuery as _classifyQuery } from './query-classifier';
// Import LLM classifier
import { classifyWithLLM, getConfidenceThreshold, logDisagreementIfAny } from './llm-classifier';

// Re-export ModelPreset and getModelPresets from config for backward compatibility
export { ModelPreset, getModelPresets } from '../config/model-presets';



// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형을 분류하고 단일 로컬 모델(ollamaDefaultModel)로 응답합니다.
 *
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부 (true면 vision 유형으로 강제 전환)
 * @param history - 이전 대화 히스토리
 * @returns 모델 선택 결과
 */
export async function selectOptimalModel(
    query: string,
    hasImages?: boolean,
    history?: Array<{ role: string; content: string }>,
): Promise<ModelSelection> {
    const config = getConfig();

    let classifiedType: QueryType;
    let classifiedConfidence: number;

    try {
        const llmResult = await classifyWithLLM(query, history);
        if (llmResult && llmResult.confidence >= getConfidenceThreshold()) {
            classifiedType = llmResult.type;
            classifiedConfidence = llmResult.confidence;
            const regexCheck = _classifyQuery(query);
            logDisagreementIfAny(
                query, llmResult.type, llmResult.confidence,
                regexCheck.type, regexCheck.confidence,
                classifiedType, llmResult.source === 'cache' ? 'cache' : 'llm',
            );
        } else {
            const regexResult = _classifyQuery(query);
            classifiedType = regexResult.type;
            classifiedConfidence = regexResult.confidence;
        }
    } catch {
        const regexResult = _classifyQuery(query);
        classifiedType = regexResult.type;
        classifiedConfidence = regexResult.confidence;
    }

    if (hasImages) {
        classifiedType = 'vision';
    }

    logger.info(`질문 유형: ${classifiedType} (신뢰도: ${(classifiedConfidence * 100).toFixed(0)}%)`);

    const localModel = config.ollamaDefaultModel;
    const baseOptions: ModelOptions = {
        temperature: QUERY_TYPE_PARAMS.DEFAULT_TEMP_FALLBACK,
        top_p: LLM_TOP_P.GEMINI_DEFAULT,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
    };
    const adjustedOptions = adjustOptionsForModel(localModel, baseOptions, classifiedType);

    return {
        model: localModel,
        options: adjustedOptions,
        reason: `${classifiedType} → ${localModel}`,
        queryType: classifiedType,
        supportsToolCalling: true,
        supportsThinking: true,
        supportsVision: true,
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
    _modelName: string,
    baseOptions: ModelOptions,
    queryType: QueryType,
    complexityScore?: number
): ModelOptions {
    const adjustedOptions = { ...baseOptions };

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

    // ── 토큰 예산 관리 (num_predict) ──
    // 기존에 num_predict가 설정되지 않은 경우에만 동적 설정
    if (complexityScore !== undefined && !adjustedOptions.num_predict) {
        const budget = recommendTokenBudget(complexityScore, queryType);
        if (budget > 0) {
            adjustedOptions.num_predict = budget;
        }
    }

    return adjustedOptions;
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
    return getModelPresets()['gemma4'].defaultModel;
}
