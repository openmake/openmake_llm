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
    PRO: 'qwen3.5:397b-cloud',
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
    'minimax': {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    },
    'nemotron': {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    },
    'deepseek': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'kimi': {
        toolCalling: true,
        thinking: true,
        vision: true,
        streaming: true,
    },
    'cogito': {
        toolCalling: false,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'devstral': {
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

/** 12 QueryType × 3 CostTier 2차원 엔진 매핑
 *
 * 2026-03-24 업데이트:
 * - MiniMax 라인 통합: m2.5/m2.1 → m2.7 (최신 코딩·에이전트·생산성 모델)
 * - DeepSeek 버전 통일: v3.1 → v3.2 (추론 성능 개선)
 * - 존재하지 않는 glm-4.6 → nemotron-3-nano (NVIDIA 경량 MoE)
 * - 코드 standard 티어: devstral-2/devstral-small-2 (Mistral SW 엔지니어링 특화)
 */
export const AUTO_ROUTING_ENGINE_MAP: Record<string, Record<'premium' | 'standard' | 'economy', string>> = {
    'code-agent':   { premium: 'minimax-m2.7:cloud',       standard: 'devstral-2:cloud',         economy: 'qwen3-coder-next:cloud' },
    'code-gen':     { premium: 'glm-5:cloud',              standard: 'devstral-small-2:cloud',   economy: 'minimax-m2.7:cloud' },
    'code':         { premium: 'glm-5:cloud',              standard: 'devstral-small-2:cloud',   economy: 'minimax-m2.7:cloud' },
    'math-hard':    { premium: 'deepseek-v3.2:cloud',      standard: 'kimi-k2-thinking:cloud',   economy: 'cogito-2.1:cloud' },
    'math-applied': { premium: 'deepseek-v3.2:cloud',      standard: 'mistral-large-3:cloud',    economy: 'nemotron-3-super:cloud' },
    'math':         { premium: 'deepseek-v3.2:cloud',      standard: 'mistral-large-3:cloud',    economy: 'nemotron-3-super:cloud' },
    'reasoning':    { premium: 'kimi-k2.5:cloud',          standard: 'gpt-oss:120b-cloud',       economy: 'nemotron-3-nano:cloud' },
    'creative':     { premium: 'qwen3.5:397b-cloud',       standard: 'gpt-oss:120b-cloud',       economy: 'gemini-3-flash-preview:cloud' },
    'analysis':     { premium: 'kimi-k2.5:cloud',          standard: 'qwen3.5:397b-cloud',       economy: 'gemini-3-flash-preview:cloud' },
    'document':     { premium: 'qwen3-next:cloud',         standard: 'nemotron-3-super:cloud',   economy: 'qwen3.5:397b-cloud' },
    'vision':       { premium: 'qwen3-vl:235b-cloud',      standard: 'qwen3.5:397b-cloud',       economy: 'kimi-k2.5:cloud' },
    'translation':  { premium: 'minimax-m2.7:cloud',       standard: 'mistral-large-3:cloud',    economy: 'qwen3.5:397b-cloud' },
    'korean':       { premium: 'qwen3.5:397b-cloud',       standard: 'minimax-m2.7:cloud',       economy: 'gemini-3-flash-preview:cloud' },
    'chat':         { premium: 'gpt-oss:120b-cloud',       standard: 'kimi-k2:1t-cloud',         economy: 'gemini-3-flash-preview:cloud' },
} as const;

/** 하위호환 QueryType alias 정규화 맵 */
export const QUERY_TYPE_ALIASES: Record<string, string> = {
    'code': 'code-gen',
    'math': 'math-applied',
} as const;

// ============================================
// Generate-Verify 모델 매핑
// ============================================

/**
 * Generate-Verify 전략에서 사용하는 Generator/Verifier 모델 매핑
 *
 * 원칙: Generator ≠ Verifier (교차 검증을 위해 반드시 다른 계열 모델 사용)
 * - Generator: 해당 도메인 최강 모델 (AUTO_ROUTING_ENGINE_MAP premium 티어 활용)
 * - Verifier: 다른 계열의 강력한 모델 (다양성 확보로 편향 방지)
 *
 * @see AUTO_ROUTING_ENGINE_MAP - Generator는 premium 티어 모델과 동일
 * @see chat/generate-verify-strategy.ts - 이 맵을 소비하는 전략 모듈
 */
export const GV_MODEL_MAP: Record<string, Record<'generator' | 'verifier', string>> = {
    'code-agent':   { generator: 'devstral-2:cloud',         verifier: 'glm-5:cloud' },
    'code-gen':     { generator: 'glm-5:cloud',              verifier: 'devstral-small-2:cloud' },
    'code':         { generator: 'glm-5:cloud',              verifier: 'minimax-m2.7:cloud' },
    'math-hard':    { generator: 'deepseek-v3.2:cloud',      verifier: 'kimi-k2-thinking:cloud' },
    'math-applied': { generator: 'deepseek-v3.2:cloud',      verifier: 'mistral-large-3:cloud' },
    'math':         { generator: 'deepseek-v3.2:cloud',      verifier: 'mistral-large-3:cloud' },
    'reasoning':    { generator: 'kimi-k2.5:cloud',          verifier: 'gpt-oss:120b-cloud' },
    'creative':     { generator: 'qwen3.5:397b-cloud',       verifier: 'gpt-oss:120b-cloud' },
    'analysis':     { generator: 'kimi-k2.5:cloud',          verifier: 'qwen3.5:397b-cloud' },
    'document':     { generator: 'qwen3-next:cloud',         verifier: 'nemotron-3-super:cloud' },
    'vision':       { generator: 'qwen3-vl:235b-cloud',      verifier: 'qwen3.5:397b-cloud' },
    'translation':  { generator: 'minimax-m2.7:cloud',       verifier: 'mistral-large-3:cloud' },
    'korean':       { generator: 'qwen3.5:397b-cloud',       verifier: 'minimax-m2.7:cloud' },
    'chat':         { generator: 'gpt-oss:120b-cloud',       verifier: 'kimi-k2:1t-cloud' },
} as const;

/** GV_MODEL_MAP에 QueryType이 없을 때 사용하는 기본 폴백 */
export const GV_DEFAULT_MODELS: Readonly<Record<'generator' | 'verifier', string>> = {
    generator: 'gpt-oss:120b-cloud',
    verifier: 'gemini-3-flash-preview:cloud',
} as const;
