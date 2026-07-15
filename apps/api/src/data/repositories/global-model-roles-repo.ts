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

    async upsert(role: ModelRole, fullModelId: string): Promise<GlobalModelRoleRow> {
        const result = await this.query<DbRow>(
            `INSERT INTO global_model_roles (role, full_model_id)
             VALUES ($1, $2)
             ON CONFLICT (role) DO UPDATE SET
                full_model_id = EXCLUDED.full_model_id,
                updated_at = now()
             RETURNING *`,
            [role, fullModelId],
        );
        return toRow(result.rows[0]);
    }

    async delete(role: ModelRole): Promise<boolean> {
        const result = await this.query(`DELETE FROM global_model_roles WHERE role = $1`, [role]);
        return (result.rowCount ?? 0) > 0;
    }
}
