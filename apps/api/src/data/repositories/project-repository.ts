/**
 * @module data/repositories/project-repository
 * @description 사용자별 Project CRUD.
 *
 * 관련 대화를 묶어 컨텍스트를 공유하는 단위. user_agents 도메인을
 * 1:1 미러링한 단순 CRUD 도메인.
 *
 * @see db/migrations/041_projects.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';

export interface Project {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface ProjectCreate {
    id: string;
    userId: string;
    name: string;
    description?: string | null;
}

export interface ProjectUpdate {
    name?: string;
    description?: string | null;
}

export class ProjectRepository extends BaseRepository {
    async create(params: ProjectCreate): Promise<Project> {
        const result = await this.query<Project>(
            `INSERT INTO projects (
                id, user_id, name, description
            ) VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                params.id,
                params.userId,
                params.name,
                params.description ?? null,
            ],
        );
        return result.rows[0] as Project;
    }

    async listByUser(userId: string, includeInactive = false): Promise<Project[]> {
        const where = includeInactive ? '' : 'AND is_active = TRUE';
        const result = await this.query<Project>(
            `SELECT * FROM projects WHERE user_id = $1 ${where}
             ORDER BY updated_at DESC`,
            [userId],
        );
        return result.rows as Project[];
    }

    async getByIdForUser(id: string, userId: string): Promise<Project | undefined> {
        const result = await this.query<Project>(
            'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
            [id, userId],
        );
        return result.rows[0] as Project | undefined;
    }

    async update(id: string, userId: string, patch: ProjectUpdate): Promise<Project | undefined> {
        const sets: string[] = [];
        const values: QueryParam[] = [];
        let i = 1;
        if (patch.name !== undefined)        { sets.push(`name = $${i++}`); values.push(patch.name); }
        if (patch.description !== undefined) { sets.push(`description = $${i++}`); values.push(patch.description); }
        if (sets.length === 0) return this.getByIdForUser(id, userId);
        sets.push(`updated_at = NOW()`);
        values.push(id, userId);
        const result = await this.query<Project>(
            `UPDATE projects SET ${sets.join(', ')}
             WHERE id = $${i++} AND user_id = $${i++}
             RETURNING *`,
            values,
        );
        return result.rows[0] as Project | undefined;
    }

    async softDelete(id: string, userId: string): Promise<boolean> {
        const result = await this.query<{ id: string }>(
            'UPDATE projects SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, userId],
        );
        return result.rowCount! > 0;
    }
}
