/**
 * Database Helper Utilities
 * Conversion helpers for SQLite data types
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
