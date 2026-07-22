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
    /** 에이전트 전용 모델 fullId (NULL=상속 — 요청 model 자동일 때만 적용, Phase C) */
    model: string | null;
    /** 'private'(기본, 소유자 전용) | 'shared'(워크스페이스 전원 사용). 편집/삭제는 shared 여도 소유자 한정. */
    visibility: 'private' | 'shared';
    is_active: boolean;
    usage_count: number;
    created_at: string;
    updated_at: string;
}

/** 목록 응답용 — 소유 여부 플래그 부착(다른 사용자의 공유 에이전트 구분). */
export interface UserAgentWithOwnership extends UserAgent {
    owned: boolean;
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
    model?: string | null;
}

export interface UserAgentUpdate {
    name?: string;
    description?: string | null;
    systemPrompt?: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    icon?: string | null;
    model?: string | null;
}

export class UserAgentRepository extends BaseRepository {
    async create(params: UserAgentCreate): Promise<UserAgent> {
        const result = await this.query<UserAgent>(
            `INSERT INTO user_agents (
                id, user_id, name, description, system_prompt,
                allowed_tools, allowed_skills, icon, model
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
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
                params.model ?? null,
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

    /**
     * 실행/사용 경로용 조회 — 소유 에이전트 OR 워크스페이스 공유 에이전트(다른 소유자).
     * loadUserAgent 의 유일 choke point 가 이걸 호출해 크로스유저 공유 사용을 연다.
     * 편집/삭제는 여전히 getByIdForUser·update·softDelete 의 user_id 한정을 통과해야 한다.
     */
    async getByIdVisibleToUser(id: string, userId: string): Promise<UserAgent | undefined> {
        const result = await this.query<UserAgent>(
            `SELECT * FROM user_agents
             WHERE id = $1 AND is_active = TRUE
               AND (user_id = $2 OR visibility = 'shared')`,
            [id, userId],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    /** 목록 — 본인 소유(전부) + 다른 소유자의 공유 에이전트. owned 플래그로 구분. */
    async listVisibleToUser(userId: string): Promise<UserAgentWithOwnership[]> {
        const result = await this.query<UserAgentWithOwnership>(
            `SELECT *, (user_id = $1) AS owned FROM user_agents
             WHERE is_active = TRUE AND (user_id = $1 OR visibility = 'shared')
             ORDER BY owned DESC, updated_at DESC`,
            [userId],
        );
        return result.rows as UserAgentWithOwnership[];
    }

    /** 공유 상태 전환 — 소유자 전용(user_id 한정). publish/unpublish 양방향. */
    async setVisibility(id: string, userId: string, visibility: 'private' | 'shared'): Promise<UserAgent | undefined> {
        const result = await this.query<UserAgent>(
            `UPDATE user_agents SET visibility = $3, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE
             RETURNING *`,
            [id, userId, visibility],
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
        if (patch.model !== undefined)        { sets.push(`model = $${i++}`); values.push(patch.model); }
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
