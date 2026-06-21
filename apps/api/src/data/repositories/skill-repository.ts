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
import { rowToSkill } from './skill-row-mapper';
import { SkillAssignmentRepository } from './skill-assignment-repository';

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
    status?: 'draft' | 'active' | 'archived';
    manifestMeta?: Record<string, unknown>;
}

export type SkillStatus = 'draft' | 'active' | 'archived';

export interface DraftListOptions {
    target?: 'user' | 'system' | 'all';
    userId?: string;
    limit?: number;
    offset?: number;
}

export interface DraftListResult {
    drafts: AgentSkill[];
    total: number;
    limit: number;
    offset: number;
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
    /** 'draft' | 'active' | 'all'. 기본값 'active' — 일반 라이브러리에는 draft 노출 금지. */
    status?: 'draft' | 'active' | 'all';
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
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path, status, manifest_meta
             FROM agent_skills
             WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return rowToSkill(result.rows[0]);
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

        // status 필터: 기본 'active'. 'all' 이면 필터 없음, 'draft' 면 draft 만.
        const statusFilter = options.status ?? 'active';
        if (statusFilter !== 'all') {
            conditions.push(`status = $${paramIdx}`);
            params.push(statusFilter);
            paramIdx += 1;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sortMap: Record<NonNullable<SkillSearchOptions['sortBy']>, string> = {
            newest: 'created_at DESC, id ASC',
            name: 'name ASC, id ASC',
            category: 'category ASC, name ASC, id ASC',
            updated: 'updated_at DESC, id ASC',
        };

        const sortKey = options.sortBy ?? 'newest';
        const orderBy = sortMap[sortKey] ?? sortMap.newest;

        const limit = Math.min(options.limit ?? 20, 200);
        const offset = Math.max(0, options.offset ?? 0);

        const countResult = await this.query<CountRow>(
            `SELECT COUNT(*) AS total
             FROM agent_skills
             ${whereClause}`,
            params
        );

        const dataParams: QueryParam[] = [...params, limit, offset];
        const dataResult = await this.query(
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path, status, manifest_meta
             FROM agent_skills
             ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams
        );

        return {
            skills: dataResult.rows.map((row) => rowToSkill(row)),
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
        // 시스템 스킬 재시드 = active 강제. 누군가 system skill 을 archived 로 바꿔도
        // 부트스트랩 재실행 시 자동 복구됨 (시스템 스킬은 늘 active 가 invariant).
        const result = await this.query(
            `INSERT INTO agent_skills (id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
             ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name,
                 description = EXCLUDED.description,
                 content = EXCLUDED.content,
                 category = EXCLUDED.category,
                 is_public = EXCLUDED.is_public,
                 updated_at = EXCLUDED.updated_at,
                 source_path = EXCLUDED.source_path,
                 status = 'active'
             RETURNING id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path, status, manifest_meta`,
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
            return rowToSkill(result.rows[0]);
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

    // ────────────────────────────────────────────────────────────
    // Assignment facade — 실제 구현은 SkillAssignmentRepository.
    // 기존 호출자가 SkillRepository 하나만 사용해 둘 다 호출 가능.
    // ────────────────────────────────────────────────────────────
    private get assignments(): SkillAssignmentRepository {
        return new SkillAssignmentRepository(this.pool);
    }
    async assignSkillToAgent(agentId: string, skillId: string, priority: number = 0): Promise<void> {
        return this.assignments.assignSkillToAgent(agentId, skillId, priority);
    }
    async removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
        return this.assignments.removeSkillFromAgent(agentId, skillId);
    }
    async getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<AgentSkill[]> {
        return this.assignments.getSkillsForAgent(agentId, userId, agentCategory);
    }
    async getSkillIdsForAgent(agentId: string, userId?: string): Promise<string[]> {
        return this.assignments.getSkillIdsForAgent(agentId, userId);
    }
    async assignSkillToUser(userId: string, skillId: string, priority: number = 0): Promise<void> {
        return this.assignments.assignSkillToUser(userId, skillId, priority);
    }
    async removeSkillFromUser(userId: string, skillId: string): Promise<void> {
        return this.assignments.removeSkillFromUser(userId, skillId);
    }
    async getUserSkillIds(userId: string): Promise<string[]> {
        return this.assignments.getUserSkillIds(userId);
    }
    async getUserSkills(userId: string): Promise<AgentSkill[]> {
        return this.assignments.getUserSkills(userId);
    }

    /**
     * 스킬 status 를 변경합니다 (draft → active 승인, draft → archived 거절 등).
     * actor 가 주어지면 소유권을 검증합니다. 시스템 스킬(createdBy=null) 은 admin 만 변경 가능.
     */
    async updateStatus(id: string, status: SkillStatus, actor?: ActorContext): Promise<AgentSkill | null> {
        const existing = await this.getSkillById(id);
        if (!existing) {
            return null;
        }

        if (actor) {
            if (existing.createdBy) {
                assertResourceOwnerOrAdmin(existing.createdBy, actor.userId, actor.userRole);
            } else if (actor.userRole !== 'admin') {
                throw new Error('ADMIN_REQUIRED: 시스템 스킬 status 변경은 관리자만 가능합니다');
            }
        }

        const nowIso = new Date().toISOString();
        await this.query(
            `UPDATE agent_skills SET status = $1, updated_at = $2 WHERE id = $3`,
            [status, nowIso, id]
        );
        return this.getSkillById(id);
    }

    /**
     * draft 상태 스킬 목록 (페이지네이션).
     * target='user' → 본인 draft 만. 'system' → admin 이 본 system draft (createdBy IS NULL).
     * 'all' → admin 이 전체 draft (소유자 무관).
     */
    async listDrafts(options: DraftListOptions): Promise<DraftListResult> {
        const conditions: string[] = [`status = 'draft'`];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        const target = options.target ?? 'user';
        if (target === 'user') {
            if (!options.userId) {
                throw new Error('listDrafts: target=user 는 userId 필수');
            }
            conditions.push(`created_by = $${paramIdx}`);
            params.push(options.userId);
            paramIdx += 1;
        } else if (target === 'system') {
            conditions.push(`created_by IS NULL`);
        }
        // target === 'all' → 추가 조건 없음

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const limit = Math.min(options.limit ?? 50, 100);
        const offset = Math.max(0, options.offset ?? 0);

        const countResult = await this.query<CountRow>(
            `SELECT COUNT(*) AS total FROM agent_skills ${whereClause}`,
            params
        );

        const dataParams: QueryParam[] = [...params, limit, offset];
        const dataResult = await this.query(
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at, source_repo, source_path, status, manifest_meta
             FROM agent_skills
             ${whereClause}
             ORDER BY created_at DESC, id ASC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams
        );

        return {
            drafts: dataResult.rows.map((row) => rowToSkill(row)),
            total: parseInt(countResult.rows[0]?.total ?? '0', 10),
            limit,
            offset,
        };
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

    private escapeILike(str: string): string {
        return str.replace(/[%_]/g, '\\$&');
    }
}
