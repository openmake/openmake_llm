/**
 * ============================================================
 * 모델 기본값 및 프리셋 중앙 관리
 * ============================================================
 * 엔진 매핑 폴백, 모델 능력 정의 등
 * 모델 선택기에서 사용하는 기본값을 정의합니다.
 *
 * @module config/model-defaults
 */

// ============================================
// 엔진 매핑 폴백값
// ============================================

/**
 * 환경 변수가 설정되지 않았을 때 사용하는
 * 엔진별 기본 모델 폴백값
 *
 * model-selector.ts에서 config.omkEngine* || FALLBACK 패턴으로 사용
 */
export const ENGINE_FALLBACKS = {
    /** 빠른 응답 엔진 폴백 */
    FAST: 'gemini-3-flash-preview:cloud',
    /** 기본 LLM 엔진 폴백 */
    LLM: 'gpt-oss:120b-cloud',
    /** 고급 분석 엔진 폴백 */
    PRO: 'kimi-k2.5:cloud',
    /** 코딩 엔진 폴백 */
    CODE: 'glm-5:cloud',
    /** 비전 엔진 폴백 */
    VISION: 'qwen3.5:397b-cloud',
    /** 사고(Think) 엔진 폴백 */
    THINK: 'gpt-oss:120b-cloud',
} as const;

/**
 * 모델 이름 프리픽스별 기능 프리셋
 *
 * 모델 식별자에서 콜론(:) 앞 부분을 기준으로
 * 기본 능력을 매핑합니다.
 */
export const MODEL_CAPABILITY_PRESETS: Readonly<Record<string, ModelCapabilities>> = {
    'gemini': {
        toolCalling: true,
        thinking: true,
        vision: true,
        streaming: true,
    },
    'gpt-oss': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'kimi': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'qwen3-coder': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'qwen3-vl': {
        toolCalling: true,
        thinking: false,
        vision: true,
        streaming: true,
    },
    'qwen3.5': {
        toolCalling: true,
        thinking: false,
        vision: true,
        streaming: true,
    },
    'glm': {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    },
} as const;

/**
 * 모델 능력 인터페이스
 */
export interface ModelCapabilities {
    toolCalling: boolean;
    thinking: boolean;
    vision: boolean;
    streaming: boolean;
}
