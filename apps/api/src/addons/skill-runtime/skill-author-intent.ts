/**
 * 스킬 작성 의도 턴 설정 (2026-11-26, opt-in) — `chat-integration.ts` 가 쓴다.
 *
 * 종전 `system-skill-author-guide` 는 시드만 되고 어느 에이전트에도 배정되지 않아 주입된 적이 없고
 * (skill-manager 의 주입 조회는 배정 테이블 INNER JOIN), `create_skill` 도구도 상시·의도 강제 포함 목록에
 * 없어 채팅에서 모델이 볼 수 없었다(운영 호출 0건). 플래그를 켜면 스킬 작성 의도 턴에만 도구를 노출하고
 * 안내문을 시스템 프롬프트 조각으로 싣는다 — 상시 노출 금지(프롬프트 다이어트·prefix cache) 원칙대로.
 * 플래그 OFF(기본)면 아무 것도 하지 않는다(종전 동작 그대로).
 *
 * @module addons/skill-runtime/skill-author-intent
 */

/** 기본 OFF — `SKILL_AUTHOR_INTENT_ENABLED=true` 일 때만 동작한다. 호출마다 읽는다(테스트·재시작 없는 env 변경 반영). */
export function skillAuthorIntentEnabled(): boolean {
    return process.env.SKILL_AUTHOR_INTENT_ENABLED === 'true';
}

/** 노출할 도구 — skill-runtime 이 `contributeBuiltInTools` 로 기여하는 `create_skill` */
export const SKILL_AUTHOR_TOOL_NAME = 'create_skill';

/**
 * 스킬 작성 의도 — "스킬 만들어줘"·"이 작업을 스킬로 등록해"·"create a skill for …".
 * 영어는 'skill' 단독이 흔한 일반어("coding skills")라 생성 동사 + 관사/new + skill 형태만 본다.
 */
export const SKILL_AUTHOR_INTENT_PATTERNS: readonly RegExp[] = [
    /스킬\s*(?:을|를)?\s*(?:하나\s*)?(?:새로\s*)?(?:만들|생성|등록|작성)/,
    /(?:스킬|skill)\s*(?:로|으로)\s*(?:만들|등록|저장|생성)/i,
    /\b(?:create|make|build|write|register|add)\s+(?:me\s+)?(?:a|an|new|this\s+as\s+a)\s+(?:new\s+)?(?:\w+\s+){0,3}skill\b/i,
    /\b(?:turn|save|make)\s+(?:this|it|that)\s+(?:into|as)\s+a\s+skill\b/i,
];

export function isSkillAuthorIntent(message: string | undefined): boolean {
    if (!message) return false;
    return SKILL_AUTHOR_INTENT_PATTERNS.some((re) => re.test(message));
}
