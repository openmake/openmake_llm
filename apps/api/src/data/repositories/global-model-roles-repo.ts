/**
 * @module data/repositories/global-model-roles-repo
 * @description 전역 역할→모델 매핑 (Admin UI, L3) 저장소.
 *
 * 해석 우선순위에서 사용자 매핑 다음, env 전역 이전에 조회된다.
 * @see db/migrations/071_global_model_roles.sql
 */
import { BaseRepository } from './base-repository';
import type { ModelRole } from '../../config/model-roles';

export interface GlobalModelRoleRow {
    role: ModelRole;
    fullModelId: string;
    updatedAt: Date;
}

interface DbRow {
    role: ModelRole;
    full_model_id: string;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): GlobalModelRoleRow {
    return { role: row.role, fullModelId: row.full_model_id, updatedAt: row.updated_at };
}

export class GlobalModelRolesRepository extends BaseRepository {
    async list(): Promise<GlobalModelRoleRow[]> {
        const result = await this.query<DbRow>(`SELECT * FROM global_model_roles ORDER BY role`);
        return result.rows.map(toRow);
    }

    /**
     * 배정/변경 — 직전 값(previous)을 같은 트랜잭션에서 원자적으로 캡처해 함께 반환한다.
     * previous 는 쓰기의 부산물이라 별도 선-조회가 없다 → 감사용 조회 실패가 배정 자체를
     * 막던 회귀를 제거한다. per-role advisory lock 으로 같은 role 동시 변경을 직렬화해
     * previous 가 실제 직전값과 일치하도록 보장한다(소실 사건의 복원 근거 정확성).
     */
    async upsert(
        role: ModelRole,
        fullModelId: string,
    ): Promise<{ mapping: GlobalModelRoleRow; previous: string | null }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gmr:${role}`]);
            const prev = await client.query<DbRow>(
                `SELECT full_model_id FROM global_model_roles WHERE role = $1`,
                [role],
            );
            const previous = prev.rows[0]?.full_model_id ?? null;
            const upserted = await client.query<DbRow>(
                `INSERT INTO global_model_roles (role, full_model_id)
                 VALUES ($1, $2)
                 ON CONFLICT (role) DO UPDATE SET
                    full_model_id = EXCLUDED.full_model_id,
                    updated_at = now()
                 RETURNING *`,
                [role, fullModelId],
            );
            await client.query('COMMIT');
            return { mapping: toRow(upserted.rows[0]), previous };
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch { /* rollback best-effort */ }
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * 매핑 해제 — 삭제된 직전 값(previous)을 RETURNING 으로 원자적으로 함께 반환한다.
     * 반환값이 곧 삭제 대상이라 별도 선-조회 없이 감사 previous 를 정확히 남긴다.
     */
    async delete(role: ModelRole): Promise<{ deleted: boolean; previous: string | null }> {
        const result = await this.query<{ full_model_id: string }>(
            `DELETE FROM global_model_roles WHERE role = $1 RETURNING full_model_id`,
            [role],
        );
        return { deleted: (result.rowCount ?? 0) > 0, previous: result.rows[0]?.full_model_id ?? null };
    }
}
