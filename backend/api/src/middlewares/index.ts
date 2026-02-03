/**
 * 🆕 공통 미들웨어
 * 인증, 레이트 리미팅, 로깅
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { getConfig } from '../config';
import { getAnalyticsSystem } from '../monitoring/analytics';
// AuthUser 타입은 auth/middleware.ts에서 정의됨
import { AuthUser } from '../auth/middleware';

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
        const token = (req as any).cookies?.auth_token ||
                      (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined);

        if (!token) {
            if (required) {
                return res.status(401).json({ error: '인증이 필요합니다.' });
            }
            return next();
        }
        const jwtSecret = process.env.JWT_SECRET;

        // JWT_SECRET 미설정 시 보안 오류
        if (!jwtSecret) {
            logger.error('JWT_SECRET 환경변수가 설정되지 않았습니다!');
            return res.status(500).json({ error: '서버 인증 설정 오류' });
        }

        try {
            const decoded = jwt.verify(token, jwtSecret) as AuthUser;
            req.user = decoded;
            next();
        } catch (error) {
            if (required) {
                return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
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
        return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
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
    if (req.path.includes('/chat') && (req.body as any)?.message) {
        analytics.recordQuery((req.body as any).message);
    }

    next();
}

// ================================================
// 공통 에러 핸들러
// ================================================

/**
 * 글로벌 에러 핸들러
 */
export function globalErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
    // Handle quota exceeded errors with 429 status
    if (err instanceof QuotaExceededError) {
        logger.warn(`Quota exceeded: ${err.message}`);
        res.set('Retry-After', String(err.retryAfterSeconds));
        return res.status(429).json({
            error: 'API 할당량이 초과되었습니다.',
            quotaType: err.quotaType,
            used: err.used,
            limit: err.limit,
            retryAfter: err.retryAfterSeconds,
            message: err.message
        });
    }

    logger.error('Unhandled error:', err);

    res.status(500).json({
        error: '서버 오류가 발생했습니다.',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
}

// ================================================
// 🔒 API 응답 표준화 헬퍼
// ================================================

/**
 * 표준 API 응답 인터페이스
 */
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    timestamp: string;
}

/**
 * 성공 응답 생성
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
    return {
        success: true,
        data,
        message,
        timestamp: new Date().toISOString()
    };
}

/**
 * 에러 응답 생성
 */
export function errorResponse(error: string, statusCode?: number): ApiResponse {
    return {
        success: false,
        error,
        timestamp: new Date().toISOString()
    };
}

/**
 * Express Response 확장 헬퍼
 * 사용법: res.apiSuccess(data) 또는 res.apiError('message', 400)
 */
export function extendResponse(req: Request, res: Response, next: NextFunction) {
    // @ts-ignore - Response 확장
    res.apiSuccess = function<T>(data: T, message?: string) {
        return this.json(successResponse(data, message));
    };
    
    // @ts-ignore - Response 확장
    res.apiError = function(error: string, statusCode: number = 500) {
        return this.status(statusCode).json(errorResponse(error));
    };
    
    next();
}

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
    const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:52416').split(',').map(o => o.trim());
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
