/**
 * 스킬 수정 이력 — `skill_revisions`(203).
 *
 * 스킬 수정(SkillRepository.updateSkill)은 agent_skills 와 최신 매니페스트를 제자리에서 덮어쓴다.
 * 그 직전 내용을 한 줄 남겨 두고, 복원은 그 내용으로 다시 수정한다(skill-revisions.ts) — 복원 직전 내용도
 * 같은 경로로 남으므로 복원을 되돌릴 수 있다. 스킬당 최근 SKILL_REVISION_KEEP 개만 둔다.
 *
 * @module addons/skill-runtime/data/skill-revision-repository
 */
import { BaseRepository } from '../../../runtime-ports/db-access';
import { SKILL_REVISION_KEEP } from '../../../config/constants';
import type { AgentSkill } from './skill-repository-types';

export interface SkillRevision {
    id: string;
    skillId: string;
    name: string;
    description: string | null;
    content: string;
    category: string | null;
    /** 이 내용을 밀어낸 수정을 한 사용자 id (시스템 경로면 null) */
    replacedBy: string | null;
    createdAt: string;
}

interface RevisionRow {
    id: string; skill_id: string; name: string; description: string | null; content: string;
    category: string | null; replaced_by: string | null; created_at: Date | string;
}

const toRevision = (r: RevisionRow): SkillRevision => ({
    id: String(r.id), skillId: r.skill_id, name: r.name, description: r.description, content: r.content,
    category: r.category, replacedBy: r.replaced_by, createdAt: new Date(r.created_at).toISOString(),
});

/** PURE — 수정이 이력에 남길 만한 변경인가(이름·설명·본문·분류). 공개 여부만 바꾸면 남기지 않는다 */
export function isRevisableChange(
    existing: Pick<AgentSkill, 'name' | 'description' | 'content' | 'category'>,
    input: { name?: string; description?: string | null; content?: string; category?: string },
): boolean {
    return (input.name !== undefined && input.name !== existing.name)
        || (input.description !== undefined && input.description !== existing.description)
        || (input.content !== undefined && input.content !== existing.content)
        || (input.category !== undefined && input.category !== existing.category);
}

export class SkillRevisionRepository extends BaseRepository {
    /** 수정 직전 내용을 남기고 오래된 이력을 정리한다 */
    async snapshot(skill: Pick<AgentSkill, 'id' | 'name' | 'description' | 'content' | 'category'>, replacedBy: string | null): Promise<void> {
        await this.query(
            `INSERT INTO skill_revisions (skill_id, name, description, content, category, replaced_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [skill.id, skill.name, skill.description ?? null, skill.content, skill.category ?? null, replacedBy],
        );
        await this.query(
            `DELETE FROM skill_revisions
              WHERE skill_id = $1
                AND id NOT IN (SELECT id FROM skill_revisions WHERE skill_id = $1 ORDER BY id DESC LIMIT $2)`,
            [skill.id, SKILL_REVISION_KEEP],
        );
    }

    /** 최신순 */
    async list(skillId: string): Promise<SkillRevision[]> {
        const r = await this.query<RevisionRow>(
            `SELECT id, skill_id, name, description, content, category, replaced_by, created_at
               FROM skill_revisions WHERE skill_id = $1 ORDER BY id DESC LIMIT $2`,
            [skillId, SKILL_REVISION_KEEP],
        );
        return r.rows.map(toRevision);
    }

    async get(skillId: string, revisionId: string): Promise<SkillRevision | null> {
        if (!/^\d+$/.test(revisionId)) return null;
        const r = await this.query<RevisionRow>(
            `SELECT id, skill_id, name, description, content, category, replaced_by, created_at
               FROM skill_revisions WHERE skill_id = $1 AND id = $2`,
            [skillId, revisionId],
        );
        return r.rows[0] ? toRevision(r.rows[0]) : null;
    }
}
