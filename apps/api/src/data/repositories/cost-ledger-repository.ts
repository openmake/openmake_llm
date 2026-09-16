/**
 * 비용 원장 저장소 (134, append-only). @module data/repositories/cost-ledger-repository
 */
import { BaseRepository } from './base-repository';

export interface CostLedgerInsert {
    userId: string | null;
    orgId: string | null;
    kind: string;
    rateKey: string;
    unit: string;
    quantity: number;
    usdMicrosPerUnit: number;
    costUsdMicros: number;
    costOwner: 'user' | 'server' | 'byok';
    agentId?: string | null;
    sessionId?: string | null;
    requestId?: string | null;
    feature?: string | null;
    meta?: Record<string, unknown>;
    idempotencyKey?: string | null;
    occurredAt?: Date;
}

export interface CostSummaryRow { kind: string; rate_key: string; quantity: string; cost_usd_micros: string }

export class CostLedgerRepository extends BaseRepository {
    /** 1행 적재. idempotency_key 충돌은 무시(중복 기록 방지). */
    async insert(e: CostLedgerInsert): Promise<void> {
        await this.query(
            `INSERT INTO cost_ledger
                (occurred_at, user_id, org_id, kind, rate_key, unit, quantity, usd_micros_per_unit, cost_usd_micros,
                 cost_owner, agent_id, session_id, request_id, feature, meta, idempotency_key)
             VALUES (COALESCE($1, NOW()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
                e.occurredAt ? e.occurredAt.toISOString() : null, e.userId, e.orgId, e.kind, e.rateKey, e.unit, e.quantity, e.usdMicrosPerUnit, e.costUsdMicros,
                e.costOwner, e.agentId ?? null, e.sessionId ?? null, e.requestId ?? null, e.feature ?? null,
                JSON.stringify(e.meta ?? {}), e.idempotencyKey ?? null,
            ],
        );
    }

    /** 사용자 기간 합계 (kind·rate_key 별). */
    async summarizeByUser(userId: string, from: Date, to: Date): Promise<CostSummaryRow[]> {
        const r = await this.query<CostSummaryRow>(
            `SELECT kind, rate_key, SUM(quantity)::text AS quantity, SUM(cost_usd_micros)::text AS cost_usd_micros
             FROM cost_ledger WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3
             GROUP BY kind, rate_key ORDER BY cost_usd_micros DESC`,
            [userId, from.toISOString(), to.toISOString()],
        );
        return r.rows;
    }

    /** 사용자 기간 총액(micros). */
    async totalByUser(userId: string, from: Date, to: Date): Promise<number> {
        const r = await this.query<{ total: string | null }>(
            `SELECT SUM(cost_usd_micros)::text AS total FROM cost_ledger WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3`,
            [userId, from.toISOString(), to.toISOString()],
        );
        return Number(r.rows[0]?.total ?? 0);
    }

    /** 주체별 기간 합계 — user|org|system(전체). 라인 = kind×rate_key×unit. */
    async summarizeBySubject(subjectType: 'user' | 'org' | 'system', subjectId: string, from: Date, to: Date): Promise<Array<CostSummaryRow & { unit: string }>> {
        const where = subjectType === 'user' ? 'user_id = $3' : subjectType === 'org' ? 'org_id = $3' : '$3 = $3';
        const r = await this.query<CostSummaryRow & { unit: string }>(
            `SELECT kind, rate_key, unit, SUM(quantity)::text AS quantity, SUM(cost_usd_micros)::text AS cost_usd_micros
             FROM cost_ledger WHERE occurred_at >= $1 AND occurred_at < $2 AND ${where}
             GROUP BY kind, rate_key, unit ORDER BY cost_usd_micros DESC`,
            [from.toISOString(), to.toISOString(), subjectId],
        );
        return r.rows;
    }

    /** 기간 내 에이전트별 비용(관리자 분석). agent_id NULL 은 제외. */
    async costByAgent(from: Date, to: Date, limit = 20): Promise<Array<{ agent_id: string; cost_usd_micros: string }>> {
        const r = await this.query<{ agent_id: string; cost_usd_micros: string }>(
            `SELECT agent_id, SUM(cost_usd_micros)::text AS cost_usd_micros FROM cost_ledger
             WHERE agent_id IS NOT NULL AND occurred_at >= $1 AND occurred_at < $2
             GROUP BY agent_id ORDER BY SUM(cost_usd_micros) DESC LIMIT $3`,
            [from.toISOString(), to.toISOString(), limit],
        );
        return r.rows;
    }

    /** 기간 내 사용자 목록(명세서 물질화 대상). */
    async distinctUsers(from: Date, to: Date): Promise<string[]> {
        const r = await this.query<{ user_id: string }>(
            `SELECT DISTINCT user_id FROM cost_ledger WHERE user_id IS NOT NULL AND occurred_at >= $1 AND occurred_at < $2`,
            [from.toISOString(), to.toISOString()]);
        return r.rows.map((x) => x.user_id);
    }

    /** 보존 정리 — occurred_at 기준 days 초과 삭제. */
    async deleteOlderThan(days: number): Promise<number> {
        const r = await this.query(`DELETE FROM cost_ledger WHERE occurred_at < NOW() - ($1 || ' days')::interval`, [String(days)]);
        return r.rowCount ?? 0;
    }
}
