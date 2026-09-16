/** 월 명세서 저장소 (137). @module data/repositories/billing-statement-repository */
import { BaseRepository } from './base-repository';

export interface StatementLine { kind: string; rate_key: string; unit: string; quantity: string | number; usd_micros: string | number }
export interface StatementRow { id: number; subject_type: string; subject_id: string; period_start: string; period_end: string; total_usd_micros: string | number; generated_at: string }

export class BillingStatementRepository extends BaseRepository {
    /** 헤더+라인 upsert(멱등) — 같은 주체·월이면 라인을 교체한다. */
    async upsert(subjectType: string, subjectId: string, periodStart: string, periodEnd: string, total: number, lines: StatementLine[]): Promise<number> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const h = await client.query<{ id: number }>(
                `INSERT INTO billing_statements (subject_type, subject_id, period_start, period_end, total_usd_micros)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (subject_type, subject_id, period_start) DO UPDATE SET total_usd_micros = EXCLUDED.total_usd_micros, generated_at = NOW()
                 RETURNING id`,
                [subjectType, subjectId, periodStart, periodEnd, total]);
            const id = h.rows[0].id;
            await client.query('DELETE FROM billing_statement_lines WHERE statement_id = $1', [id]);
            for (const l of lines) {
                await client.query(
                    'INSERT INTO billing_statement_lines (statement_id, kind, rate_key, unit, quantity, usd_micros) VALUES ($1, $2, $3, $4, $5, $6)',
                    [id, l.kind, l.rate_key, l.unit, l.quantity, l.usd_micros]);
            }
            await client.query('COMMIT');
            return id;
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }

    async list(subjectType: string, subjectId: string, limit = 24): Promise<StatementRow[]> {
        const r = await this.query<StatementRow>(
            'SELECT * FROM billing_statements WHERE subject_type = $1 AND subject_id = $2 ORDER BY period_start DESC LIMIT $3', [subjectType, subjectId, limit]);
        return r.rows;
    }

    async get(subjectType: string, subjectId: string, periodStart: string): Promise<{ statement: StatementRow; lines: StatementLine[] } | null> {
        const r = await this.query<StatementRow>(
            'SELECT * FROM billing_statements WHERE subject_type = $1 AND subject_id = $2 AND period_start = $3', [subjectType, subjectId, periodStart]);
        const st = r.rows[0]; if (!st) return null;
        const l = await this.query<StatementLine>('SELECT kind, rate_key, unit, quantity, usd_micros FROM billing_statement_lines WHERE statement_id = $1 ORDER BY usd_micros DESC', [st.id]);
        return { statement: st, lines: l.rows };
    }
}
