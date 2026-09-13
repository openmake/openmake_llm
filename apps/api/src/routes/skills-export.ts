/**
 * 스킬 내보내기 핸들러 — `GET /api/agents/skills/:skillId/export` (SKILL.md 다운로드).
 *
 * `skills.routes.ts` 가 600줄 가드에 닿아 라우트 본문만 여기로 분리했다(등록은 그쪽).
 *
 * 형제 라우트(PUT/DELETE/rewrite-proposal)와 같은 소유권 가드 — `getSkillById` 는 id 만으로
 * 조회하므로 비공개 타인 스킬의 본문(프롬프트 SoT)이 id 만 알면 내려가던 갭(2026-09-13 보안 점검).
 * 공개(isPublic) 스킬과 시스템 스킬(createdBy 없음)은 통과한다.
 *
 * @module routes/skills-export
 */
import type { Request, Response } from 'express';
import { getSkillManager } from '../agents/skill-manager';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { notFound } from '../utils/api-response';

export async function exportSkill(req: Request, res: Response): Promise<void> {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (skill.createdBy && skill.isPublic !== true) {
        assertResourceOwnerOrAdmin(String(skill.createdBy), String(userId), req.user?.role || 'user');
    }

    const markdown = [
        `# ${skill.name}`,
        '',
        `> ${skill.description}`,
        '',
        `**Category**: ${skill.category}`,
        '',
        '## Instructions',
        '',
        skill.content,
    ].join('\n');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${skill.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.SKILL.md"`);
    res.send(markdown);
}
