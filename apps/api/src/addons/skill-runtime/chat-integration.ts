/**
 * skill-runtime add-on — 채팅 턴 통합 (2026-11-26, opt-in `SKILL_AUTHOR_INTENT_ENABLED`).
 *
 * 스킬 작성 의도 턴에만 ① `create_skill` 도구를 강제 포함하고 ② 사용 안내문(`SKILL_AUTHOR_GUIDE_CONTENT`)을
 * 시스템 프롬프트 조각으로 싣는다. 플래그 OFF 면 모든 훅이 빈 값을 돌려 종전과 같다.
 *
 * 형식은 Base `ChatTurnIntegration` 이지만 타입을 import 하지 않는다 — add-on → Base 내부 import 래칫
 * (`npm run check:addon-boundary`)에 새 쌍을 더하지 않기 위해서다. 형 일치는 테스트가 컴파일 단계에서 고정한다.
 *
 * @module addons/skill-runtime/chat-integration
 */
import { SKILL_AUTHOR_GUIDE_CONTENT } from './prompts';
import { SKILL_AUTHOR_TOOL_NAME, isSkillAuthorIntent, skillAuthorIntentEnabled } from './skill-author-intent';

const active = (message: string | undefined): boolean => skillAuthorIntentEnabled() && isSkillAuthorIntent(message);

export const skillAuthorChatIntegration = {
    id: 'skill-runtime',

    detectIntent(message: string): boolean {
        return active(message);
    },

    forceIncludeTools(message: string): Array<{ nameIncludes: string; reason: string }> {
        return active(message) ? [{ nameIncludes: SKILL_AUTHOR_TOOL_NAME, reason: '스킬 작성 의도' }] : [];
    },

    systemPromptParts(req: { message?: string }): string[] {
        return active(req.message) ? [SKILL_AUTHOR_GUIDE_CONTENT] : [];
    },
};
