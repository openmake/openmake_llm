/**
 * Routing Logger - 라우팅 결정 구조화 로깅
 *
 * 모든 채팅 요청의 라우팅 결정을 구조화된 JSON으로 기록합니다.
 * 향후 라우팅 품질 분석, 비용 최적화, 피드백 루프의 기반 데이터입니다.
 *
 * @module chat/routing-logger
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('RoutingDecision');

export interface RoutingQueryFeatures {
    queryType: string;
    confidence: number;
    hasImages: boolean;
    queryLength: number;
    isBrandModel: boolean;
    brandProfile?: string;
}

export interface RoutingRouteDecision {
    strategy: 'a2a' | 'agent-loop' | 'direct' | 'discussion' | 'deep-research';
    a2aMode?: string;
    primaryModel?: string;
    secondaryModel?: string;
    synthesizerModel?: string;
    complexityScore?: number;
    complexitySignals?: string[];
    /** P2-1: 적용된 비용 티어 */
    costTier?: string;
    /** P2-1: 비용 티어로 인한 다운그레이드 발생 여부 */
    costTierDowngraded?: boolean;
    /** P2-2: 도메인 오버라이드된 엔진 */
    domainEngine?: string;
    /** P2-2: 매칭된 도메인 키 */
    domainKey?: string;
}

export interface RoutingDecisionLog {
    timestamp: string;
    requestId?: string;
    queryFeatures: RoutingQueryFeatures;
    routeDecision: RoutingRouteDecision;
    modelUsed: string;
    latencyMs: number;
    securityFlags?: {
        preCheckPassed: boolean;
        postCheckPassed?: boolean;
        violations: string[];
    };
}

/**
 * 라우팅 결정 로그 엔트리를 생성합니다 (부분 필드로 시작, 나중에 완성).
 */
export function createRoutingLogEntry(partial: Partial<RoutingDecisionLog>): RoutingDecisionLog {
    return {
        timestamp: new Date().toISOString(),
        queryFeatures: partial.queryFeatures ?? {
            queryType: 'unknown',
            confidence: 0,
            hasImages: false,
            queryLength: 0,
            isBrandModel: false,
        },
        routeDecision: partial.routeDecision ?? {
            strategy: 'direct',
        },
        modelUsed: partial.modelUsed ?? 'unknown',
        latencyMs: partial.latencyMs ?? 0,
        ...partial,
    };
}

/**
 * 라우팅 결정을 구조화된 JSON으로 기록합니다.
 */
export function logRoutingDecision(log: RoutingDecisionLog): void {
    logger.info('routing-decision', { routingLog: log });
}

/**
 * A2A 모델 선택을 기록합니다.
 */
export function logA2AModelSelection(queryType: string, primary: string, secondary: string, synthesizer: string): void {
    logger.info(`A2A 모델 선택: queryType=${queryType}, primary=${primary}, secondary=${secondary}, synthesizer=${synthesizer}`);
}
