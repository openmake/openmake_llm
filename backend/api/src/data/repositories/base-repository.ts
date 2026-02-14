import { Pool, QueryResult, QueryResultRow } from 'pg';
import { withRetry } from '../retry-wrapper';

export type QueryParam = string | number | boolean | null | undefined;

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
