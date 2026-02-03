/**
 * 🆕 공통 미들웨어
 * 인증, 레이트 리미팅, 로깅
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';
// QuotaExceededError는 utils/error-handler.ts에서 통합 처리
import { getConfig } from '../config';
import { getAnalyticsSystem } from '../monitoring/analytics';
// AuthUser 타입은 auth/middleware.ts에서 정의됨
import { AuthUser } from '../auth/middleware';
import { unauthorized, forbidden, internalError } from '../utils/api-response';

const logger = createLogger('Middleware');

// ================================================
// 인증 미들웨어
// ================================================

/**
 * JWT 토큰 검증 미들웨어
 */
export function authMiddleware(required: boolean = true) {
    return (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;

        // Cookie first (httpOnly), then Authorization header (backward compat)
        const token = req.cookies?.auth_token ||
                      (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined);

        if (!token) {
            if (required) {
                return res.status(401).json(unauthorized('인증이 필요합니다.'));
            }
            return next();
        }
        const jwtSecret = getConfig().jwtSecret;

        // JWT_SECRET 미설정 시 보안 오류
        if (!jwtSecret) {
            logger.error('JWT_SECRET 환경변수가 설정되지 않았습니다!');
            return res.status(500).json(internalError('서버 인증 설정 오류'));
        }

        try {
            const decoded = jwt.verify(token, jwtSecret) as AuthUser;
            req.user = decoded;
            next();
        } catch (error) {
            if (required) {
                return res.status(401).json(unauthorized('유효하지 않은 토큰입니다.'));
            }
            next();
        }
    };
}

/**
 * 관리자 권한 확인 미들웨어
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
    const user = req.user;
    if (!user || user.role !== 'admin') {
        return res.status(403).json(forbidden('관리자 권한이 필요합니다.'));
    }
    next();
}

// ================================================
// 레이트 리미팅 미들웨어
// ================================================

/**
 * 일반 API 레이트 리미터
 */
export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 100,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 인증 관련 레이트 리미터
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: '로그인 시도가 너무 많습니다.' },
    skipSuccessfulRequests: true
});

/**
 * 채팅 API 레이트 리미터
 */
export const chatLimiter = rateLimit({
    windowMs: 60 * 1000, // 1분
    max: 30,
    message: { error: '채팅 요청이 너무 많습니다.' }
    // keyGenerator removed to use default IP-based handling with proper IPv6 support
});

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
// ⚙️ Phase 3: 에러 핸들러 & API 응답 표준화
// ================================================
// globalErrorHandler, successResponse, errorResponse, extendResponse 제거됨 (2026-02-07)
// → 에러 핸들링: utils/error-handler.ts의 errorHandler 단일 사용
// → API 응답: utils/api-response.ts의 success(), error() 등 단일 사용
// 하위 호환을 위해 ApiResponse 타입은 utils/api-response.ts에서 가져올 것

// ================================================
// CORS 미들웨어
// ================================================

/**
 * 🔒 CORS 설정 (화이트리스트 기반)
 * - 와일드카드(*) 사용 금지
 * - 환경변수 CORS_ORIGINS에서 허용 도메인 로드
 * - server.ts의 CORS 설정과 일관성 유지
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
    const allowedOrigins = getConfig().corsOrigins.split(',').map(o => o.trim());
    const origin = req.headers.origin;
    
    // 🔒 화이트리스트 기반 Origin 검증
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
}

// ================================================
// 🆕 Error Handler Utilities (Re-exports)
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
