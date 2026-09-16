/**
 * 쿼터 추가 한도·초과 요청 저장소 (135). @module data/repositories/quota-grant-repository
 */
import { BaseRepository } from './base-repository';

export type QuotaWindow = 'hourly' | 'weekly' | 'monthly';
export type GrantKind = 'rollover' | 'approval' | 'manual';

export interface QuotaGrantRow { id: number; subject_type: string; subject_id: string; window: QuotaWindow; bucket: string; amount: string | number; kind: GrantKind; source_id: string; created_at: string }
export interface OverageRequestRow {
    id: string; user_id: string; window: QuotaWindow; bucket: string; requested_amount: string | number; reason: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'expired'; auto_created: boolean; decided_by: string | null; decided_at: string | null;
    granted_amount: string | number | null; created_at: string; expires_at: string;
}

export class QuotaGrantRepository extends BaseRepository {
    /** 해당 윈도우 버킷의 grants 합(토큰). */
    async sumUserGrants(userId: string, window: QuotaWindow, bucket: string): Promise<number> {
        const r = await this.query<{ total: string | null }>(
            `SELECT SUM(amount)::text AS total FROM quota_grants
             WHERE subject_type = 'user' AND subject_id = $1 AND dimension = 'tokens' AND "window" = $2 AND bucket = $3`,
            [userId, window, bucket],
        );
        return Number(r.rows[0]?.total ?? 0);
    }

    /** 멱등 삽입 — 같은 (subject, window, bucket, kind, source) 가 있으면 false. */
    async insertIfAbsent(p: { userId: string; window: QuotaWindow; bucket: string; amount: number; kind: GrantKind; sourceId?: string; createdBy?: string | null }): Promise<boolean> {
        const r = await this.query(
            `INSERT INTO quota_grants (subject_type, subject_id, dimension, "window", bucket, amount, kind, source_id, created_by)
             VALUES ('user', $1, 'tokens', $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [p.userId, p.window, p.bucket, Math.round(p.amount), p.kind, p.sourceId ?? '', p.createdBy ?? null],
        );
        return (r.rowCount ?? 0) > 0;
    }

    async listUserGrants(userId: string, limit = 50): Promise<QuotaGrantRow[]> {
        const r = await this.query<QuotaGrantRow>(
            `SELECT * FROM quota_grants WHERE subject_type = 'user' AND subject_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
        return r.rows;
    }

    // ── 초과 요청 ──
    /** pending 이 이미 있으면 null(부분 유니크 인덱스 충돌 → 무시), 아니면 새 행. */
    async createOverageIfNoPending(p: { id: string; userId: string; window: QuotaWindow; bucket: string; requestedAmount: number; reason: string | null; autoCreated: boolean; expiresAt: Date }): Promise<OverageRequestRow | null> {
        const r = await this.query<OverageRequestRow>(
            `INSERT INTO quota_overage_requests (id, user_id, "window", bucket, requested_amount, reason, auto_created, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING RETURNING *`,
            [p.id, p.userId, p.window, p.bucket, Math.round(p.requestedAmount), p.reason, p.autoCreated, p.expiresAt.toISOString()],
        );
        return r.rows[0] ?? null;
    }

    async findPendingOverage(userId: string, window: QuotaWindow, bucket: string): Promise<OverageRequestRow | null> {
        const r = await this.query<OverageRequestRow>(
            `SELECT * FROM quota_overage_requests WHERE user_id = $1 AND "window" = $2 AND bucket = $3 AND status = 'pending'`, [userId, window, bucket]);
        return r.rows[0] ?? null;
    }

    async listOverages(status: string | undefined, limit: number, userId?: string): Promise<OverageRequestRow[]> {
        const conds: string[] = []; const params: (string | number)[] = [];
        if (status) { params.push(status); conds.push(`status = $${params.length}`); }
        if (userId) { params.push(userId); conds.push(`user_id = $${params.length}`); }
        params.push(limit);
        const r = await this.query<OverageRequestRow>(
            `SELECT * FROM quota_overage_requests ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return r.rows;
    }

    async getOverage(id: string): Promise<OverageRequestRow | null> {
        const r = await this.query<OverageRequestRow>('SELECT * FROM quota_overage_requests WHERE id = $1', [id]);
        return r.rows[0] ?? null;
    }

    /** pending → approved/rejected. 이미 결정된 행은 null. */
    async decideOverage(id: string, status: 'approved' | 'rejected', decidedBy: string, grantedAmount: number | null): Promise<OverageRequestRow | null> {
        const r = await this.query<OverageRequestRow>(
            `UPDATE quota_overage_requests SET status = $2, decided_by = $3, decided_at = NOW(), granted_amount = $4
             WHERE id = $1 AND status = 'pending' RETURNING *`,
            [id, status, decidedBy, grantedAmount],
        );
        return r.rows[0] ?? null;
    }
}
