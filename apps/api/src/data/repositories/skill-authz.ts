/**
 * 스킬 본문 변경/삭제 권한 — 사용자 스킬은 소유자 또는 관리자, 시스템 스킬(createdBy NULL)은 관리자만.
 *
 * skill_manifests.prompt_md 가 전 사용자 시스템 프롬프트 주입의 SoT 라 시스템 스킬 본문 변경은
 * 저장형 프롬프트 인젝션과 같다. (2026-09-02 보안 리뷰 H1: 종전엔 아무 인증 사용자가 통과했다)
 */
import { assertResourceOwnerOrAdmin } from '../../auth/ownership';
import { AuthorizationError } from '../../utils/error-handler';

export interface SkillActor { userId: string; userRole: string }

export function assertSkillMutationAllowed(createdBy: string | null | undefined, actor: SkillActor): void {
    if (createdBy) {
        assertResourceOwnerOrAdmin(createdBy, actor.userId, actor.userRole);
        return;
    }
    if (actor.userRole !== 'admin') {
        throw new AuthorizationError('시스템 스킬 변경은 관리자만 가능합니다');
    }
}
