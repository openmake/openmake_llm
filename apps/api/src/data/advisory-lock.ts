/**
 * pg advisory lock 으로 임계 구역을 직렬화하는 공용 헬퍼.
 *
 * 세션 락이라 전용 client 를 잡아 lock → fn → unlock → release 순으로 처리한다
 * (마이그레이션 runner 의 applyPendingWithLock 과 같은 형태). 키는 config/constants 에
 * 서로 겹치지 않게 정의한다.
 */
import { getPool } from './models/unified-database';

export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
    const lockClient = await getPool().connect();
    try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [key]);
        try {
            return await fn();
        } finally {
            await lockClient.query('SELECT pg_advisory_unlock($1)', [key]);
        }
    } finally {
        lockClient.release();
    }
}
