/**
 * API 응답 타입 정의
 * 모든 API 응답에 일관된 형식 적용
 * 
 * @deprecated Use `utils/api-response.ts` instead.
 * 이 파일의 타입과 헬퍼 함수는 `utils/api-response.ts`로 대체되었습니다.
 * 새 코드에서는 `import { success, error, ... } from '../utils/api-response'`를 사용하세요.
 */

/**
 * 표준 API 응답 형식
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

/**
 * 페이지네이션 응답
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
}

/**
 * API 에러 응답
 */
export interface ApiErrorResponse {
    success: false;
    error: string;
    code?: string;
    details?: Record<string, any>;
}

/**
 * API 응답 헬퍼 함수
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
    return {
        success: true,
        data,
        ...(message && { message })
    };
}

export function errorResponse(error: string, code?: string): ApiErrorResponse {
    return {
        success: false,
        error,
        ...(code && { code })
    };
}

export function paginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number
): PaginatedResponse<T> {
    return {
        success: true,
        data,
        total,
        page,
        limit,
        hasNext: page * limit < total,
        hasPrev: page > 1
    };
}
