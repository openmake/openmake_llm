/**
 * ============================================================
 * Routing Verifier - 라우팅 결정 사후 검증
 * ============================================================
 *
 * 응답 생성 완료 후, 라우팅 결정이 적절했는지 사후 검증합니다.
 * 비정상 지연, 토큰 과다 사용, 에러 발생 등을 감지하여
 * 라우팅 품질 개선의 근거 데이터를 수집합니다.
 *
 * Harness Engineering 원칙: Verify — 사후 검증으로 라우팅 의사결정 품질 측정
 *
 * @module chat/routing-verifier
 * @see chat/routing-logger.ts - 라우팅 결정 로그 구조
 * @see config/runtime-limits.ts - ROUTING_VERIFICATION config
 */
import { createLogger } from '../utils/logger';
import { ROUTING_VERIFICATION } from '../config/runtime-limits';

const logger = createLogger('RoutingVerifier');

/** 사후 검증에 필요한 응답 품질 신호 */
export interface ResponseQualitySignals {
    /** 응답 생성 총 지연 (ms) */
    latencyMs: number;
    /** 실제 사용된 토큰 수 (추정치) */
    actualTokens?: number;
    /** 할당된 토큰 예산 */
    tokenBudget?: number;
    /** 에러 발생 여부 */
    hasError: boolean;
    /** 에러 메시지 (있으면) */
    errorMessage?: string;
    /** 폴백 발생 여부 */
    fellBackToDefault: boolean;
    /** 응답 길이 (문자 수) */
    responseLength: number;
}

/** 사후 검증 결과 */
export interface RoutingVerificationResult {
    /** 라우팅이 적절했는지 여부 */
    appropriate: boolean;
    /** 감지된 이슈 목록 */
    issues: RoutingVerificationIssue[];
    /** 검증 시점 타임스탬프 */
    verifiedAt: string;
}

/** 검증에서 감지된 개별 이슈 */
export interface RoutingVerificationIssue {
    /** 이슈 코드 */
    code: 'high-latency' | 'token-overuse' | 'error-occurred' | 'fallback-triggered' | 'empty-response';
    /** 심각도 */
    severity: 'warn' | 'error';
    /** 상세 메시지 */
    message: string;
}

/**
 * 라우팅 결정 + 응답 품질 신호를 바탕으로 사후 검증을 수행합니다.
 *
 * @param queryType - 분류된 쿼리 타입
 * @param strategy - 선택된 실행 전략
 * @param signals - 응답 품질 신호
 * @returns 검증 결과
 */
export function verifyRoutingDecision(
    queryType: string,
    strategy: string,
    signals: ResponseQualitySignals,
): RoutingVerificationResult {
    if (!ROUTING_VERIFICATION.ENABLED) {
        return { appropriate: true, issues: [], verifiedAt: new Date().toISOString() };
    }

    const issues: RoutingVerificationIssue[] = [];

    // Check 1: 비정상 지연
    if (signals.latencyMs > ROUTING_VERIFICATION.HIGH_LATENCY_THRESHOLD_MS) {
        issues.push({
            code: 'high-latency',
            severity: 'warn',
            message: `응답 지연 ${signals.latencyMs}ms가 임계값 ${ROUTING_VERIFICATION.HIGH_LATENCY_THRESHOLD_MS}ms를 초과 (strategy=${strategy}, type=${queryType})`,
        });
    }

    // Check 2: 토큰 예산 초과
    if (signals.actualTokens && signals.tokenBudget && signals.tokenBudget > 0) {
        const ratio = signals.actualTokens / signals.tokenBudget;
        if (ratio > ROUTING_VERIFICATION.TOKEN_OVERUSE_RATIO) {
            issues.push({
                code: 'token-overuse',
                severity: 'warn',
                message: `토큰 사용량 ${signals.actualTokens}이 예산 ${signals.tokenBudget}의 ${(ratio * 100).toFixed(0)}%로 초과 (임계=${(ROUTING_VERIFICATION.TOKEN_OVERUSE_RATIO * 100).toFixed(0)}%)`,
            });
        }
    }

    // Check 3: 에러 발생
    if (signals.hasError) {
        issues.push({
            code: 'error-occurred',
            severity: 'error',
            message: `응답 중 에러 발생: ${signals.errorMessage?.substring(0, 200) || '(unknown)'}`,
        });
    }

    // Check 4: 폴백 발생
    if (signals.fellBackToDefault) {
        issues.push({
            code: 'fallback-triggered',
            severity: 'warn',
            message: `라우팅 전략 ${strategy}에서 기본 폴백으로 전환됨 (type=${queryType})`,
        });
    }

    // Check 5: 빈 응답
    if (signals.responseLength === 0) {
        issues.push({
            code: 'empty-response',
            severity: 'error',
            message: `빈 응답 생성됨 (strategy=${strategy}, type=${queryType})`,
        });
    }

    const hasErrors = issues.some(i => i.severity === 'error');

    const result: RoutingVerificationResult = {
        appropriate: !hasErrors,
        issues,
        verifiedAt: new Date().toISOString(),
    };

    // 로깅
    if (issues.length > 0) {
        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warnCount = issues.filter(i => i.severity === 'warn').length;

        logger.warn(
            `🔍 라우팅 사후 검증: ${errorCount}개 오류, ${warnCount}개 경고 (type=${queryType}, strategy=${strategy})`,
            ROUTING_VERIFICATION.INCLUDE_IN_METRICS ? { routingVerification: result } : undefined,
        );
    } else {
        logger.debug(`✅ 라우팅 사후 검증 통과 (type=${queryType}, strategy=${strategy}, ${signals.latencyMs}ms)`);
    }

    return result;
}
