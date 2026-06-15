/**
 * 공통 미들웨어
 * 인증, 레이트 리미팅, 로깅
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
// QuotaExceededError는 utils/error-handler.ts에서 통합 처리
import { isOriginAllowed } from '../security/cors-policy';
import { getAnalyticsSystem } from '../monitoring/analytics';

const logger = createLogger('Middleware');

// ================================================
// 레이트 리미팅 미들웨어 (rate-limiters.ts에서 re-export)
// ================================================

export {
    createAdvancedRateLimiter,
    generalLimiter,
    authLimiter,
    chatLimiter,
    researchLimiter,
    uploadLimiter,
    webSearchLimiter,
    memoryLimiter,
    mcpLimiter,
    apiKeyManagementLimiter,
    pushLimiter,
    adminLimiter
} from './rate-limiters';

// ================================================
// 로깅 미들웨어
// ================================================

/**
 * 요청 로깅 미들웨어
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'debug';

        logger[logLevel](`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });

    next();
}

/**
 * 에러 로깅 미들웨어
 */
export function errorLogger(err: Error, req: Request, res: Response, next: NextFunction) {
    logger.error(`Error: ${err.message}`, {
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    next(err);
}

// ================================================
// 분석 미들웨어
// ================================================

/**
 * 분석 데이터 수집 미들웨어
 */
export function analyticsMiddleware(req: Request, res: Response, next: NextFunction) {
    const analytics = getAnalyticsSystem();

    // 쿼리 기록 (채팅 API)
    if (req.path.includes('/chat') && (req.body as Record<string, unknown>)?.message) {
        analytics.recordQuery((req.body as Record<string, unknown>).message as string);
    }

    next();
}

// ================================================
// Phase 3: 에러 핸들러 & API 응답 표준화
// ================================================
// globalErrorHandler, successResponse, errorResponse, extendResponse 제거됨 (2026-02-07)
// → 에러 핸들링: utils/error-handler.ts의 errorHandler 단일 사용
// → API 응답: utils/api-response.ts의 success(), error() 등 단일 사용
// 하위 호환을 위해 ApiResponse 타입은 utils/api-response.ts에서 가져올 것

// ================================================
// CORS 미들웨어
// ================================================

/**
 * CORS 설정 (화이트리스트 기반)
 * - 와일드카드(*) 사용 금지
 * - 환경변수 CORS_ORIGINS에서 허용 도메인 로드
 * - server.ts의 CORS 설정과 일관성 유지
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;

    // allowlist 기반 reflect — '*' 는 절대 reflect 하지 않음(credentials 환경).
    // 허용된 Origin 일 때만 ACAO + credentials 헤더 부여. 미허용/누락 시 헤더 미부여 →
    // 브라우저가 cross-origin 응답을 차단(거부). WS upgrade 검증과 동일 정책(security/cors-policy).
    if (isOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin as string);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Vary', 'Origin');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
}

// ================================================
// Error Handler Utilities (Re-exports)
// ================================================

// Re-export error handler utilities
export {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    DatabaseError,
    errorHandler,
    asyncHandler,
    notFoundHandler
} from '../utils/error-handler';
