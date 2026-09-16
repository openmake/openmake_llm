/**
 * 단가표 저장소 (134). @module data/repositories/cost-rate-repository
 */
import { BaseRepository } from './base-repository';

export interface CostRateRow {
    kind: string;
    rate_key: string;
    unit: string;
    usd_micros_per_unit: string | number;
    note: string | null;
    updated_by: string | null;
    updated_at: string;
}

export class CostRateRepository extends BaseRepository {
    async listAll(): Promise<CostRateRow[]> {
        const r = await this.query<CostRateRow>('SELECT * FROM cost_rates ORDER BY kind, rate_key, unit');
        return r.rows;
    }

    async upsert(kind: string, rateKey: string, unit: string, usdMicrosPerUnit: number, note: string | null, updatedBy: string | null): Promise<CostRateRow> {
        const r = await this.query<CostRateRow>(
            `INSERT INTO cost_rates (kind, rate_key, unit, usd_micros_per_unit, note, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (kind, rate_key, unit) DO UPDATE SET
                usd_micros_per_unit = EXCLUDED.usd_micros_per_unit, note = EXCLUDED.note,
                updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING *`,
            [kind, rateKey, unit, usdMicrosPerUnit, note, updatedBy],
        );
        return r.rows[0];
    }

    async remove(kind: string, rateKey: string, unit: string): Promise<boolean> {
        const r = await this.query('DELETE FROM cost_rates WHERE kind = $1 AND rate_key = $2 AND unit = $3', [kind, rateKey, unit]);
        return (r.rowCount ?? 0) > 0;
    }
}
