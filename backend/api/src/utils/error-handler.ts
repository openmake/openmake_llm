/**
 * Unified Error Handler
 * Standardized error handling across all routes
 * 
 * #24 연동: api-response 표준 형식 사용
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger';
import { error as apiError, badRequest as apiBadRequest, ErrorCodes, ApiErrorResponse } from './api-response';
import { QuotaExceededError } from '../errors/quota-exceeded.error';

const logger = createLogger('ErrorHandler');

/**
 * Base application error class
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly code?: string;

    constructor(
        message: string,
        statusCode: number = 500,
        isOperational: boolean = true,
        code?: string
    ) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.code = code;
        
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 400, true, 'VALIDATION_ERROR');
    }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
    constructor(message: string = '인증이 필요합니다') {
        super(message, 401, true, 'AUTHENTICATION_ERROR');
    }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
    constructor(message: string = '권한이 없습니다') {
        super(message, 403, true, 'AUTHORIZATION_ERROR');
    }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
    constructor(message: string = '리소스를 찾을 수 없습니다') {
        super(message, 404, true, 'NOT_FOUND');
    }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
    constructor(message: string = '요청 제한을 초과했습니다') {
        super(message, 429, true, 'RATE_LIMIT_EXCEEDED');
    }
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
    constructor(message: string = '데이터베이스 오류가 발생했습니다') {
        super(message, 500, true, 'DATABASE_ERROR');
    }
}

/**
 * Standard error response interface
 * @deprecated Use ApiErrorResponse from api-response.ts instead
 */
export interface ErrorResponse {
    success: false;
    error: string;
    code?: string;
    details?: string[];
    timestamp: string;
    stack?: string;
}

/**
 * Format error for response (#24 연동: 표준 ApiErrorResponse 형식)
 */
function formatError(err: Error, includeStack: boolean): ApiErrorResponse & { stack?: string } {
    const code = err instanceof AppError && err.code 
        ? err.code 
        : ErrorCodes.INTERNAL_ERROR;
    
    const response = apiError(code, err.message);
    
    if (includeStack && err.stack) {
        return { ...response, stack: err.stack };
    }

    return response;
}

/**
 * Global error handler middleware
 * Must be registered LAST after all routes
 * 
 * ⚙️ Phase 3 통합 2026-02-07:
 *   - MulterError (파일 업로드) 처리 통합
 *   - QuotaExceededError (API 할당량) 처리 통합
 *   - server.ts 인라인 핸들러 + middlewares/index.ts globalErrorHandler 제거 → 이 함수로 단일화
 * 
 * #24 연동: 표준 API 응답 형식 적용
 */
export function errorHandler(
    err: Error & { code?: string; status?: number; name?: string },
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    // ── QuotaExceededError → 429 ──
    if (err instanceof QuotaExceededError) {
        logger.warn(`Quota exceeded: ${err.message}`, { path: req.path });
        res.set('Retry-After', String(err.retryAfterSeconds));
        res.status(429).json(apiError(ErrorCodes.RATE_LIMITED, err.message, {
            quotaType: err.quotaType,
            used: err.used,
            limit: err.limit,
            retryAfter: err.retryAfterSeconds,
        }));
        return;
    }

    // ── Multer: 파일 크기 초과 → 413 ──
    if (err.code === 'LIMIT_FILE_SIZE') {
        logger.warn(`File size limit exceeded: ${req.path}`);
        res.status(413).json(apiError(ErrorCodes.PAYLOAD_TOO_LARGE, '파일 크기가 너무 큽니다 (최대 100MB)'));
        return;
    }

    // ── Multer: 기타 업로드 오류 → 400 ──
    if (err.name === 'MulterError') {
        logger.warn(`Multer error: ${err.message}`, { path: req.path });
        res.status(400).json(apiBadRequest(`업로드 오류: ${err.message}`));
        return;
    }

    // ── AppError (커스텀 에러 계층) ──
    if (err instanceof AppError) {
        logger.error(`[${req.method}] ${req.path}: ${err.message}`, {
            stack: err.stack,
            code: err.code,
        });
        // NOTE: Use process.env.NODE_ENV directly (not getConfig()) because
        // NODE_ENV can change at runtime in test environments
        const includeStack = process.env.NODE_ENV === 'development';
        res.status(err.statusCode).json(formatError(err, includeStack));
        return;
    }

    // ── 기타 알 수 없는 에러 → 500 ──
    logger.error(`[${req.method}] ${req.path}: ${err.message}`, {
        stack: err.stack,
        body: req.body,
        query: req.query
    });

    const statusCode = err.status || 500;
    // NOTE: Use process.env.NODE_ENV directly (not getConfig()) because
    // NODE_ENV can change at runtime in test environments
    const includeStack = process.env.NODE_ENV === 'development';
    res.status(statusCode).json(formatError(err, includeStack));
}

/**
 * Async handler wrapper to catch async errors
 * Wraps async route handlers to forward errors to error middleware
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Not found handler for undefined routes
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
    next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
}
