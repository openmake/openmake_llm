/**
 * ============================================================
 * Skill Repository - 에이전트 스킬 데이터 접근 계층
 * ============================================================
 *
 * `agent_skills` / `agent_skill_assignments` 테이블의 CRUD 및 검색,
 * 에이전트-스킬 연결 관리를 담당합니다.
 *
 * @module data/repositories/skill-repository
 */

import { BaseRepository, QueryParam } from './base-repository';
import { assertResourceOwnerOrAdmin } from '../../auth/ownership';

export interface AgentSkill {
    id: string;
    name: string;
    description: string;
    content: string;
    category: string;
    isPublic: boolean;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
    sourceRepo?: string;
    sourcePath?: string;
}

export interface AgentSkillAssignment {
    agentId: string;
    skillId: string;
    priority: number;
    createdAt: Date;
}

export interface CreateSkillInput {
    name: string;
    description?: string;
    content: string;
    category?: string;
    isPublic?: boolean;
    createdBy?: string;
    sourceRepo?: string;
    sourcePath?: string;
}

export interface UpdateSkillInput {
    name?: string;
    description?: string;
    content?: string;
    category?: string;
    isPublic?: boolean;
}

export interface SkillSearchOptions {
    userId?: string;
    search?: string;
    category?: string;
    isPublic?: boolean;
    sortBy?: 'newest' | 'name' | 'category' | 'updated';
    limit?: number;
    offset?: number;
}

export interface SkillSearchResult {
    skills: AgentSkill[];
    total: number;
    limit: number;
    offset: number;
}

interface CountRow {
    total: string;
}

interface SkillIdRow {
    skill_id: string;
}

interface SkillOwnerRow {
    created_by: string | null;
}

interface CategoryCountRow {
    category: string;
    count: string;
}

/** 소유권 검증 요청자 컨텍스트 */
export interface ActorContext {
    userId: string;
    userRole: string;
}

export class SkillRepository extends BaseRepository {
    async createSkill(input: CreateSkillInput): Promise<AgentSkill> {
        const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date();
        const nowIso = now.toISOString();

        await this.query(
            `INSERT INTO agent_skills (id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                id,
                input.name,
                input.description ?? null,
                input.content,
                input.category ?? 'general',
                input.isPublic ?? false,
                input.createdBy ?? null,
                nowIso,
                nowIso,
                input.sourceRepo ?? null,
                input.sourcePath ?? null,
            ]
        );

        const created = await this.getSkillById(id);
        return created ?? {
            id,
            name: input.name,
            description: input.description ?? '',
            content: input.content,
            category: input.category ?? 'general',
            isPublic: input.isPublic ?? false,
            createdBy: input.createdBy,
            createdAt: now,
            updatedAt: now,
            sourceRepo: input.sourceRepo,
            sourcePath: input.sourcePath,
        };
    }

    /**
     * 스킬을 수정합니다. actor가 주어지면 소유권을 검증합니다.
     * 시스템 스킬(createdBy=null)은 소유권 검증 없이 수정 가능합니다.
     * @param id - 스킬 ID
     * @param input - 수정 데이터
     * @param actor - (선택) 요청자 컨텍스트 (userId + userRole)
     */
    async updateSkill(id: string, input: UpdateSkillInput, actor?: ActorContext): Promise<AgentSkill | null> {
        const existing = await this.getSkillById(id);
        if (!existing) {
            return null;
        }

        // 소유권 검증: 사용자 스킬(createdBy 존재)이면 소유자 또는 관리자만 수정 가능
        if (actor && existing.createdBy) {
            assertResourceOwnerOrAdmin(existing.createdBy, actor.userId, actor.userRole);
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const params: QueryParam[] = [
            input.name ?? existing.name,
            input.description !== undefined ? input.description : existing.description,
            input.content ?? existing.content,
            input.category ?? existing.category,
            input.isPublic !== undefined ? input.isPublic : existing.isPublic,
            nowIso,
            id,
        ];

        await this.query(
            `UPDATE agent_skills
             SET name = $1, description = $2, content = $3, category = $4, is_public = $5, updated_at = $6
             WHERE id = $7`,
            params
        );

        return this.getSkillById(id);
    }

    /**
     * 스킬을 삭제합니다. actor가 주어지면 소유권을 검증합니다.
     * 시스템 스킬(createdBy=null)은 소유권 검증 없이 삭제 가능합니다.
     * @param id - 스킬 ID
     * @param actor - (선택) 요청자 컨텍스트 (userId + userRole)
     */
    async deleteSkill(id: string, actor?: ActorContext): Promise<boolean> {
        // 소유권 검증
        if (actor) {
            const existing = await this.getSkillById(id);
            if (existing && existing.createdBy) {
                assertResourceOwnerOrAdmin(existing.createdBy, actor.userId, actor.userRole);
            }
        }

        const result = await this.query('DELETE FROM agent_skills WHERE id = $1', [id]);
        return (result.rowCount ?? 0) > 0;
    }

    async getSkillById(id: string): Promise<AgentSkill | null> {
        const result = await this.query(
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path
             FROM agent_skills
             WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.rowToSkill(result.rows[0]);
    }

    async getAllSkills(userId?: string): Promise<AgentSkill[]> {
        let sql = `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path
                   FROM agent_skills`;
        const params: QueryParam[] = [];

        if (userId) {
            sql += ' WHERE created_by = $1 OR is_public = TRUE';
            params.push(userId);
        } else {
            sql += ' WHERE is_public = TRUE';
        }

        sql += ' ORDER BY created_at DESC';

        const result = await this.query(sql, params);
        return result.rows.map((row) => this.rowToSkill(row));
    }

    async searchSkills(options: SkillSearchOptions): Promise<SkillSearchResult> {
        const conditions: string[] = [];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (options.userId) {
            conditions.push(`(created_by = $${paramIdx} OR is_public = TRUE)`);
            params.push(options.userId);
            paramIdx += 1;
        } else {
            conditions.push('is_public = TRUE');
        }

        if (options.search) {
            conditions.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR content ILIKE $${paramIdx})`);
            params.push(`%${this.escapeILike(options.search)}%`);
            paramIdx += 1;
        }

        if (options.category) {
            conditions.push(`category = $${paramIdx}`);
            params.push(options.category);
            paramIdx += 1;
        }

        if (options.isPublic !== undefined) {
            conditions.push(`is_public = $${paramIdx}`);
            params.push(options.isPublic);
            paramIdx += 1;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sortMap: Record<NonNullable<SkillSearchOptions['sortBy']>, string> = {
            newest: 'created_at DESC',
            name: 'name ASC',
            category: 'category ASC, name ASC',
            updated: 'updated_at DESC',
        };

        const sortKey = options.sortBy ?? 'newest';
        const orderBy = sortMap[sortKey] ?? sortMap.newest;

        const limit = Math.min(options.limit ?? 20, 100);
        const offset = Math.max(0, options.offset ?? 0);

        const countResult = await this.query<CountRow>(
            `SELECT COUNT(*) AS total
             FROM agent_skills
             ${whereClause}`,
            params
        );

        const dataParams: QueryParam[] = [...params, limit, offset];
        const dataResult = await this.query(
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path
             FROM agent_skills
             ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams
        );

        return {
            skills: dataResult.rows.map((row) => this.rowToSkill(row)),
            total: parseInt(countResult.rows[0]?.total ?? '0', 10),
            limit,
            offset,
        };
    }

    async getCategories(): Promise<Array<{ category: string; count: number }>> {
        const result = await this.query<CategoryCountRow>(
            `SELECT COALESCE(category, 'general') AS category, COUNT(*)::text AS count
             FROM agent_skills
             GROUP BY COALESCE(category, 'general')
             ORDER BY category ASC`
        );

        return result.rows.map((row) => ({
            category: row.category,
            count: parseInt(row.count, 10),
        }));
    }

    /**
     * 시스템 스킬 업서트 (upsert) - 결정적 ID로 생성 또는 업데이트
     * 서버 시작 시 에이전트 스킬 자동 등록에 사용됩니다.
     * source_path를 기준으로 기존 스킬을 찾아 업데이트하거나 새로 생성합니다.
     */
    async upsertSystemSkill(id: string, input: CreateSkillInput): Promise<AgentSkill> {
        const nowIso = new Date().toISOString();
        const result = await this.query(
            `INSERT INTO agent_skills (id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name,
                 description = EXCLUDED.description,
                 content = EXCLUDED.content,
                 category = EXCLUDED.category,
                 is_public = EXCLUDED.is_public,
                 updated_at = EXCLUDED.updated_at,
                 source_path = EXCLUDED.source_path
             RETURNING id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path`,
            [
                id,
                input.name,
                input.description ?? null,
                input.content,
                input.category ?? 'general',
                input.isPublic ?? true,
                input.createdBy ?? null,
                nowIso,
                nowIso,
                input.sourceRepo ?? null,
                input.sourcePath ?? null,
            ]
        );
        if (result.rows.length > 0) {
            return this.rowToSkill(result.rows[0]);
        }
        // fallback (should not normally happen)
        return {
            id,
            name: input.name,
            description: input.description ?? '',
            content: input.content,
            category: input.category ?? 'general',
            isPublic: input.isPublic ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async assignSkillToAgent(agentId: string, skillId: string, priority: number = 0): Promise<void> {
        await this.query(
            `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (agent_id, skill_id) DO UPDATE
             SET priority = EXCLUDED.priority`,
            [agentId, skillId, priority]
        );
    }

    async removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
        await this.query(
            'DELETE FROM agent_skill_assignments WHERE agent_id = $1 AND skill_id = $2',
            [agentId, skillId]
        );
    }

    /**
     * 에이전트에 연결된 스킬 목록 반환
     * 특정 에이전트 스킬 + '__global__' 가상 에이전트에 할당된 스킬 모두 포함.
     * userId가 주어지면 'user:{userId}' 패턴의 개인 스킬도 포함.
     * 중복 방지: 같은 스킬이 여러 곳에 할당된 경우 낙은 priority 우선.
     */
    async getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<AgentSkill[]> {
        // 1. 에이전트 고유 스킬 + __global__ 스킬 (제한 없음)
        const conditions: string[] = ['a.agent_id = $1', "a.agent_id = '__global__'"];
        const params: QueryParam[] = [agentId];

        // 2. 개인 스킬: 에이전트 카테고리와 일치하는 스킬만 포함 (최대 10개)
        //    카테고리 불일치 스킬은 프롬프트 오염 방지를 위해 제외
        if (userId) {
            if (agentCategory) {
                // 카테고리 매칭: 개인 스킬 중 에이전트 카테고리와 동일한 것만
                conditions.push(`(a.agent_id = $${params.length + 1} AND s.category = $${params.length + 2})`);
                params.push(`user:${userId}`, agentCategory);
            } else {
                // 카테고리 불명 시 개인 스킬 포함하되 10개 제한은 ORDER/LIMIT으로 처리
                conditions.push(`a.agent_id = $${params.length + 1}`);
                params.push(`user:${userId}`);
            }
        }

        const whereClause = conditions.join(' OR ');
        const result = await this.query(
            `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public,
                    s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path,
                    MIN(a.priority) AS priority
             FROM agent_skills s
             JOIN agent_skill_assignments a ON s.id = a.skill_id
             WHERE ${whereClause}
             GROUP BY s.id, s.name, s.description, s.content, s.category, s.is_public,
                      s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path
             ORDER BY MIN(a.priority) ASC, s.name ASC
             LIMIT 15`,
            params
        );
        return result.rows.map((row) => this.rowToSkill(row));
    }

    /**
     * 에이전트에 연결된 스킬 ID 목록 반환 (__global__ 포함, userId 개인 스킬 포함)
     */
    async getSkillIdsForAgent(agentId: string, userId?: string): Promise<string[]> {
        const conditions: string[] = ['agent_id = $1', "agent_id = '__global__'"];
        const params: QueryParam[] = [agentId];

        if (userId) {
            conditions.push('agent_id = $2');
            params.push(`user:${userId}`);
        }

        const whereClause = conditions.join(' OR ');
        const result = await this.query<SkillIdRow>(
            `SELECT DISTINCT skill_id
             FROM agent_skill_assignments
             WHERE ${whereClause}`,
            params
        );
        return result.rows.map((row) => row.skill_id);
    }

    /**
     * 사용자 개인 스킬 할당 (user:{userId} 가상 에이전트 ID 패턴)
     */
    async assignSkillToUser(userId: string, skillId: string, priority: number = 0): Promise<void> {
        await this.query(
            `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (agent_id, skill_id) DO UPDATE
             SET priority = EXCLUDED.priority`,
            [`user:${userId}`, skillId, priority]
        );
    }

    /**
     * 사용자 개인 스킬 할당 해제
     */
    async removeSkillFromUser(userId: string, skillId: string): Promise<void> {
        await this.query(
            'DELETE FROM agent_skill_assignments WHERE agent_id = $1 AND skill_id = $2',
            [`user:${userId}`, skillId]
        );
    }

    /**
     * 사용자 개인 할당 스킬 ID 목록 반환
     */
    async getUserSkillIds(userId: string): Promise<string[]> {
        const result = await this.query<SkillIdRow>(
            `SELECT skill_id FROM agent_skill_assignments WHERE agent_id = $1`,
            [`user:${userId}`]
        );
        return result.rows.map((row) => row.skill_id);
    }

    /**
     * 사용자 개인 할당 스킬 전체 목록 반환
     */
    async getUserSkills(userId: string): Promise<AgentSkill[]> {
        const result = await this.query(
            `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public,
                    s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path
             FROM agent_skills s
             JOIN agent_skill_assignments a ON s.id = a.skill_id
             WHERE a.agent_id = $1
             ORDER BY a.priority ASC, s.name ASC`,
            [`user:${userId}`]
        );
        return result.rows.map((row) => this.rowToSkill(row));
    }

    async getSkillOwner(skillId: string): Promise<string | null> {
        const result = await this.query<SkillOwnerRow>(
            `SELECT created_by
             FROM agent_skills
             WHERE id = $1`,
            [skillId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return result.rows[0].created_by;
    }

    private rowToSkill(row: Record<string, unknown>): AgentSkill {
        const createdBy = row.created_by;
        const sourceRepo = row.source_repo;
        const sourcePath = row.source_path;

        return {
            id: this.toStringValue(row.id),
            name: this.toStringValue(row.name),
            description: this.toStringValue(row.description, ''),
            content: this.toStringValue(row.content),
            category: this.toStringValue(row.category, 'general'),
            isPublic: this.toBooleanValue(row.is_public, false),
            createdBy: typeof createdBy === 'string' ? createdBy : undefined,
            createdAt: this.toDateValue(row.created_at),
            updatedAt: this.toDateValue(row.updated_at),
            sourceRepo: typeof sourceRepo === 'string' ? sourceRepo : undefined,
            sourcePath: typeof sourcePath === 'string' ? sourcePath : undefined,
        };
    }

    private escapeILike(str: string): string {
        return str.replace(/[%_]/g, '\\$&');
    }

    private toStringValue(value: unknown, fallback: string = ''): string {
        if (typeof value === 'string') {
            return value;
        }
        return fallback;
    }

    private toBooleanValue(value: unknown, fallback: boolean): boolean {
        if (typeof value === 'boolean') {
            return value;
        }
        return fallback;
    }

    private toDateValue(value: unknown): Date {
        if (value instanceof Date) {
            return value;
        }
        if (typeof value === 'string' || typeof value === 'number') {
            return new Date(value);
        }
        return new Date(0);
    }
}
