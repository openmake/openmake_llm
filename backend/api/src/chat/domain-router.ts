/**
 * ============================================================
 * Domain Router — 역할 라우팅 (P2-2)
 * ============================================================
 * 
 * QueryType을 5개 도메인(code/math/creative/analysis/general)으로 매핑하고,
 * env에서 도메인별 전문 모델을 읽어 엔진 오버라이드를 수행합니다.
 * 
 * auto-routing(openmake_llm_auto) 경로에서만 적용되며,
 * 사용자가 명시적으로 프로파일을 선택한 경우 원본 엔진을 유지합니다.
 * 
 * @module chat/domain-router
 * @see services/ChatService - auto-routing 블록에서 소비
 * @see config/env - OMK_DOMAIN_* 환경 변수
 */

import type { QueryType } from './model-selector-types';
import { getConfig } from '../config/env';

// ============================================================
// 도메인 타입 및 매핑
// ============================================================

/** 5개 도메인 키 */
export type DomainKey = 'code' | 'math' | 'creative' | 'analysis' | 'general';

/** QueryType → DomainKey 매핑 */
export const QUERY_TYPE_TO_DOMAIN: Record<QueryType, DomainKey> = {
    code: 'code',
    math: 'math',
    creative: 'creative',
    analysis: 'analysis',
    document: 'analysis',     // 문서 분석도 analysis 도메인
    vision: 'general',        // vision은 전용 모델이 있으므로 general
    chat: 'general',
    translation: 'general',
    korean: 'general',
};

// ============================================================
// 도메인 엔진 오버라이드
// ============================================================

/** 도메인 오버라이드 결과 */
export interface DomainOverrideResult {
    /** 최종 사용할 엔진 모델 */
    engine: string;
    /** 오버라이드 발생 여부 */
    overridden: boolean;
    /** 매칭된 도메인 키 */
    domain: DomainKey;
}

/**
 * QueryType에 해당하는 도메인 전문 엔진을 env에서 읽어옵니다.
 * 
 * OMK_DOMAIN_* 변수가 설정되지 않았으면(빈 문자열) null을 반환합니다.
 * 
 * @param queryType - 분류된 질문 유형
 * @returns 도메인 전문 엔진 모델명 또는 null
 */
export function resolveDomainEngine(queryType: QueryType): string | null {
    const config = getConfig();
    const domain = QUERY_TYPE_TO_DOMAIN[queryType];

    const domainEngineMap: Record<DomainKey, string> = {
        code: config.omkDomainCode,
        math: config.omkDomainMath,
        creative: config.omkDomainCreative,
        analysis: config.omkDomainAnalysis,
        general: config.omkDomainGeneral,
    };

    const engine = domainEngineMap[domain];
    return engine && engine.trim() !== '' ? engine : null;
}

/**
 * 도메인 엔진 오버라이드를 적용합니다.
 * 
 * 해당 도메인에 전문 모델이 설정되어 있으면 엔진을 교체하고,
 * 없으면 원본 엔진을 유지합니다.
 * 
 * @param currentEngine - 현재 프로파일의 엔진 모델
 * @param queryType - 분류된 질문 유형
 * @returns 오버라이드 결과 (엔진, 발생 여부, 도메인)
 */
export function applyDomainEngineOverride(
    currentEngine: string,
    queryType: QueryType
): DomainOverrideResult {
    const domain = QUERY_TYPE_TO_DOMAIN[queryType];
    const domainEngine = resolveDomainEngine(queryType);

    if (domainEngine && domainEngine !== currentEngine) {
        return {
            engine: domainEngine,
            overridden: true,
            domain,
        };
    }

    return {
        engine: currentEngine,
        overridden: false,
        domain,
    };
}
