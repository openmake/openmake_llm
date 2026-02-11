/**
 * ⚙️ Phase 3: DB 쿼리 재시도 래퍼
 * 일시적 연결 오류(ETIMEDOUT, ECONNREFUSED, ECONNRESET)에 대한 자동 재시도
 * 
 * @module data/retry-wrapper
 * @since 2026-02-07
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('RetryWrapper');

/** 재시도 가능한 PostgreSQL 에러 코드 */
const RETRYABLE_ERROR_CODES = new Set([
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    '57P01',     // admin_shutdown
    '57P02',     // crash_shutdown
    '57P03',     // cannot_connect_now
    '08000',     // connection_exception
    '08003',     // connection_does_not_exist
    '08006',     // connection_failure
    '40001',     // serialization_failure (deadlock 재시도)
    '40P01',     // deadlock_detected
]);

/**
 * 에러가 재시도 가능한지 판단
 */
function isRetryableError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;

    const error = err as Record<string, unknown>;

    // Node.js 네트워크 에러 코드
    if (typeof error.code === 'string' && RETRYABLE_ERROR_CODES.has(error.code)) {
        return true;
    }

    // PostgreSQL 에러 코드 (error.code가 5자리 문자열인 경우)
    if (typeof error.code === 'string' && error.code.length === 5 && RETRYABLE_ERROR_CODES.has(error.code)) {
        return true;
    }

    return false;
}

/**
 * 재시도 래퍼 옵션
 */
export interface RetryOptions {
    /** 최대 재시도 횟수 (기본값: 3) */
    maxRetries?: number;
    /** 초기 대기 시간(ms) — 지수 백오프 적용 (기본값: 500) */
    baseDelayMs?: number;
    /** 최대 대기 시간(ms) (기본값: 5000) */
    maxDelayMs?: number;
    /** 작업 설명 (로그용) */
    operation?: string;
}

/**
 * DB 쿼리를 재시도 가능하게 래핑
 * 
 * 일시적 연결 오류 시 지수 백오프로 자동 재시도합니다.
 * 재시도 불가능한 에러(SQL 구문 오류, 제약 조건 위반 등)는 즉시 throw합니다.
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => pool.query('SELECT * FROM users WHERE id = $1', [userId]),
 *   { operation: 'getUserById', maxRetries: 3 }
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        baseDelayMs = 500,
        maxDelayMs = 5000,
        operation = 'unknown',
    } = options;

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            // 마지막 시도였으면 throw
            if (attempt >= maxRetries) {
                break;
            }

            // 재시도 불가능한 에러면 즉시 throw
            if (!isRetryableError(err)) {
                throw err;
            }

            // 지수 백오프 + jitter
            const delay = Math.min(
                baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
                maxDelayMs
            );

            logger.warn(
                `[${operation}] 재시도 ${attempt + 1}/${maxRetries} (${delay.toFixed(0)}ms 후)`,
                { error: err instanceof Error ? err.message : String(err) }
            );

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * 트랜잭션 래퍼
 * 
 * BEGIN → 작업 → COMMIT (실패 시 ROLLBACK) 패턴을 추상화합니다.
 * Pool에서 client를 가져와 트랜잭션 블록을 실행합니다.
 * 
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * 
 * await withTransaction(pool, async (client) => {
 *   await client.query('INSERT INTO users ...', [...]);
 *   await client.query('INSERT INTO user_settings ...', [...]);
 * });
 * ```
 */
export async function withTransaction<T>(
    pool: { connect: () => Promise<TransactionClient> },
    fn: (client: TransactionClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * pg Client 인터페이스 (트랜잭션용)
 * pg.PoolClient의 서브셋
 */
export interface TransactionClient {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
    release(): void;
}
