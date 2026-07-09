/**
 * @module data/repositories/user-agent-repository
 * @description Custom Agent (사용자 정의 페르소나) CRUD.
 *
 * 도입 (2026-05-26): claude.ai Projects / ChatGPT Custom GPTs 동등 기능.
 * 사용자가 자신만의 system prompt + tools + skills 묶음을 정의하고 재사용.
 *
 * @see db/migrations/033_user_agents.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';

export interface UserAgent {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    system_prompt: string;
    allowed_tools: string[];
    allowed_skills: string[];
    icon: string | null;
    is_active: boolean;
    usage_count: number;
    created_at: string;
    updated_at: string;
}

export interface UserAgentCreate {
    id: string;
    userId: string;
    name: string;
    description?: string | null;
    systemPrompt: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    icon?: string | null;
}

export interface UserAgentUpdate {
    name?: string;
    description?: string | null;
    systemPrompt?: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    icon?: string | null;
}

export class UserAgentRepository extends BaseRepository {
    async create(params: UserAgentCreate): Promise<UserAgent> {
        const result = await this.query<UserAgent>(
            `INSERT INTO user_agents (
                id, user_id, name, description, system_prompt,
                allowed_tools, allowed_skills, icon
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
             RETURNING *`,
            [
                params.id,
                params.userId,
                params.name,
                params.description ?? null,
                params.systemPrompt,
                JSON.stringify(params.allowedTools ?? []),
                JSON.stringify(params.allowedSkills ?? []),
                params.icon ?? null,
            ],
        );
        return result.rows[0] as UserAgent;
    }

    async listByUser(userId: string, includeInactive = false): Promise<UserAgent[]> {
        const where = includeInactive ? '' : 'AND is_active = TRUE';
        const result = await this.query<UserAgent>(
            `SELECT * FROM user_agents WHERE user_id = $1 ${where}
             ORDER BY updated_at DESC`,
            [userId],
        );
        return result.rows as UserAgent[];
    }

    async getByIdForUser(id: string, userId: string): Promise<UserAgent | undefined> {
        // soft-delete 계약: is_active=FALSE 는 삭제된 에이전트 — 조회에서 제외 (listByUser 와 동일)
        const result = await this.query<UserAgent>(
            'SELECT * FROM user_agents WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
            [id, userId],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    async update(id: string, userId: string, patch: UserAgentUpdate): Promise<UserAgent | undefined> {
        const sets: string[] = [];
        const values: QueryParam[] = [];
        let i = 1;
        if (patch.name !== undefined)         { sets.push(`name = $${i++}`); values.push(patch.name); }
        if (patch.description !== undefined)  { sets.push(`description = $${i++}`); values.push(patch.description); }
        if (patch.systemPrompt !== undefined) { sets.push(`system_prompt = $${i++}`); values.push(patch.systemPrompt); }
        if (patch.allowedTools !== undefined) { sets.push(`allowed_tools = $${i++}::jsonb`); values.push(JSON.stringify(patch.allowedTools)); }
        if (patch.allowedSkills !== undefined){ sets.push(`allowed_skills = $${i++}::jsonb`); values.push(JSON.stringify(patch.allowedSkills)); }
        if (patch.icon !== undefined)         { sets.push(`icon = $${i++}`); values.push(patch.icon); }
        if (sets.length === 0) return this.getByIdForUser(id, userId);
        sets.push(`updated_at = NOW()`);
        values.push(id, userId);
        const result = await this.query<UserAgent>(
            `UPDATE user_agents SET ${sets.join(', ')}
             WHERE id = $${i++} AND user_id = $${i++} AND is_active = TRUE
             RETURNING *`,
            values,
        );
        return result.rows[0] as UserAgent | undefined;
    }

    async softDelete(id: string, userId: string): Promise<boolean> {
        const result = await this.query<{ id: string }>(
            'UPDATE user_agents SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, userId],
        );
        return result.rowCount! > 0;
    }

    async incrementUsage(id: string): Promise<void> {
        await this.query(
            'UPDATE user_agents SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1',
            [id],
        );
    }
}
