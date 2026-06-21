/**
 * SkillAssignmentRepository — 에이전트/사용자 ↔ 스킬 binding 관리.
 *
 * skill-repository.ts 에서 추출 (max-lines 정책 + 책임 분리).
 * `agent_skill_assignments` 테이블 전용. agent_id 가 '__global__' 또는
 * 'user:{userId}' 패턴인 경우도 같은 테이블로 표현.
 *
 * @module data/repositories/skill-assignment-repository
 */
import { BaseRepository, type QueryParam } from './base-repository';
import type { AgentSkill } from './skill-repository';
import { rowToSkill } from './skill-row-mapper';

interface SkillIdRow {
    skill_id: string;
}

export class SkillAssignmentRepository extends BaseRepository {
    /** agent ↔ skill 명시 binding (priority 정렬 키) */
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
     * 에이전트에 연결된 스킬 목록 반환.
     *   - 에이전트 고유 스킬 + '__global__' 가상 에이전트 스킬
     *   - userId 가 주어지면 'user:{userId}' 개인 스킬도 포함 (카테고리 일치 시)
     *   - status='active' 만 (draft/archived 는 prompt 주입 경로에서 차단)
     */
    async getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<AgentSkill[]> {
        const conditions: string[] = ['a.agent_id = $1', "a.agent_id = '__global__'"];
        const params: QueryParam[] = [agentId];

        if (userId) {
            if (agentCategory) {
                conditions.push(`(a.agent_id = $${params.length + 1} AND s.category = $${params.length + 2})`);
                params.push(`user:${userId}`, agentCategory);
            } else {
                conditions.push(`a.agent_id = $${params.length + 1}`);
                params.push(`user:${userId}`);
            }
        }

        const whereClause = conditions.join(' OR ');
        const result = await this.query(
            `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public,
                    s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path,
                    s.status, s.manifest_meta,
                    MIN(a.priority) AS priority
             FROM agent_skills s
             JOIN agent_skill_assignments a ON s.id = a.skill_id
             WHERE (${whereClause}) AND s.status = 'active'
             GROUP BY s.id, s.name, s.description, s.content, s.category, s.is_public,
                      s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path,
                      s.status, s.manifest_meta
             ORDER BY MIN(a.priority) ASC, s.name ASC
             LIMIT $${params.length + 1}`,
            [...params, 15]
        );
        return result.rows.map((row) => rowToSkill(row));
    }

    /** 에이전트에 연결된 skill ID 목록 (__global__ 포함, userId 개인 스킬 포함) */
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

    /** 사용자 개인 스킬 할당 ('user:{userId}' 가상 에이전트 ID 패턴) */
    async assignSkillToUser(userId: string, skillId: string, priority: number = 0): Promise<void> {
        await this.query(
            `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (agent_id, skill_id) DO UPDATE
             SET priority = EXCLUDED.priority`,
            [`user:${userId}`, skillId, priority]
        );
    }

    async removeSkillFromUser(userId: string, skillId: string): Promise<void> {
        await this.query(
            'DELETE FROM agent_skill_assignments WHERE agent_id = $1 AND skill_id = $2',
            [`user:${userId}`, skillId]
        );
    }

    async getUserSkillIds(userId: string): Promise<string[]> {
        const result = await this.query<SkillIdRow>(
            `SELECT skill_id FROM agent_skill_assignments WHERE agent_id = $1`,
            [`user:${userId}`]
        );
        return result.rows.map((row) => row.skill_id);
    }

    /**
     * 사용자 개인 할당 스킬 전체 목록 (status='active' 만 — draft/archived 제외).
     */
    async getUserSkills(userId: string): Promise<AgentSkill[]> {
        const result = await this.query(
            `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public,
                    s.created_by, s.created_at, s.updated_at, s.source_repo, s.source_path,
                    s.status, s.manifest_meta
             FROM agent_skills s
             JOIN agent_skill_assignments a ON s.id = a.skill_id
             WHERE a.agent_id = $1 AND s.status = 'active'
             ORDER BY a.priority ASC, s.name ASC`,
            [`user:${userId}`]
        );
        return result.rows.map((row) => rowToSkill(row));
    }
}
