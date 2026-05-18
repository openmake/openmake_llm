/**
 * ============================================================
 * Model Presets - 모델 프리셋 정의
 * ============================================================
 *
 * 각 모델의 기본 설정, 기능, 적합한 질문 유형을 정의합니다.
 * model-selector.ts에서 분리된 모듈입니다.
 *
 * @module config/model-presets
 * @see chat/model-selector - 이 프리셋을 소비하는 메인 모듈
 */

import { getConfig } from './env';
import { MODEL_CONTEXT_DEFAULTS } from './runtime-limits';
import type { ModelOptions } from '../llm/types';
import type { QueryType } from '../chat/model-selector-types';

/**
 * 모델 프리셋 정의 인터페이스
 * 각 모델의 기본 설정, 기능, 적합한 질문 유형을 정의합니다.
 */
export interface ModelPreset {
    /** 모델 표시 이름 (예: 'Gemini 3 Flash') */
    name: string;
    /** .env 변수명 (예: 'LLM_DEFAULT_MODEL') */
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

/**
 * 모델 프리셋 키 상수.
 * 키 자체를 코드 여러 곳에서 참조해야 할 때 매직 문자열을 피한다.
 * (e.g. fallback resolver, 테스트 fixture)
 */
export const MODEL_PRESET_KEYS = {
    /** 기본 로컬 모델 프리셋 — `getModelPresets()` 의 fallback 키 */
    DEFAULT_LOCAL: 'local-llm',
} as const;

// 사용 가능한 모델 프리셋
export function getModelPresets(): Record<string, ModelPreset> {
    const config = getConfig();
    const localModel = config.llmDefaultModel;

    return {
        [MODEL_PRESET_KEYS.DEFAULT_LOCAL]: {
            name: localModel,
            envKey: 'LLM_DEFAULT_MODEL',
            defaultModel: localModel,
            options: {
                temperature: 0.7,
                top_p: 0.9,
                top_k: 40,
                num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
                repeat_penalty: 1.1,
            },
            capabilities: {
                toolCalling: true,
                thinking: true,
                vision: true,
                streaming: true,
                contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            },
            bestFor: [
                'code', 'code-gen', 'code-agent',
                'math', 'math-applied', 'math-hard',
                'reasoning', 'creative', 'analysis',
                'document', 'vision', 'translation',
                'korean', 'chat',
            ],
            priority: 1,
        },
    };
}
