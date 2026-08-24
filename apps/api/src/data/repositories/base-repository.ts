/**
 * @module data/repositories/base-repository
 * @description 모든 리포지토리의 추상 기반 클래스
 *
 * PostgreSQL 연결 풀과 리트라이 래퍼를 캡슐화하여
 * 파생 리포지토리에 안전한 쿼리 실행 메서드를 제공합니다.
 *
 * - `query<T>()`: 파라미터화 SQL 실행 + 자동 리트라이 (`withRetry`)
 */
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { withRetry } from '../retry-wrapper';

// Buffer(BYTEA 원본 바이트) 와 string[](`= ANY($1::text[])`) 는 pg 가 네이티브로
// 바인딩한다 — 우회 직렬화(base64/JSON) 없이 그대로 넘기기 위해 유니온에 포함.
export type QueryParam = string | number | boolean | null | undefined | Buffer | string[];

export class BaseRepository {
    protected pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    protected query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
        return withRetry(
            () => this.pool.query<T>(sql, params),
            { operation: sql.substring(0, 50) }
        );
    }
}
