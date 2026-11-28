/**
 * 사용자별 쿼터 한도 덮어쓰기 저장소 (213, F25 잔여). 칸 값: NULL = 전역 값 · 0 = 무제한 · 양수 = 그 사용자의 한도.
 * @module data/repositories/user-quota-override-repository
 */
import { BaseRepository } from './base-repository';

export interface UserQuotaOverrideRow {
    user_id: string;
    hourly_token_limit: string | number | null;
    weekly_token_limit: string | number | null;
    monthly_cost_budget_micros: string | number | null;
    reason: string | null;
    updated_by: string | null;
    updated_at: string;
}

export interface UserQuotaOverrideInput {
    hourlyTokenLimit: number | null;
    weeklyTokenLimit: number | null;
    monthlyCostBudgetMicros: number | null;
    reason: string | null;
}

export class UserQuotaOverrideRepository extends BaseRepository {
    /** 저장 전 대상 확인 — FK 위반(23503)을 500 으로 내지 않고 404 로 답하기 위해. */
    async userExists(userId: string): Promise<boolean> {
        const r = await this.query('SELECT 1 FROM users WHERE id = $1', [userId]);
        return (r.rowCount ?? 0) > 0;
    }

    async get(userId: string): Promise<UserQuotaOverrideRow | null> {
        const r = await this.query<UserQuotaOverrideRow>('SELECT * FROM user_quota_overrides WHERE user_id = $1', [userId]);
        return r.rows[0] ?? null;
    }

    /** 관리자 목록 — 사용자 이름을 함께(삭제된 관리자는 updated_by NULL). */
    async list(limit: number): Promise<Array<UserQuotaOverrideRow & { username: string | null }>> {
        const r = await this.query<UserQuotaOverrideRow & { username: string | null }>(
            `SELECT o.*, u.username FROM user_quota_overrides o LEFT JOIN users u ON u.id = o.user_id
             ORDER BY o.updated_at DESC LIMIT $1`, [limit]);
        return r.rows;
    }

    async upsert(userId: string, input: UserQuotaOverrideInput, updatedBy: string): Promise<UserQuotaOverrideRow> {
        const r = await this.query<UserQuotaOverrideRow>(
            `INSERT INTO user_quota_overrides (user_id, hourly_token_limit, weekly_token_limit, monthly_cost_budget_micros, reason, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (user_id) DO UPDATE SET hourly_token_limit = EXCLUDED.hourly_token_limit,
                 weekly_token_limit = EXCLUDED.weekly_token_limit, monthly_cost_budget_micros = EXCLUDED.monthly_cost_budget_micros,
                 reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING *`,
            [userId, input.hourlyTokenLimit, input.weeklyTokenLimit, input.monthlyCostBudgetMicros, input.reason, updatedBy],
        );
        return r.rows[0];
    }

    async remove(userId: string): Promise<boolean> {
        const r = await this.query('DELETE FROM user_quota_overrides WHERE user_id = $1', [userId]);
        return (r.rowCount ?? 0) > 0;
    }
}
