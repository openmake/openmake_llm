/**
 * 스킬 이전 버전 조회·복원.
 *
 * 복원 = 이력의 이름·설명·본문·분류로 다시 수정(SkillManager.updateSkill). 그래서
 *   - 권한 판정(소유자·관리자, 시스템 스킬은 관리자)과 매니페스트 동기화가 일반 수정과 같고
 *   - 복원 직전 내용도 이력에 남아 복원을 되돌릴 수 있다.
 * 공개 여부(isPublic)는 이력에 없으므로 바꾸지 않는다.
 *
 * @module addons/skill-runtime/skill-revisions
 */
import { getPool } from '../../runtime-ports/db-access';
import { getSkillManager } from './skill-manager';
import { SkillRevisionRepository, type SkillRevision } from './data/skill-revision-repository';
import type { AgentSkill } from './data/skill-repository-types';

export function listSkillRevisions(skillId: string): Promise<SkillRevision[]> {
    return new SkillRevisionRepository(getPool()).list(skillId);
}

/** @returns 복원 후 스킬. 이력이 없으면 null (스킬이 없으면 updateSkill 이 null) */
export async function restoreSkillRevision(
    skillId: string, revisionId: string, actor: { userId: string; userRole: string },
): Promise<AgentSkill | null> {
    const rev = await new SkillRevisionRepository(getPool()).get(skillId, revisionId);
    if (!rev) return null;
    return getSkillManager().updateSkill(skillId, {
        name: rev.name,
        description: rev.description ?? '',
        content: rev.content,
        ...(rev.category ? { category: rev.category } : {}),
    }, actor);
}
