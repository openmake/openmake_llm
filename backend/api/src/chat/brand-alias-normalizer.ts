/**
 * ============================================================
 * Brand Alias Normalizer — Phase D (Brand Profile Decomposition)
 * ============================================================
 *
 * 외부 OpenAI 호환 클라이언트가 보내는 legacy brand alias 를 직교 축
 * (mode toggle / style) 으로 자동 매핑. backward compat layer.
 *
 * 7 brand profile (Default/Pro/Fast/Think/Code/Vision/Auto) 중 실제로
 * 작동하는 건 Default 만 — 나머지 6개는 alias / test fixture / dead.
 * 본 normalizer 는 alias 가 들어와도 사용자 의도를 직교 축으로 변환.
 *
 * 도입 (2026-05-26): Brand Profile Decomposition Phase B.
 * Phase D (30일 후) 에서 alias 적중 시 HTTP 410 으로 전환 예정.
 *
 * @module chat/brand-alias-normalizer
 * @see docs/superpowers/plans/2026-05-26-brand-profile-decomposition.md
 */

import { createLogger } from '../utils/logger';
import type { Style } from './style';

const logger = createLogger('BrandAliasNormalizer');

export interface NormalizedAlias {
    /** 정규화된 model id (대부분 llmDefaultModel) */
    resolvedModel: string;
    /** 응답 스타일 derived */
    style?: Style;
    /** thinking mode derived */
    thinkingMode?: boolean;
    /** discussion mode derived */
    discussionMode?: boolean;
    /** 적중 alias 명 (deprecation 로깅용) */
    aliasHit?: string;
}

/** 7 brand alias → 직교 축 매핑. 빈 model 또는 모르는 model 은 pass-through. */
export function normalizeBrandAlias(
    model: string | undefined,
    defaultModel: string,
): NormalizedAlias {
    const m = (model || '').toLowerCase().trim();
    if (!m) return { resolvedModel: defaultModel };

    switch (m) {
        case 'openmake_llm':
        case 'openmake-llm':
            return { resolvedModel: defaultModel, aliasHit: 'openmake_llm' };

        case 'openmake_llm_pro':
        case 'openmake-llm-pro':
            // Pro = 멀티 에이전트 discussion 자동 활성
            return {
                resolvedModel: defaultModel,
                discussionMode: true,
                aliasHit: 'openmake_llm_pro',
            };

        case 'openmake_llm_fast':
        case 'openmake-llm-fast':
            // Fast = concise style + thinking off
            return {
                resolvedModel: defaultModel,
                style: 'concise',
                thinkingMode: false,
                aliasHit: 'openmake_llm_fast',
            };

        case 'openmake_llm_think':
        case 'openmake-llm-think':
            // Think = thinking mode 강제
            return {
                resolvedModel: defaultModel,
                thinkingMode: true,
                aliasHit: 'openmake_llm_think',
            };

        case 'openmake_llm_code':
        case 'openmake-llm-code':
            // Code = thinking mode + concise (Custom Agent 가 진짜 페르소나 제공 권장)
            return {
                resolvedModel: defaultModel,
                thinkingMode: true,
                style: 'concise',
                aliasHit: 'openmake_llm_code',
            };

        case 'openmake_llm_vision':
        case 'openmake-llm-vision':
            // Vision = 모델 자체 multi-modal 지원 사용. 별도 토글 불필요
            return { resolvedModel: defaultModel, aliasHit: 'openmake_llm_vision' };

        case 'openmake_llm_auto':
        case 'openmake-llm-auto':
            // Auto = 기본 라우팅 그대로 (운영자 정의 임계값에 따라 자동 토론 활성)
            return { resolvedModel: defaultModel, aliasHit: 'openmake_llm_auto' };

        default:
            // pass-through — 외부 provider model (gpt-4, claude-sonnet 등) 또는 정상 model id
            return { resolvedModel: model || defaultModel };
    }
}

/**
 * Alias 적중 로깅. deprecation 그레이스 기간 동안 운영자가 외부 클라이언트의
 * alias 사용 빈도를 추적하기 위한 telemetry. Phase D 진입 결정 근거.
 */
export function logAliasHitIfAny(result: NormalizedAlias): void {
    if (result.aliasHit) {
        logger.warn(
            `[deprecation] brand alias '${result.aliasHit}' 적중. ` +
            `mapped: model=${result.resolvedModel} ` +
            `style=${result.style ?? '-'} ` +
            `thinking=${result.thinkingMode ?? '-'} ` +
            `discussion=${result.discussionMode ?? '-'}. ` +
            `Phase D (예정) 에서 410 응답으로 전환.`,
        );
    }
}
