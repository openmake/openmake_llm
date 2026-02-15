/**
 * ============================================================
 * Database Helpers - 데이터베이스 타입 변환 유틸리티
 * ============================================================
 *
 * SQLite 데이터 타입과 JavaScript 타입 간의 변환 헬퍼 함수 모음.
 * boolean/integer 변환, JSON 안전 파싱 등을 제공합니다.
 *
 * @module utils/db-helpers
 * @description
 * - SQLite integer (0/1) <-> JavaScript boolean 변환
 * - 데이터베이스 문자열 필드의 안전한 JSON 파싱
 * - null/undefined 값에 대한 안전한 기본값 처리
 */

/**
 * Convert SQLite integer (0/1) to JavaScript boolean
 * Handles null/undefined gracefully
 */
export function toBool(value: number | boolean | null | undefined): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    return value === 1;
}

/**
 * Convert JavaScript boolean to SQLite integer (0/1)
 */
export function fromBool(value: boolean | null | undefined): number {
    return value ? 1 : 0;
}

/**
 * Safely parse JSON from database string field
 */
export function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
        return JSON.parse(value) as T;
    } catch {
        return defaultValue;
    }
}
