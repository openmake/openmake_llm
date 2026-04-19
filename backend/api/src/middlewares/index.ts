/**
 * 공통 미들웨어
 * 인증, 레이트 리미팅, 로깅
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
// QuotaExceededError는 utils/error-handler.ts에서 통합 처리
import { getConfig } from '../config';
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
    const allowedOrigins = getConfig().corsOrigins.split(',')
        .map(o => o.trim())
        .filter(o => {
            if (!o) return false;
            if (o === '*') return true;
            if (!/^https?:\/\//i.test(o)) {
                // 잘못된 CORS origin 형식은 무시 (http:// 또는 https://로 시작해야 함)
                return false;
            }
            return true;
        });
    const origin = req.headers.origin;

    // 화이트리스트 기반 Origin 검증
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');

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
