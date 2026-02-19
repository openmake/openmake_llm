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

// Re-export types from model-selector-types
export type { QueryType, QueryClassification, ModelSelection } from './model-selector-types';
import type { QueryType, ModelSelection } from './model-selector-types';

// Re-export classifyQuery from query-classifier
export { classifyQuery } from './query-classifier';
// Import classifyQuery for internal use (via separate name to avoid conflict)
import { classifyQuery as _classifyQuery } from './query-classifier';
import type { QueryClassification } from './model-selector-types';

// ============================================================
// 모델 프리셋 정의
// ============================================================

/**
 * 모델 프리셋 정의 인터페이스
 * 각 모델의 기본 설정, 기능, 적합한 질문 유형을 정의합니다.
 */
interface ModelPreset {
    /** 모델 표시 이름 (예: 'Gemini 3 Flash') */
    name: string;
    /** .env 변수명 (예: 'OLLAMA_MODEL_1') */
    envKey: string;
    /** 기본 모델명 (env 미설정 시 사용) */
    defaultModel: string;
    /** 모델 기본 옵션 (temperature, top_p 등) */
    options: ModelOptions;
    /** 모델 기능 플래그 */
    capabilities: {
        /** 도구 호출 지원 */
        toolCalling: boolean;
        /** 사고 모드 지원 */
        thinking: boolean;
        /** 비전(이미지) 지원 */
        vision: boolean;
        /** 스트리밍 지원 */
        streaming: boolean;
        /** 최대 컨텍스트 길이 (토큰) */
        contextLength: number;
    };
    /** 이 모델이 최적인 질문 유형 목록 */
    bestFor: QueryType[];
    /** 선택 우선순위 (낮을수록 높음, 동일 QueryType 내에서 비교) */
    priority: number;
}

// 사용 가능한 모델 프리셋
const MODEL_PRESETS: Record<string, ModelPreset> = {
    // Gemini 3 Flash - 범용/코딩/분석
    'gemini-flash': {
        name: 'Gemini 3 Flash',
        envKey: 'OLLAMA_MODEL_1',
        defaultModel: 'gemini-3-flash-preview:cloud',
        options: {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            num_ctx: 32768,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['code', 'analysis', 'chat', 'korean', 'document'],
        priority: 1,
    },

    // GPT-OSS 120B - 고성능 추론/창작
    'gpt-oss': {
        name: 'GPT-OSS 120B',
        envKey: 'OLLAMA_MODEL_2',
        defaultModel: 'gpt-oss:120b-cloud',
        options: {
            temperature: 0.8,
            top_p: 0.95,
            top_k: 50,
            num_ctx: 32768,
            repeat_penalty: 1.15,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['creative', 'analysis', 'document'],
        priority: 2,
    },

    // Kimi K2.5 - 긴 컨텍스트/문서 분석
    'kimi': {
        name: 'Kimi K2.5',
        envKey: 'OLLAMA_MODEL_3',
        defaultModel: 'kimi-k2.5:cloud',
        options: {
            temperature: 0.5,
            top_p: 0.85,
            top_k: 30,
            num_ctx: 65536,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 65536,
        },
        bestFor: ['document', 'analysis', 'translation'],
        priority: 3,
    },

    // Qwen3 Coder Next - 코딩 특화
    'qwen-coder': {
        name: 'Qwen3 Coder Next',
        envKey: 'OLLAMA_MODEL_4',
        defaultModel: 'qwen3-coder-next:cloud',
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 20,
            num_ctx: 32768,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['code'],
        priority: 1,  // 코딩에 최우선
    },

    // Qwen3 VL 235B - 비전/멀티모달
    'qwen-vl': {
        name: 'Qwen3 VL 235B',
        envKey: 'OLLAMA_MODEL_5',
        defaultModel: 'qwen3-vl:235b-cloud',
        options: {
            temperature: 0.6,
            top_p: 0.9,
            top_k: 40,
            num_ctx: 32768,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['vision'],
        priority: 1,  // 비전에 최우선
    },

    // 수학/과학 특화 프리셋
    'math-reasoning': {
        name: 'Math Reasoning',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'gemini-3-flash-preview:cloud',
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 15,
            num_ctx: 32768,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['math'],
        priority: 1,
    },
};

// ============================================================
// LLM 기반 질문 분류 함수
// ============================================================

/**
 * LLM 기반 질문 분류 (Ollama Structured Output)
 * 
 * 코드 엔진 모델을 사용하여 질문을 분류합니다.
 * 실패 시 정규식 기반 classifyQuery()로 폴백합니다.
 * 
 * @param query - 사용자 질문
 * @returns 분류 결과 (LLM 또는 regex 폴백)
 */
async function classifyQueryWithLLM(query: string): Promise<QueryClassification> {
    // 매우 짧은 쿼리(20자 미만)는 regex로 충분
    if (query.length < 20) {
        return _classifyQuery(query);
    }

    try {
        const config = getConfig();
        const engineModel = config.omkEngineCode || config.ollamaModel;

        // Ollama에 직접 HTTP 요청 (createClient 없이 경량 호출)
        const ollamaHost = config.ollamaHost;
        const response = await fetch(`${ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: engineModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a query classifier. Classify the user query into exactly one category. Respond ONLY with the JSON object.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                format: {
                    type: 'object',
                    properties: {
                        category: {
                            type: 'string',
                            enum: ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation']
                        },
                        confidence: {
                            type: 'number',
                            description: 'Classification confidence between 0.0 and 1.0'
                        }
                    },
                    required: ['category', 'confidence']
                },
                stream: false,
                options: { temperature: 0, num_predict: 50 }
            }),
            signal: AbortSignal.timeout(3000) // 3초 타임아웃
        });

        if (!response.ok) {
            throw new Error(`Ollama responded with ${response.status}`);
        }

        const result = await response.json() as { message?: { content?: string } };
        const content = result?.message?.content;
        if (!content) {
            throw new Error('Empty response from Ollama');
        }

        const parsed = JSON.parse(content) as { category: string; confidence: number };
        const validTypes: QueryType[] = ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation'];

        if (!validTypes.includes(parsed.category as QueryType)) {
            throw new Error(`Invalid category: ${parsed.category}`);
        }

        console.log(`[ModelSelector] LLM 분류: ${parsed.category} (confidence=${(parsed.confidence * 100).toFixed(0)}%)`);

        return {
            type: parsed.category as QueryType,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
            matchedPatterns: ['llm-structured-output'],
        };
    } catch (error) {
        // LLM 실패 → regex 폴백 (silent)
        console.debug(`[ModelSelector] LLM 분류 실패, regex 폴백:`, error instanceof Error ? error.message : String(error));
        return _classifyQuery(query);
    }
}

// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형에 따라 최적의 모델 프리셋을 선택합니다.
 * 
 * 선택 알고리즘:
 * 1. classifyQueryWithLLM()으로 질문 유형 분류 (LLM 우선, regex 폴백)
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
    const classification = await classifyQueryWithLLM(query);

    // 이미지가 첨부된 경우 비전 모델 강제 선택
    if (hasImages) {
        classification.type = 'vision';
    }

    console.log(`[ModelSelector] 질문 유형: ${classification.type} (신뢰도: ${(classification.confidence * 100).toFixed(0)}%)`);
    console.log(`[ModelSelector] 매칭 패턴: ${classification.matchedPatterns.join(', ')}`);

    // 질문 유형에 맞는 최적 모델 찾기
    let selectedPreset: ModelPreset | null = null;
    let lowestPriority = Infinity;

    for (const [, preset] of Object.entries(MODEL_PRESETS)) {
        if (preset.bestFor.includes(classification.type)) {
            if (preset.priority < lowestPriority) {
                lowestPriority = preset.priority;
                selectedPreset = preset;
            }
        }
    }

    // 폴백: Gemini Flash (기본)
    if (!selectedPreset) {
        selectedPreset = MODEL_PRESETS['gemini-flash'];
    }

    // .env에서 실제 모델명 가져오기 (기본 모델 사용)
    const actualModel = config.ollamaDefaultModel || selectedPreset.defaultModel;

    console.log(`[ModelSelector] 선택된 모델: ${selectedPreset.name} (${actualModel})`);

    return {
        model: actualModel,
        options: selectedPreset.options,
        reason: `${classification.type} 질문 → ${selectedPreset.name} 사용`,
        queryType: classification.type,
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

    // 모델명으로 프리셋 찾기
    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) || 
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities[capability];
        }
    }

    // 알 수 없는 모델은 기본값 반환
    const defaults: Record<string, boolean> = {
        toolCalling: true,
        thinking: true,
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

    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities.contextLength;
        }
    }

    // 기본값
    return 32768;
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
        adjustedOptions.temperature = Math.min(adjustedOptions.temperature || 0.7, 0.3);
        adjustedOptions.repeat_penalty = 1.0;
    }

    // Kimi: 긴 문서에 적합한 설정
    if (lowerModel.includes('kimi')) {
        adjustedOptions.num_ctx = Math.max(adjustedOptions.num_ctx || 32768, 65536);
    }

    // Vision 모델: 이미지 분석에 적합한 설정
    if (lowerModel.includes('vl') || lowerModel.includes('vision')) {
        adjustedOptions.temperature = 0.6;
    }

    // 질문 유형별 추가 조정
    switch (queryType) {
        case 'code':
            adjustedOptions.temperature = Math.min(adjustedOptions.temperature || 0.7, 0.3);
            adjustedOptions.repeat_penalty = 1.0;
            break;
        case 'creative':
            adjustedOptions.temperature = Math.max(adjustedOptions.temperature || 0.7, 0.85);
            adjustedOptions.top_p = 0.95;
            break;
        case 'math':
            adjustedOptions.temperature = 0.1;
            adjustedOptions.top_p = 0.8;
            break;
        case 'translation':
            adjustedOptions.temperature = 0.3;
            adjustedOptions.repeat_penalty = 1.2;
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
        const targetProfile = await selectBrandProfileForAutoRouting(query || '', hasImages);
        const targetProfiles = getProfiles();
        const resolvedProfile = targetProfiles[targetProfile];
        if (resolvedProfile) {
            console.log(`[ModelSelector] §9 Auto-Routing: ${requestedModel} → ${targetProfile} (engine=${resolvedProfile.engineModel})`);
            return {
                model: resolvedProfile.engineModel,
                options: {
                    temperature: resolvedProfile.thinking === 'high' ? 0.3 : resolvedProfile.thinking === 'off' ? 0.7 : 0.5,
                    num_ctx: resolvedProfile.contextStrategy === 'full' ? 65536 : 32768,
                },
                reason: `Auto-Routing → ${resolvedProfile.displayName} → ${resolvedProfile.engineModel}`,
                queryType: resolvedProfile.promptStrategy === 'force_coder' ? 'code'
                    : resolvedProfile.promptStrategy === 'force_reasoning' ? 'math'
                    : resolvedProfile.promptStrategy === 'force_creative' ? 'creative'
                    : 'chat',
                supportsToolCalling: true,
                supportsThinking: resolvedProfile.thinking !== 'off',
                supportsVision: resolvedProfile.requiredTools.includes('vision'),
            };
        }
        // Fallback: 프로파일을 못 찾으면 기존 자동 선택
        const autoSelection = await selectOptimalModel(query || '', hasImages);
        console.log(`[ModelSelector] §9 Auto-Routing Fallback: ${requestedModel} → ${autoSelection.model}`);
        return autoSelection;
    }

    console.log(`[ModelSelector] §9 Brand Model: ${requestedModel} → engine=${profile.engineModel}`);

    return {
        model: profile.engineModel,
        options: {
            temperature: profile.thinking === 'high' ? 0.3 : profile.thinking === 'off' ? 0.7 : 0.5,
            num_ctx: profile.contextStrategy === 'full' ? 65536 : 32768,
        },
        reason: `Brand model ${profile.displayName} → ${profile.engineModel}`,
        queryType: profile.promptStrategy === 'force_coder' ? 'code'
            : profile.promptStrategy === 'force_reasoning' ? 'math'
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
export async function selectBrandProfileForAutoRouting(query: string, hasImages?: boolean): Promise<string> {
    // 이미지가 첨부되면 무조건 vision 프로파일
    if (hasImages) {
        console.log('[ModelSelector] §9 Auto-Routing: 이미지 감지 → openmake_llm_vision');
        return 'openmake_llm_vision';
    }

    const classification = await classifyQueryWithLLM(query);
    let targetProfile: string;

    switch (classification.type) {
        case 'code':
            targetProfile = 'openmake_llm_code';
            break;
        case 'math':
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
            if (classification.confidence < 0.3 && query.length < 50) {
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

    console.log(`[ModelSelector] §9 Auto-Routing: ${classification.type} (confidence=${(classification.confidence * 100).toFixed(0)}%) → ${targetProfile}`);
    return targetProfile;
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
    return Object.entries(MODEL_PRESETS).map(([id, preset]) => ({
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
    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.bestFor[0] === queryType) {
            return preset.defaultModel;
        }
    }
    return MODEL_PRESETS['gemini-flash'].defaultModel;
}
