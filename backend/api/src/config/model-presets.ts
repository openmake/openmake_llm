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
import { ENGINE_FALLBACKS } from './model-defaults';
import { MODEL_CONTEXT_DEFAULTS } from './runtime-limits';
import type { ModelOptions } from '../ollama/types';
import type { QueryType } from '../chat/model-selector-types';

/**
 * 모델 프리셋 정의 인터페이스
 * 각 모델의 기본 설정, 기능, 적합한 질문 유형을 정의합니다.
 */
export interface ModelPreset {
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
export function getModelPresets(): Record<string, ModelPreset> {
    const config = getConfig();
    // 테스트 환경 등에서 config 값이 없을 때를 위한 폴백
    const engineFast = config.omkEngineFast || ENGINE_FALLBACKS.FAST;
    const engineLlm = config.omkEngineLlm || ENGINE_FALLBACKS.LLM;
    const engineCode = config.omkEngineCode || ENGINE_FALLBACKS.CODE;
    const engineVision = config.omkEngineVision || ENGINE_FALLBACKS.VISION;
    return {
    // Gemini 3 Flash - 범용/코딩/분석
    'gemini-flash': {
        name: 'Gemini 3 Flash',
        envKey: 'OLLAMA_MODEL_1',
        defaultModel: engineFast,
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
        bestFor: ['code', 'code-gen', 'code-agent', 'analysis', 'chat', 'korean', 'document', 'translation'],
        priority: 1,
    },

    // GPT-OSS 120B - 고성능 추론/창작
    'gpt-oss': {
        name: 'GPT-OSS 120B',
        envKey: 'OLLAMA_MODEL_2',
        defaultModel: engineLlm,
        options: {
            temperature: 0.8,
            top_p: 0.95,
            top_k: 50,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.15,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['creative', 'analysis', 'document', 'reasoning'],
        priority: 2,
    },


    // Qwen3 Coder Next - 코딩 특화
    'qwen-coder': {
        name: 'Qwen3 Coder Next',
        envKey: 'OLLAMA_MODEL_4',
        defaultModel: engineCode,
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 20,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['code', 'code-gen', 'code-agent'],
        priority: 0,   // code-gen/code-agent에서 gemini-flash(priority=1)보다 우선 선택되도록
    },

    // Qwen3 VL 235B - 비전/멀티모달
    'qwen-vl': {
        name: 'Qwen3 VL 235B',
        envKey: 'OLLAMA_MODEL_5',
        defaultModel: engineVision,
        options: {
            temperature: 0.6,
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
        bestFor: ['vision'],
        priority: 1,  // 비전에 최우선
    },

    // Devstral 2 - SW 엔지니어링 에이전트 (123B, Mistral)
    // code-agent에서 qwen-coder(priority=0)보다 우선 선택
    'devstral': {
        name: 'Devstral 2',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'devstral-2:123b-cloud',
        options: {
            temperature: 0.2,
            top_p: 0.85,
            top_k: 30,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: false,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['code-agent'],
        priority: -1,
    },

    // Devstral Small 2 - 도구 사용/멀티파일 코드 편집 (24B, Mistral)
    // code-gen에서 qwen-coder(priority=0)보다 우선 선택
    'devstral-small': {
        name: 'Devstral Small 2',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'devstral-small-2:24b-cloud',
        options: {
            temperature: 0.3,
            top_p: 0.85,
            top_k: 30,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: false,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['code-gen'],
        priority: -1,
    },

    // Nemotron 3 Nano - 경량 에이전트 (4B-30B MoE, NVIDIA)
    'nemotron-nano': {
        name: 'Nemotron 3 Nano',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'nemotron-3-nano:30b-cloud',
        options: {
            temperature: 0.3,
            top_p: 0.85,
            top_k: 30,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: false,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['reasoning', 'chat'],
        priority: 3,
    },

    // MiniMax M2.7 - 코딩/에이전트/생산성 (MiniMax 최신)
    'minimax': {
        name: 'MiniMax M2.7',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'minimax-m2.7:cloud',
        options: {
            temperature: 0.5,
            top_p: 0.9,
            top_k: 40,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: false,
            vision: false,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['code-agent', 'code-gen', 'translation', 'korean'],
        priority: 2,
    },

    // 수학/과학 특화 프리셋
    'math-reasoning': {
        name: 'Math Reasoning',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: engineFast,
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 15,
            num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        },
        bestFor: ['math', 'math-hard', 'math-applied', 'reasoning'],
        priority: 1,   // reasoning에서 gpt-oss(priority=2)보다 우선 선택되도록
    },
    };
}
