/**
 * API 응답 형식 표준화
 * 
 * 원본: infrastructure/http/api-response.ts (#24 개선)
 * backend/api 빌드 스코프에서 직접 사용하기 위해 배치
 * 
 * @example
 * ```typescript
 * import { success, error, paginated, notFound } from '../utils/api-response';
 * 
 * // 성공 응답
 * res.json(success({ user: foundUser }));
 * 
 * // 에러 응답
 * res.status(404).json(notFound('사용자'));
 * 
 * // 페이지네이션 응답
 * res.json(paginated(items, { page: 1, pageSize: 20, total: 100 }));
 * ```
 */

// ===== Type Definitions =====

/** 표준 API 성공 응답 */
export interface ApiSuccessResponse<T = unknown> {
    success: true;
    data: T;
    meta?: ResponseMeta;
}

/** 표준 API 에러 응답 */
export interface ApiErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
    meta?: ResponseMeta;
}

/** 통합 API 응답 타입 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/** 응답 메타데이터 */
export interface ResponseMeta {
    timestamp: string;
    requestId?: string;
}

/** 페이지네이션 정보 */
export interface PaginationMeta {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
}

/** 페이지네이션 포함 응답 */
export interface PaginatedResponse<T> extends ApiSuccessResponse<T[]> {
    pagination: PaginationMeta;
}

// ===== Common Error Codes =====

export const ErrorCodes = {
    // 4xx Client Errors
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    RATE_LIMITED: 'RATE_LIMITED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

    // 5xx Server Errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    DATABASE_ERROR: 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

    // Domain-Specific
    SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
    USER_EXISTS: 'USER_EXISTS',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    MODEL_NOT_AVAILABLE: 'MODEL_NOT_AVAILABLE',
    DOCUMENT_PROCESSING_FAILED: 'DOCUMENT_PROCESSING_FAILED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ===== Helper Functions =====

/**
 * 성공 응답 생성
 */
export function success<T>(data: T, meta?: Partial<ResponseMeta>): ApiSuccessResponse<T> {
    return {
        success: true,
        data,
        meta: {
            timestamp: new Date().toISOString(),
            ...meta
        }
    };
}

/**
 * 에러 응답 생성
 */
export function error(
    code: string,
    message: string,
    details?: unknown
): ApiErrorResponse {
    const response: ApiErrorResponse = {
        success: false,
        error: { code, message },
        meta: {
            timestamp: new Date().toISOString()
        }
    };
    if (details !== undefined) {
        response.error.details = details;
    }
    return response;
}

/**
 * 페이지네이션 응답 생성
 */
export function paginated<T>(
    items: T[],
    params: { page: number; pageSize: number; total: number }
): PaginatedResponse<T> {
    const { page, pageSize, total } = params;
    const totalPages = Math.ceil(total / pageSize);

    return {
        success: true,
        data: items,
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        },
        meta: {
            timestamp: new Date().toISOString()
        }
    };
}

// ===== HTTP Status Code Helpers =====

/** 400 Bad Request */
export function badRequest(message: string, details?: unknown): ApiErrorResponse {
    return error(ErrorCodes.BAD_REQUEST, message, details);
}

/** 401 Unauthorized */
export function unauthorized(message = '인증이 필요합니다'): ApiErrorResponse {
    return error(ErrorCodes.UNAUTHORIZED, message);
}

/** 403 Forbidden */
export function forbidden(message = '권한이 없습니다'): ApiErrorResponse {
    return error(ErrorCodes.FORBIDDEN, message);
}

/** 404 Not Found */
export function notFound(resource = '리소스'): ApiErrorResponse {
    return error(ErrorCodes.NOT_FOUND, `${resource}를 찾을 수 없습니다`);
}

/** 409 Conflict */
export function conflict(message: string): ApiErrorResponse {
    return error(ErrorCodes.CONFLICT, message);
}

/** 422 Validation Error */
export function validationError(message: string, details?: unknown): ApiErrorResponse {
    return error(ErrorCodes.VALIDATION_ERROR, message, details);
}

/** 429 Rate Limited */
export function rateLimited(message = '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'): ApiErrorResponse {
    return error(ErrorCodes.RATE_LIMITED, message);
}

/** 500 Internal Error */
export function internalError(message = '서버 내부 오류가 발생했습니다'): ApiErrorResponse {
    return error(ErrorCodes.INTERNAL_ERROR, message);
}

/** 503 Service Unavailable */
export function serviceUnavailable(message = '서비스를 일시적으로 사용할 수 없습니다'): ApiErrorResponse {
    return error(ErrorCodes.SERVICE_UNAVAILABLE, message);
}
