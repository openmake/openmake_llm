/**
 * ============================================================
 * Agent Skill Manager - 에이전트 스킬 CRUD 및 주입 관리
 * ============================================================
 *
 * 에이전트 스킬(재사용 가능한 전문 지식/지시 블록)의 생성, 수정, 삭제,
 * 에이전트 연결 및 채팅 파이프라인 주입을 담당합니다.
 *
 * @module agents/skill-manager
 * @description
 * - CRUD: createSkill(), updateSkill(), deleteSkill(), getAllSkills()
 * - 연결: assignSkillToAgent(), removeSkillFromAgent(), getSkillsForAgent()
 * - 주입: buildSkillPrompt() - 에이전트 시스템 프롬프트에 스킬 내용 삽입
 * - 싱글톤: getSkillManager()
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('SkillManager');

// ========================================
// 인터페이스
// ========================================

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
    search?: string;       // 이름, 설명, 내용 텍스트 검색 (ILIKE)
    category?: string;     // 카테고리 필터
    isPublic?: boolean;    // 공개 스킬만 필터
    sortBy?: 'newest' | 'name' | 'category' | 'updated';  // 정렬
    limit?: number;        // 페이지네이션 (기본 20)
    offset?: number;       // 페이지네이션 오프셋
}

export interface SkillSearchResult {
    skills: AgentSkill[];
    total: number;         // 전체 매칭 수 (페이지네이션용)
    limit: number;
    offset: number;
}

// ========================================
// SkillManager 클래스
// ========================================

export class SkillManager {
    /**
     * DB 풀 가져오기 (require로 순환 참조 방지)
     */
    private getPool() {
        const { getUnifiedDatabase } = require('../data/models/unified-database');
        return getUnifiedDatabase().getPool();
    }

    private initialized = false;

    /**
     * DB 테이블이 존재하는지 런타임에 확인하고, 없으면 생성합니다.
     */
    private async ensureTables(): Promise<void> {
        if (this.initialized) return;
        const pool = this.getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agent_skills (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                content     TEXT NOT NULL,
                category    TEXT DEFAULT 'general',
                is_public   BOOLEAN DEFAULT FALSE,
                created_by  TEXT REFERENCES users(id) ON DELETE CASCADE,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW(),
                source_repo TEXT,
                source_path TEXT
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_skills' AND column_name='source_repo') THEN
                    ALTER TABLE agent_skills ADD COLUMN source_repo TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_skills' AND column_name='source_path') THEN
                    ALTER TABLE agent_skills ADD COLUMN source_path TEXT;
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS agent_skill_assignments (
                agent_id   TEXT NOT NULL,
                skill_id   TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
                priority   INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (agent_id, skill_id)
            );

            CREATE INDEX IF NOT EXISTS idx_agent_skills_created_by ON agent_skills(created_by);
            CREATE INDEX IF NOT EXISTS idx_agent_skills_category ON agent_skills(category);
            CREATE INDEX IF NOT EXISTS idx_agent_skills_public ON agent_skills(is_public);
            CREATE INDEX IF NOT EXISTS idx_skill_assignments_agent ON agent_skill_assignments(agent_id);
            CREATE INDEX IF NOT EXISTS idx_skill_assignments_skill ON agent_skill_assignments(skill_id);
        `);
        this.initialized = true;
        logger.info('📋 Agent Skill PostgreSQL 테이블 초기화됨');
    }

    // ------------------------------------------------
    // 스킬 CRUD
    // ------------------------------------------------

    /**
     * 스킬 생성
     */
    async createSkill(input: CreateSkillInput): Promise<AgentSkill> {
        await this.ensureTables();
        const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date();
        const pool = this.getPool();

        await pool.query(
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
                now,
                now,
                input.sourceRepo ?? null,
                input.sourcePath ?? null,
            ]
        );

        logger.info(`스킬 생성됨: ${id} (${input.name})`);

        return {
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
     * 스킬 수정
     */
    async updateSkill(id: string, input: UpdateSkillInput): Promise<AgentSkill | null> {
        await this.ensureTables();
        const pool = this.getPool();

        // 현재 값 조회
        const existing = await this.getSkillById(id);
        if (!existing) return null;

        const now = new Date();
        await pool.query(
            `UPDATE agent_skills
             SET name = $1, description = $2, content = $3, category = $4, is_public = $5, updated_at = $6
             WHERE id = $7`,
            [
                input.name ?? existing.name,
                input.description !== undefined ? input.description : existing.description,
                input.content ?? existing.content,
                input.category ?? existing.category,
                input.isPublic !== undefined ? input.isPublic : existing.isPublic,
                now,
                id,
            ]
        );

        logger.info(`스킬 수정됨: ${id}`);

        return {
            ...existing,
            name: input.name ?? existing.name,
            description: input.description !== undefined ? input.description : existing.description,
            content: input.content ?? existing.content,
            category: input.category ?? existing.category,
            isPublic: input.isPublic !== undefined ? input.isPublic : existing.isPublic,
            updatedAt: now,
        };
    }

    /**
     * 스킬 삭제 (연결된 assignments도 CASCADE 삭제됨)
     */
    async deleteSkill(id: string): Promise<boolean> {
        await this.ensureTables();
        const pool = this.getPool();
        const result = await pool.query('DELETE FROM agent_skills WHERE id = $1', [id]);
        const deleted = (result.rowCount ?? 0) > 0;
        if (deleted) logger.info(`스킬 삭제됨: ${id}`);
        return deleted;
    }

    /**
     * 스킬 단건 조회
     */
    async getSkillById(id: string): Promise<AgentSkill | null> {
        await this.ensureTables();
        const pool = this.getPool();
        const result = await pool.query(
            'SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at FROM agent_skills WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) return null;
        return this.rowToSkill(result.rows[0]);
    }

    /**
     * 전체 스킬 목록 (사용자 기준 필터)
     * - 본인 스킬 + 공개 스킬
     */
    async getAllSkills(userId?: string): Promise<AgentSkill[]> {
        await this.ensureTables();
        const pool = this.getPool();
        let query: string;
        let params: unknown[];

        if (userId) {
            query = `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
                     FROM agent_skills
                     WHERE created_by = $1 OR is_public = TRUE
                     ORDER BY created_at DESC`;
            params = [userId];
        } else {
            query = `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
                     FROM agent_skills
                     WHERE is_public = TRUE
                     ORDER BY created_at DESC`;
            params = [];
        }

        const result = await pool.query(query, params);
        return result.rows.map((row: Record<string, unknown>) => this.rowToSkill(row));
    }

    /**
     * 스킬 검색 및 필터링 (페이지네이션 포함)
     */
    async searchSkills(options: SkillSearchOptions): Promise<SkillSearchResult> {
        await this.ensureTables();
        const pool = this.getPool();

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        // 사용자 필터: 본인 스킬 + 공개 스킬
        if (options.userId) {
            conditions.push(`(created_by = $${paramIdx} OR is_public = TRUE)`);
            params.push(options.userId);
            paramIdx++;
        } else {
            conditions.push(`is_public = TRUE`);
        }

        // 텍스트 검색
        if (options.search) {
            conditions.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR content ILIKE $${paramIdx})`);
            params.push(`%${options.search}%`);
            paramIdx++;
        }

        // 카테고리 필터
        if (options.category) {
            conditions.push(`category = $${paramIdx}`);
            params.push(options.category);
            paramIdx++;
        }

        // 공개 스킬 필터
        if (options.isPublic !== undefined) {
            conditions.push(`is_public = $${paramIdx}`);
            params.push(options.isPublic);
            paramIdx++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // 정렬
        const sortMap: Record<string, string> = {
            newest: 'created_at DESC',
            name: 'name ASC',
            category: 'category ASC, name ASC',
            updated: 'updated_at DESC',
        };
        const orderBy = sortMap[options.sortBy ?? 'newest'] ?? 'created_at DESC';

        // 페이지네이션
        const limit = Math.min(options.limit ?? 20, 100);
        const offset = Math.max(0, options.offset ?? 0);

        // 카운트 쿼리
        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM agent_skills ${whereClause}`,
            params
        );

        // 데이터 쿼리
        const dataResult = await pool.query(
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
             FROM agent_skills
             ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            [...params, limit, offset]
        );

        return {
            skills: dataResult.rows.map((row: Record<string, unknown>) => this.rowToSkill(row)),
            total: parseInt(countResult.rows[0].total as string, 10),
            limit,
            offset,
        };
    }

    // ------------------------------------------------
    // 에이전트-스킬 연결
    // ------------------------------------------------

    /**
     * 에이전트에 스킬 연결
     */
    async assignSkillToAgent(agentId: string, skillId: string, priority: number = 0): Promise<void> {
        await this.ensureTables();
        const pool = this.getPool();
        await pool.query(
            `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (agent_id, skill_id) DO UPDATE SET priority = EXCLUDED.priority`,
            [agentId, skillId, priority]
        );
        logger.info(`스킬 연결됨: 에이전트=${agentId}, 스킬=${skillId}`);
    }

    /**
     * 에이전트에서 스킬 연결 해제
     */
    async removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
        await this.ensureTables();
        const pool = this.getPool();
        await pool.query(
            'DELETE FROM agent_skill_assignments WHERE agent_id = $1 AND skill_id = $2',
            [agentId, skillId]
        );
        logger.info(`스킬 연결 해제: 에이전트=${agentId}, 스킬=${skillId}`);
    }

    /**
     * 에이전트에 연결된 스킬 목록 조회 (priority 순 정렬)
     */
    async getSkillsForAgent(agentId: string): Promise<AgentSkill[]> {
        await this.ensureTables();
        const pool = this.getPool();
        const result = await pool.query(
            `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public, s.created_by, s.created_at, s.updated_at
             FROM agent_skills s
             JOIN agent_skill_assignments a ON s.id = a.skill_id
             WHERE a.agent_id = $1
             ORDER BY a.priority ASC, s.name ASC`,
            [agentId]
        );
        return result.rows.map((row: Record<string, unknown>) => this.rowToSkill(row));
    }

    /**
     * 에이전트에 연결된 스킬 ID 목록 조회
     */
    async getSkillIdsForAgent(agentId: string): Promise<string[]> {
        await this.ensureTables();
        const pool = this.getPool();
        const result = await pool.query(
            'SELECT skill_id FROM agent_skill_assignments WHERE agent_id = $1 ORDER BY priority ASC',
            [agentId]
        );
        return result.rows.map((row: { skill_id: string }) => row.skill_id);
    }

    // ------------------------------------------------
    // 프롬프트 주입
    // ------------------------------------------------

    /**
     * 에이전트 스킬 프롬프트 블록 생성
     * 시스템 프롬프트에 추가할 스킬 내용 문자열을 반환합니다.
     */
    async buildSkillPrompt(agentId: string): Promise<string> {
        const skills = await this.getSkillsForAgent(agentId);
        if (skills.length === 0) return '';

        const skillBlocks = skills
            .map(s => `### 스킬: ${s.name}\n${s.content}`)
            .join('\n\n');

        return `\n\n## 적용된 스킬\n${skillBlocks}`;
    }

    // ------------------------------------------------
    // 내부 유틸
    // ------------------------------------------------

    private rowToSkill(row: Record<string, unknown>): AgentSkill {
        return {
            id: row.id as string,
            name: row.name as string,
            description: (row.description as string) ?? '',
            content: row.content as string,
            category: (row.category as string) ?? 'general',
            isPublic: (row.is_public as boolean) ?? false,
            createdBy: row.created_by as string | undefined,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string),
            sourceRepo: row.source_repo as string | undefined,
            sourcePath: row.source_path as string | undefined,
        };
    }
}

// ========================================
// 싱글톤
// ========================================

let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(): SkillManager {
    if (!skillManagerInstance) {
        skillManagerInstance = new SkillManager();
    }
    return skillManagerInstance;
}
