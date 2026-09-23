/**
 * knowledge-runtime 공용 DB 접근 — Base 의 풀을 그대로 쓴다(별도 연결 없음).
 *
 * @module addons/knowledge-runtime/db
 */
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../../data/models/unified-database';

export function kdb(): Pool {
    return getPool();
}

/** 한 트랜잭션 — 실패하면 롤백하고 오류를 그대로 던진다 */
export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await kdb().connect();
    try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}
