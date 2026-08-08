/**
 * @module data/repositories/user-model-roles-repo
 * @description 사용자별 역할→모델 매핑 (user_model_roles) 저장소.
 *
 * Role-based Multi-Agent Orchestration Phase 2.
 * services/model-role-resolver 의 UserModelRoleLookup 과 구조적으로 호환
 * (getRoleModel) — 계층 방향(data→services 금지)상 명시적 implements 는 하지 않는다.
 *
 * @see db/migrations/069_user_model_roles.sql
 */
import { BaseRepository } from './base-repository';
import type { ModelRole } from '../../config/model-roles';

export interface UserModelRoleRow {
    userId: string;
    role: ModelRole;
    fullModelId: string;
    updatedAt: Date;
}

interface DbRow {
    user_id: string;
    role: ModelRole;
    full_model_id: string;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): UserModelRoleRow {
    return {
        userId: row.user_id,
        role: row.role,
        fullModelId: row.full_model_id,
        updatedAt: row.updated_at,
    };
}

export class UserModelRolesRepository extends BaseRepository {
    /** resolver 폴백 1순위 조회 — 매핑 없으면 null */
    async getRoleModel(userId: string, role: ModelRole): Promise<string | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM user_model_roles WHERE user_id = $1 AND role = $2`,
            [userId, role],
        );
        return result.rows[0]?.full_model_id ?? null;
    }

    async listByUser(userId: string): Promise<UserModelRoleRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM user_model_roles WHERE user_id = $1 ORDER BY role`,
            [userId],
        );
        return result.rows.map(toRow);
    }

    /**
     * 배정/변경 — 직전 값(previous)을 같은 트랜잭션에서 원자적으로 캡처해 함께 반환한다.
     * previous 는 쓰기의 부산물이라 별도 선-조회가 없다 → 감사용 조회 실패가 배정 자체를
     * 막던 회귀를 제거한다. per-key advisory lock 으로 같은 (user,role) 동시 변경을 직렬화해
     * previous 가 실제 직전값과 일치하도록 보장한다(2026-08-08 소실 사건의 복원 근거 정확성).
     */
    async upsert(
        userId: string,
        role: ModelRole,
        fullModelId: string,
    ): Promise<{ mapping: UserModelRoleRow; previous: string | null }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`umr:${userId}:${role}`]);
            const prev = await client.query<DbRow>(
                `SELECT full_model_id FROM user_model_roles WHERE user_id = $1 AND role = $2`,
                [userId, role],
            );
            const previous = prev.rows[0]?.full_model_id ?? null;
            const upserted = await client.query<DbRow>(
                `INSERT INTO user_model_roles (user_id, role, full_model_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, role) DO UPDATE SET
                    full_model_id = EXCLUDED.full_model_id,
                    updated_at = now()
                 RETURNING *`,
                [userId, role, fullModelId],
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
    async delete(userId: string, role: ModelRole): Promise<{ deleted: boolean; previous: string | null }> {
        const result = await this.query<{ full_model_id: string }>(
            `DELETE FROM user_model_roles WHERE user_id = $1 AND role = $2 RETURNING full_model_id`,
            [userId, role],
        );
        return { deleted: (result.rowCount ?? 0) > 0, previous: result.rows[0]?.full_model_id ?? null };
    }
}
