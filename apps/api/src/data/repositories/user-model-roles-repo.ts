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

    async upsert(userId: string, role: ModelRole, fullModelId: string): Promise<UserModelRoleRow> {
        const result = await this.query<DbRow>(
            `INSERT INTO user_model_roles (user_id, role, full_model_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, role) DO UPDATE SET
                full_model_id = EXCLUDED.full_model_id,
                updated_at = now()
             RETURNING *`,
            [userId, role, fullModelId],
        );
        return toRow(result.rows[0]);
    }

    /** 매핑 해제 — 삭제 성공 여부 반환 */
    async delete(userId: string, role: ModelRole): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM user_model_roles WHERE user_id = $1 AND role = $2`,
            [userId, role],
        );
        return (result.rowCount ?? 0) > 0;
    }
}
