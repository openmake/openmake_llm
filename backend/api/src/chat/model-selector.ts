/**
 * ============================================================
 * Model Selector - 질문 유형별 모델 프리셋 선택
 * ============================================================
 *
 * 사용자 질문을 분석하여 9가지 QueryType으로 분류하고,
 * 최적의 Ollama 모델 프리셋을 선택합니다.
 *
 * @module chat/model-selector
 * @description
 * - 질문 유형 분류: 정규식 패턴 매칭 + 키워드 가중치 스코어링 알고리즘
 * - 모델 프리셋 선택: QueryType별 최적 모델 매칭 (우선순위 기반)
 * - 모델별 파라미터 조정: 모델 특성에 맞는 temperature, top_p, num_ctx 자동 튜닝
 *
 * 알고리즘 흐름:
 * 1. classifyQuery() - 정규식/키워드로 QueryType 분류 + 신뢰도 계산
 * 2. selectOptimalModel() - QueryType에 맞는 ModelPreset 선택
 * 3. adjustOptionsForModel() - 선택된 모델에 맞게 옵션 미세 조정
 *
 * @see services/ChatService.ts - 최종 모델 선택 결과 소비
 */

import { getConfig } from '../config/env';
import { ModelOptions } from '../llm';
import { createLogger } from '../utils/logger';
import { MODEL_CONTEXT_DEFAULTS } from '../config/runtime-limits';
import { QUERY_TYPE_PARAMS, LLM_TOP_P } from '../config/llm-parameters';
import { recommendTokenBudget } from './complexity-assessor';
import { getModelPresets } from '../config/model-presets';
import { matchCapabilityPreset } from '../config/model-defaults';

const logger = createLogger('ModelSelector');

// Re-export types from model-selector-types
export type { QueryType, QueryClassification, ModelSelection } from './model-selector-types';
import type { QueryType, ModelSelection } from './model-selector-types';

// Re-export classifyQuery from query-classifier
export { classifyQuery } from './query-classifier';
// Import classifyQuery for internal use (via separate name to avoid conflict)
import { classifyQuery as _classifyQuery } from './query-classifier';
// Fast-path: 짧은 인사·단답형 즉시 분기
import { detectFastPath } from './fast-path-detector';

// Re-export ModelPreset and getModelPresets from config for backward compatibility
export { ModelPreset, getModelPresets } from '../config/model-presets';



// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형을 분류하고 단일 로컬 모델(llmDefaultModel)로 응답합니다.
 *
 * Phase B Phase 2-A (2026-05-26): LLM classifier 분기 제거 — fast-path + regex
 * 만 사용. LLM round-trip 0회 보장. classifier 결과는 옵션 튜닝
 * (QUERY_TYPE_PARAMS) 에만 영향하고 model 결정에는 미사용 (Pure Manual 모드)
 * 이라서 LLM 호출 비용 ROI 가 낮았던 4 layer 중 Layer 1 을 제거.
 *
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부 (true면 vision 유형으로 강제 전환)
 * @returns 모델 선택 결과
 */
export async function selectOptimalModel(
    query: string,
    hasImages?: boolean,
): Promise<ModelSelection> {
    const config = getConfig();

    let classifiedType: QueryType;
    let classifiedConfidence: number;
    let classifierSource: 'regex' | 'cache' | 'llm';

    // ── Short-circuit 1: Fast-path (인사·단답형) ──
    const fastPath = detectFastPath(query);
    if (fastPath.matched) {
        classifiedType = 'chat';
        classifiedConfidence = 1.0;
        classifierSource = 'regex';
        logger.info(`Fast-path 매칭(${fastPath.reason}) — queryType=chat`);
    } else {
        // ── Regex 분류 (단일 경로) ──
        const regexResult = _classifyQuery(query);
        classifiedType = regexResult.type;
        classifiedConfidence = regexResult.confidence;
        classifierSource = 'regex';
    }

    if (hasImages) {
        classifiedType = 'vision';
    }

    logger.info(`질문 유형: ${classifiedType} (신뢰도: ${(classifiedConfidence * 100).toFixed(0)}%)`);

    const localModel = config.llmDefaultModel;
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
        classifiedConfidence,
        classifierSource,
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

    // 1차: 모델별 정확한 프리셋 (preset-authoritative — startsWith-longest 공유 매처).
    // 카탈로그 모델의 실제 capability 가 generic profile 보다 우선한다. 이로써
    // checkModelCapability 가 게이팅 경로(getCapabilities)와 동일한 SoT 를 따른다.
    const presetCaps = matchCapabilityPreset(lowerModel);
    if (presetCaps) {
        return presetCaps[capability];
    }

    // 2차: profile fallback (generic 'local-llm' 프리셋) — preset 미등록이나
    // defaultModel 과 관련된 모델명에 대한 포괄 기본값.
    for (const preset of Object.values(getModelPresets())) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities[capability];
        }
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
 * @param _modelName - 대상 모델명 (현재 미사용 — 모델별 sampling 보강 분기 제거됨, 시그니처 보존)
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

