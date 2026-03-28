/**
 * Routing Logger - 라우팅 결정 구조화 로깅
 *
 * 모든 채팅 요청의 라우팅 결정을 구조화된 JSON으로 기록합니다.
 * 향후 라우팅 품질 분석, 비용 최적화, 피드백 루프의 기반 데이터입니다.
 *
 * @module chat/routing-logger
 */
import { createLogger } from '../utils/logger';
import { getRequestId } from '../utils/request-context';

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
    strategy: 'generate-verify' | 'agent-loop' | 'direct' | 'discussion' | 'deep-research';
    primaryModel?: string;
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
    /** P1-2: 분류 신뢰도 (0.0~1.0) */
    classificationConfidence?: number;
    /** P1-2: 분류 출처 */
    classifierSource?: 'llm' | 'cache' | 'regex';
    /** P1-2: 실행 전략 */
    executionStrategy?: 'single' | 'generate-verify' | 'conditional-verify';
    /** P1-2: GV 스킵 여부 (conditional-verify에서 복잡도 낮아 스킵) */
    gvSkipped?: boolean;
    /** P1-2: 토큰 예산 */
    tokenBudget?: number;
    /** GV 검증 여부 */
    gvVerified?: boolean;
    /** GV 변경률 (0.0~1.0, Jaccard distance) */
    gvVerificationDelta?: number;
    /** GV 이슈 발견 수 */
    gvIssuesFound?: number;
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
        requestId: partial.requestId ?? getRequestId(),
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

